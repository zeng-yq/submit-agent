# 待审核评论检测增强 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 WP 原生整页跳转的「待审核」评论被正确判定为失败（并移出外链库），不再被误判为提交成功入库。

**Architecture:** 在引擎侧新增「跳转后验证」：提交触发 `navigating`/`pagehide` 后，轮询 tab URL 等重定向落定，再向新页面 content script 发 `verify-moderation` 消息，由其用 `isModerationUrl(location.href) || isModerationContent(document)` 权威判定是否待审核。命中 → `markFailed`（覆盖 submitted，移出外链库）；无法确认 → 新增的 `unverified` → 保守判失败。

**Tech Stack:** TypeScript + WXT（MV3 扩展）+ React + Vitest（jsdom 环境）+ IndexedDB（idb）。

## Global Constraints

- 提交信息用中文，清晰说明「原因」，关联本计划。
- 每个任务结束运行 `npm --prefix extension run build`，报错则修复（CLAUDE.md 强制）。
- 绝不通过 `--no-verify` 跳过钩子；绝不禁用测试来规避错误。
- 测试框架：vitest，环境 jsdom；单测放 `extension/src/__tests__/*.test.ts`，命令 `npm --prefix extension run test`。
- 不新增浏览器权限（现有 `tabs` + `<all_urls>` 已够；DOM 复核走 content script 消息，不用 `chrome.scripting`）。
- 遵循 DI + TDD：副作用逻辑抽成可注入纯函数再单测（参考既有 `performClick(button, form, waitFor)` 模式）。
- `directory_submit` 流程不动；验证码/登录跳转/AJAX 复核既有逻辑不动。

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `extension/src/agent/types.ts` | `VerifyResult` 类型 + 成功判定常量 | 改：加 `'unverified'`、加 `VERIFIED_SUCCESS` |
| `extension/src/agent/comment-submit.ts` | 评论提交纯 DOM 模块（含审核检测） | 改：加 `detectModeration()` |
| `extension/src/agent/verify-after-navigation.ts` | 跳转后验证的 DI 纯函数 | 新建 |
| `extension/src/entrypoints/content.ts` | content script 消息分发 | 改：加 `verify-moderation` case + import |
| `extension/src/agent/FormFillEngine.ts` | 填写引擎（sidepanel） | 改：接入跳转后验证 + 用 `VERIFIED_SUCCESS` |
| `extension/src/hooks/useFloatFill.ts` | 浮窗提交编排 | 改：用 `VERIFIED_SUCCESS` |
| `extension/src/__tests__/verify-result.test.ts` | `VERIFIED_SUCCESS` 常量 | 新建 |
| `extension/src/__tests__/comment-submit.test.ts` | `detectModeration` 用例 | 改：加 describe |
| `extension/src/__tests__/verify-after-navigation.test.ts` | 跳转后验证纯函数 | 新建 |

**接口契约（跨任务共用，后续任务只看自己任务也需知道这些名字/类型）：**

- `VERIFIED_SUCCESS: readonly VerifyResult[]`（types.ts）= `['ajax','cleared','navigating','pagehide']`
- `detectModeration(): boolean`（comment-submit.ts）= `isModerationUrl(location.href) || isModerationContent(document)`
- `verifyAfterNavigation(tabId: number, deps: VerifyAfterNavigationDeps): Promise<ModerationVerdict>`（verify-after-navigation.ts）
  - `ModerationVerdict = 'confirmed' | 'moderation' | 'unverified'`
  - `VerifyAfterNavigationDeps = { getTabUrl, sendVerify, sleep, settleTimeoutMs?, pollMs? }`
- `applyNavigationVerdict(verifyResult: VerifyResult, verdict: ModerationVerdict): VerifyResult`（verify-after-navigation.ts）
- content script 消息 `{ type:'FLOAT_FILL', action:'verify-moderation' }` → 响应 `{ ok:true, moderation:boolean }`

---

### Task 1: `VerifyResult` 新增 `unverified` + `VERIFIED_SUCCESS` 常量

**Files:**
- Modify: `extension/src/agent/types.ts:16-25`
- Test: `extension/src/__tests__/verify-result.test.ts`（新建）

**Interfaces:**
- Produces: `VERIFIED_SUCCESS: readonly VerifyResult[]`；`VerifyResult` 增加 `'unverified'`。被 Task 5（FormFillEngine）、Task 6（useFloatFill）消费。

- [ ] **Step 1: 写失败测试（新建 `extension/src/__tests__/verify-result.test.ts`）**

```ts
import { describe, it, expect } from 'vitest'
import { VERIFIED_SUCCESS } from '@/agent/types'
import type { VerifyResult } from '@/agent/types'

describe('VERIFIED_SUCCESS', () => {
	it('恰为四种已确认成功的验证结果', () => {
		expect(VERIFIED_SUCCESS).toEqual(['ajax', 'cleared', 'navigating', 'pagehide'])
	})

	it('不含任何失败/未确认结果（含新增的 unverified）', () => {
		const failures: VerifyResult[] = [
			'pending_moderation', 'login_required', 'timeout', 'not_attempted', 'unverified',
		]
		for (const f of failures) {
			expect(VERIFIED_SUCCESS).not.toContain(f)
		}
	})
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix extension run test -- src/__tests__/verify-result.test.ts`
Expected: FAIL —— `VERIFIED_SUCCESS` 未导出（`import { VERIFIED_SUCCESS }` 报 undefined / 导出不存在）。

- [ ] **Step 3: 改 types.ts —— 加 `'unverified'` 与 `VERIFIED_SUCCESS`**

在 `extension/src/agent/types.ts` 把现有 `VerifyResult` 联合（`pending_moderation` 行之后、`not_attempted` 行之前）加一行：

```ts
	| 'pending_moderation' // 评论待审核（WP moderation-hash，未实际发布）
	| 'unverified' // 提交触发整页跳转，但跳转后无法确认发布状态（保守判失败）
	| 'not_attempted' // 未尝试提交（找不到按钮 / 点击失败 / 验证码）
```

并在 `VerifyResult` 定义之后（`not_attempted` 那行结束的下一行）新增常量：

```ts
/** 自动提交后判定为「已确认成功」的验证结果集合（navigating/pagehide 仅在跳转后验证通过后才成立） */
export const VERIFIED_SUCCESS: readonly VerifyResult[] = ['ajax', 'cleared', 'navigating', 'pagehide']
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm --prefix extension run test -- src/__tests__/verify-result.test.ts`
Expected: PASS（2 用例）。

- [ ] **Step 5: build 门禁**

Run: `npm --prefix extension run build`
Expected: 成功（types 改动不影响运行时）。

- [ ] **Step 6: 提交**

```bash
git add extension/src/agent/types.ts extension/src/__tests__/verify-result.test.ts
git commit -m "feat(types): VerifyResult 新增 unverified + 导出 VERIFIED_SUCCESS 成功集合"
```

---

### Task 2: `detectModeration()` 组合 helper

**Files:**
- Modify: `extension/src/agent/comment-submit.ts:58-63`（在 `isModerationContent` 之后插入）
- Test: `extension/src/__tests__/comment-submit.test.ts`（追加 describe）

**Interfaces:**
- Consumes: `isModerationUrl`、`isModerationContent`（本文件已有）。
- Produces: `detectModeration(): boolean`。被 Task 4（content.ts verify-moderation handler）消费。

- [ ] **Step 1: 写失败测试（在 `comment-submit.test.ts` 末尾追加）**

```ts
describe('detectModeration', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('DOM 含 comment-awaiting-moderation 元素 → true', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<em class="comment-awaiting-moderation">Your comment is awaiting moderation.</em>`
		expect(mod.detectModeration()).toBe(true)
	})

	it('URL 含 moderation 参数 → true（即便 DOM 无标记）', async () => {
		const mod = await loadModule()
		vi.stubGlobal('location', { href: 'https://example.com/post?unapproved=1&moderation-hash=abc#comment-1' })
		doc.body.innerHTML = ''
		expect(mod.detectModeration()).toBe(true)
	})

	it('正常已发布页 → false', async () => {
		const mod = await loadModule()
		vi.stubGlobal('location', { href: 'https://example.com/post#comment-1' })
		doc.body.innerHTML = `<div>Comment posted</div>`
		expect(mod.detectModeration()).toBe(false)
	})
})
```

> 说明：测试环境为 jsdom，`loadModule()` 会把 `globalThis.document` 指向新建 JSDOM 的 document（既有模式）；URL 路径用 `vi.stubGlobal('location', { href })` 控制全局 `location`，因 `detectModeration` 在调用时读取全局 `location.href`。`isModerationUrl`/`isModerationContent` 既已单测，此处验证组合接线。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix extension run test -- src/__tests__/comment-submit.test.ts`
Expected: FAIL —— `detectModeration` 不是函数。

- [ ] **Step 3: 实现 `detectModeration`**

在 `extension/src/agent/comment-submit.ts` 的 `isModerationContent` 函数（结束于 `}`，约 L63）之后插入：

```ts
/**
 * 当前页面是否处于评论待审核状态：URL 含 WP moderation 参数，或 DOM 出现待审核标记。
 * 供 content script 在提交后（含整页跳转后的新页面）对引擎做权威判定。
 */
export function detectModeration(): boolean {
	return isModerationUrl(location.href) || isModerationContent(document)
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm --prefix extension run test -- src/__tests__/comment-submit.test.ts`
Expected: PASS（含新增 3 用例，且不破坏既有用例）。

- [ ] **Step 5: build 门禁**

Run: `npm --prefix extension run build`
Expected: 成功。

- [ ] **Step 6: 提交**

```bash
git add extension/src/agent/comment-submit.ts extension/src/__tests__/comment-submit.test.ts
git commit -m "feat(comment-submit): 新增 detectModeration() 组合 URL+DOM 待审核判定"
```

---

### Task 3: `verifyAfterNavigation()` + `applyNavigationVerdict()` 纯函数

**Files:**
- Create: `extension/src/agent/verify-after-navigation.ts`
- Test: `extension/src/__tests__/verify-after-navigation.test.ts`（新建）

**Interfaces:**
- Consumes: `VerifyResult`（types.ts，Task 1）。
- Produces: `verifyAfterNavigation`、`applyNavigationVerdict`、`ModerationVerdict`、`VerifyAfterNavigationDeps`。被 Task 5（FormFillEngine）消费。

- [ ] **Step 1: 写失败测试（新建 `extension/src/__tests__/verify-after-navigation.test.ts`）**

```ts
import { describe, it, expect, vi } from 'vitest'
import { verifyAfterNavigation, applyNavigationVerdict } from '@/agent/verify-after-navigation'

const noopSleep = () => Promise.resolve()

describe('verifyAfterNavigation', () => {
	it('URL 落定 + 待审核 → moderation', async () => {
		const getTabUrl = vi.fn().mockResolvedValue('https://x.com/post?unapproved=1&moderation-hash=a#comment-1')
		const sendVerify = vi.fn().mockResolvedValue({ ok: true, moderation: true })
		expect(await verifyAfterNavigation(1, { getTabUrl, sendVerify, sleep: noopSleep })).toBe('moderation')
	})

	it('URL 落定 + 已发布 → confirmed', async () => {
		const getTabUrl = vi.fn().mockResolvedValue('https://x.com/post#comment-1')
		const sendVerify = vi.fn().mockResolvedValue({ ok: true, moderation: false })
		expect(await verifyAfterNavigation(1, { getTabUrl, sendVerify, sleep: noopSleep })).toBe('confirmed')
	})

	it('sendVerify 持续失败 → unverified', async () => {
		const getTabUrl = vi.fn().mockResolvedValue('https://x.com/post#comment-1')
		const sendVerify = vi.fn().mockRejectedValue(new Error('no response'))
		expect(await verifyAfterNavigation(1, { getTabUrl, sendVerify, sleep: noopSleep, pollMs: 1, settleTimeoutMs: 2 })).toBe('unverified')
	})

	it('URL 一直未落定 + sendVerify 失败 → unverified', async () => {
		const getTabUrl = vi.fn().mockResolvedValue('https://x.com/wp-comments-post.php')
		const sendVerify = vi.fn().mockRejectedValue(new Error('no response'))
		expect(await verifyAfterNavigation(1, { getTabUrl, sendVerify, sleep: noopSleep, pollMs: 1, settleTimeoutMs: 2 })).toBe('unverified')
	})
})

describe('applyNavigationVerdict', () => {
	it('navigating + moderation → pending_moderation', () => {
		expect(applyNavigationVerdict('navigating', 'moderation')).toBe('pending_moderation')
	})
	it('pagehide + unverified → unverified', () => {
		expect(applyNavigationVerdict('pagehide', 'unverified')).toBe('unverified')
	})
	it('navigating + confirmed → 维持 navigating', () => {
		expect(applyNavigationVerdict('navigating', 'confirmed')).toBe('navigating')
	})
	it('ajax（非跳转）→ 不受 verdict 影响', () => {
		expect(applyNavigationVerdict('ajax', 'moderation')).toBe('ajax')
	})
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix extension run test -- src/__tests__/verify-after-navigation.test.ts`
Expected: FAIL —— 模块不存在（导入报错）。

- [ ] **Step 3: 新建 `extension/src/agent/verify-after-navigation.ts`**

```ts
/**
 * verify-after-navigation —— 整页跳转后的待审核验证（DI 纯函数）。
 * 提交触发 navigating/pagehide 时，旧 content script 上下文看不到新页面状态，
 * 故由引擎在跳转落定后向新页面 content script 复核；本模块封装该流程，便于单测注入。
 */
import type { VerifyResult } from './types'

export type ModerationVerdict = 'confirmed' | 'moderation' | 'unverified'

export interface VerifyAfterNavigationDeps {
	/** 读取目标 tab 当前 URL（真实实现对接 chrome.tabs.get） */
	getTabUrl: (tabId: number) => Promise<string>
	/** 向新页面 content script 发 verify-moderation 并等待回复（真实实现对接 sendToTab） */
	sendVerify: (tabId: number) => Promise<{ ok: boolean; moderation: boolean }>
	/** 延时（真实实现 = setTimeout） */
	sleep: (ms: number) => Promise<void>
	/** 等 URL 落定的总预算（ms），默认 6000 */
	settleTimeoutMs?: number
	/** 轮询/重试间隔（ms），默认 500 */
	pollMs?: number
}

/** 跳转后最终页面的 URL 标记：评论锚点或 WP moderation 参数（仅重定向落定后出现） */
const FINAL_URL_MARKER = /#comment|unapproved=|moderation-hash=/i

/**
 * 整页跳转后验证评论是否待审核。
 * 阶段 1：轮询 tab URL 等重定向落定（出现最终页标记，或连续两次相同）。
 * 阶段 2：向新页面 content script 发 verify-moderation，至多重试 3 次。
 * 返回 'confirmed'（已发布）/ 'moderation'（待审核）/ 'unverified'（无法确认，保守失败）。
 */
export async function verifyAfterNavigation(
	tabId: number,
	deps: VerifyAfterNavigationDeps,
): Promise<ModerationVerdict> {
	const { getTabUrl, sendVerify, sleep } = deps
	const settleTimeoutMs = deps.settleTimeoutMs ?? 6000
	const pollMs = deps.pollMs ?? 500
	const maxSettlePolls = Math.max(1, Math.round(settleTimeoutMs / pollMs))

	// 阶段 1：等重定向落定
	let prevUrl = ''
	for (let i = 0; i < maxSettlePolls; i++) {
		let url = ''
		try {
			url = await getTabUrl(tabId)
		} catch {
			url = ''
		}
		if (FINAL_URL_MARKER.test(url) || (url && url === prevUrl)) break
		prevUrl = url
		await sleep(pollMs)
	}

	// 阶段 2：问新页面 content script（至多 3 次）
	for (let i = 0; i < 3; i++) {
		try {
			const r = await sendVerify(tabId)
			if (r?.ok === true) return r.moderation ? 'moderation' : 'confirmed'
		} catch {
			// content script 未就绪/出错 → 重试
		}
		await sleep(pollMs)
	}
	return 'unverified'
}

/**
 * 把「跳转后验证」结论应用到 verifyResult。
 * 仅 navigating/pagehide 受影响：moderation→pending_moderation，unverified→unverified，confirmed→维持原值。
 * 非跳转结果（ajax/cleared/...）原样返回。
 */
export function applyNavigationVerdict(verifyResult: VerifyResult, verdict: ModerationVerdict): VerifyResult {
	if (verifyResult !== 'navigating' && verifyResult !== 'pagehide') return verifyResult
	if (verdict === 'moderation') return 'pending_moderation'
	if (verdict === 'unverified') return 'unverified'
	return verifyResult
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm --prefix extension run test -- src/__tests__/verify-after-navigation.test.ts`
Expected: PASS（8 用例）。

- [ ] **Step 5: build 门禁**

Run: `npm --prefix extension run build`
Expected: 成功。

- [ ] **Step 6: 提交**

```bash
git add extension/src/agent/verify-after-navigation.ts extension/src/__tests__/verify-after-navigation.test.ts
git commit -m "feat(verify): 新增 verifyAfterNavigation/applyNavigationVerdict 跳转后验证纯函数"
```

---

### Task 4: content.ts 新增 `verify-moderation` handler

**Files:**
- Modify: `extension/src/entrypoints/content.ts:7`（import）
- Modify: `extension/src/entrypoints/content.ts:388`（switch 内新增 case）

**Interfaces:**
- Consumes: `detectModeration`（comment-submit.ts，Task 2）。
- Produces: content script 响应 `{ type:'FLOAT_FILL', action:'verify-moderation' }` → `{ ok:true, moderation:boolean }`。被 Task 5 的 `sendVerify` 调用。

> 本任务为接线（import + switch case），新增逻辑仅 `detectModeration()` 一行委托，其行为已由 Task 2 覆盖。验证以 build（类型/接线正确）+ Task 2 单测为保证。

- [ ] **Step 1: 改 import（`content.ts:7`）**

把：
```ts
import { resolveSubmitButton, detectCaptcha, performClick, isModerationContent } from '@/agent/comment-submit'
```
改为：
```ts
import { resolveSubmitButton, detectCaptcha, performClick, isModerationContent, detectModeration } from '@/agent/comment-submit'
```

- [ ] **Step 2: 在 switch 内新增 case（插在 `case 'submit'` 之前，即 `case 'annotate-clear'` 结束的 `}` 之后）**

定位锚点（`content.ts` 约 L383-388）：
```ts
				case 'annotate-clear': {
					clearAnnotations()
					sendResponse({ ok: true })
					return
				}
				case 'submit': {
```
在 `annotate-clear` 的 `}` 与 `case 'submit':` 之间插入：
```ts
				case 'verify-moderation': {
					// 整页跳转后引擎复核：返回当前页是否处于待审核（URL 参数 或 DOM 标记）
					sendResponse({ ok: true, moderation: detectModeration() })
					return
				}
```

- [ ] **Step 3: build 门禁（验证接线 + 类型）**

Run: `npm --prefix extension run build`
Expected: 成功；`detectModeration` 已导出且类型匹配。

- [ ] **Step 4: 回归既有单测（确保 content 相关 dom/comment-submit 不破）**

Run: `npm --prefix extension run test`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add extension/src/entrypoints/content.ts
git commit -m "feat(content): 新增 verify-moderation handler 委托 detectModeration"
```

---

### Task 5: FormFillEngine 接入「跳转后验证」+ 用 `VERIFIED_SUCCESS`

**Files:**
- Modify: `extension/src/agent/FormFillEngine.ts:11`（import）
- Modify: `extension/src/agent/FormFillEngine.ts:398-407`（submit 判定块）

**Interfaces:**
- Consumes: `VERIFIED_SUCCESS`（types.ts）、`verifyAfterNavigation` + `applyNavigationVerdict`（verify-after-navigation.ts，Task 3）；既有 `sendToTab`、`tabId`。
- Produces: `executeFormFill` 返回的 `FillResult.verifyResult` 对整页跳转场景准确反映 pending_moderation/unverified。被 Task 6（useFloatFill）据以 markSubmitted/markFailed。

> 核心判定逻辑 `applyNavigationVerdict` 已由 Task 3 单测；本任务为接线（真实 chrome.tabs.get / sendToTab 注入 + 调用），以 build + 手动矩阵为保证。

- [ ] **Step 1: 改 import（`FormFillEngine.ts:11`）**

把：
```ts
import type { FillEngineStatus, FillResult, SiteType, FieldValueMap, LogEntry, LogLevel, LLMFieldData, LLMFieldValue, VerifyResult } from './types'
```
改为（把 `VERIFIED_SUCCESS` 作为值导入，其余保留 `type`）：
```ts
import { VERIFIED_SUCCESS, type FillEngineStatus, type FillResult, type SiteType, type FieldValueMap, type LogEntry, type LogLevel, type LLMFieldData, type LLMFieldValue, type VerifyResult } from './types'
import { verifyAfterNavigation, applyNavigationVerdict } from './verify-after-navigation'
```

- [ ] **Step 2: 改 submit 判定块（`FormFillEngine.ts:398-407`）**

把：
```ts
				if (submitResponse?.ok) {
					submitted = submitResponse.clicked
					verifyResult = submitResponse.verifyResult
					submitError = submitResponse.error
					const verified = ['ajax', 'navigating', 'pagehide', 'cleared'].includes(submitResponse.verifyResult)
					log(
						verified ? 'success' : 'warning',
						'fill',
						`提交结果: ${submitResponse.verifyResult}${submitResponse.error ? ' - ' + submitResponse.error : ''}`,
					)
				} else {
```
改为：
```ts
				if (submitResponse?.ok) {
					submitted = submitResponse.clicked
					verifyResult = submitResponse.verifyResult
					submitError = submitResponse.error

					// 整页跳转：提交瞬间无法判定发布状态，等待页面落定后复核是否待审核
					if (verifyResult === 'navigating' || verifyResult === 'pagehide') {
						log('info', 'fill', '提交触发整页跳转，等待页面落定后复核审核状态...')
						const verdict = await verifyAfterNavigation(tabId, {
							getTabUrl: async (id) => {
								try {
									const tab = await chrome.tabs.get(id)
									return tab.url ?? ''
								} catch {
									return ''
								}
							},
							sendVerify: (id) => sendToTab<{ ok: boolean; moderation: boolean }>(
								id,
								{ type: 'FLOAT_FILL', action: 'verify-moderation' },
								2000,
							),
							sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
						})
						verifyResult = applyNavigationVerdict(verifyResult, verdict)
						if (verdict === 'moderation') submitError = '评论待审核，未发布'
						else if (verdict === 'unverified') submitError = '提交后未能确认发布状态'
					}

					const verified = VERIFIED_SUCCESS.includes(verifyResult)
					log(
						verified ? 'success' : 'warning',
						'fill',
						`提交结果: ${verifyResult}${submitError ? ' - ' + submitError : ''}`,
					)
				} else {
```

- [ ] **Step 3: build 门禁**

Run: `npm --prefix extension run build`
Expected: 成功；`VERIFIED_SUCCESS.includes(verifyResult)` 类型匹配（verifyResult 为 `VerifyResult`）。

- [ ] **Step 4: 回归单测**

Run: `npm --prefix extension run test`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add extension/src/agent/FormFillEngine.ts
git commit -m "feat(engine): 整页跳转后复核审核状态，navigating/pagehide 不再盲目判成功"
```

---

### Task 6: useFloatFill 改用 `VERIFIED_SUCCESS`

**Files:**
- Modify: `extension/src/hooks/useFloatFill.ts:2`（import）
- Modify: `extension/src/hooks/useFloatFill.ts:61`（成功判定）

**Interfaces:**
- Consumes: `VERIFIED_SUCCESS`、`VerifyResult`（types.ts）。
- Produces: 无新接口；统一成功口径，消除与 FormFillEngine 的重复白名单。

> 本任务为常量替换（低风险）。完整 chrome mock 单测属既有 TODO（见 spec §8.5），超出本改动范围；以 build + 手动矩阵为保证。

- [ ] **Step 1: 加 import（`useFloatFill.ts:2` 之后）**

现有：
```ts
import type { SiteData } from '@/lib/types'
```
在其后新增：
```ts
import { VERIFIED_SUCCESS } from '@/agent/types'
import type { VerifyResult } from '@/agent/types'
```

- [ ] **Step 2: 替换成功判定（`useFloatFill.ts:61`）**

把：
```ts
							const verified = ['ajax', 'navigating', 'pagehide', 'cleared'].includes(r.verifyResult ?? '')
```
改为：
```ts
							const verified = VERIFIED_SUCCESS.includes((r.verifyResult ?? 'not_attempted') as VerifyResult)
```

- [ ] **Step 3: build 门禁**

Run: `npm --prefix extension run build`
Expected: 成功。

- [ ] **Step 4: 回归单测**

Run: `npm --prefix extension run test`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add extension/src/hooks/useFloatFill.ts
git commit -m "refactor(useFloatFill): 成功判定改用共享 VERIFIED_SUCCESS 常量"
```

---

### Task 7: 全量验证 + 手动验证矩阵

**Files:** 无（验证任务）

- [ ] **Step 1: 全量单测**

Run: `npm --prefix extension run test`
Expected: 全绿（含新增 `verify-result` / `verify-after-navigation` 两文件 + comment-submit 新用例）。

- [ ] **Step 2: 全量 build**

Run: `npm --prefix extension run build`
Expected: 成功，无 TS 报错。

- [ ] **Step 3: 手动验证矩阵（真实站点，见 spec §9）**

加载扩展，对下列站点触发 FLOAT_FILL 自动提交，观察日志与 submissions 入库状态：

| 站点类型 | 提交结果 | 期望 verifyResult | 期望入库状态 |
|---|---|---|---|
| WP 原生（historicmotorsportshow.com） | 跳转 `?unapproved=&moderation-hash=` | `pending_moderation` | failed（不入库；已入库则被 markFailed 覆盖） |
| WP 原生（可即时发布的站点） | 跳转 `#comment-N` 无审核参数 | `navigating` | submitted |
| WP AJAX 评论 | DOM 出现 `awaiting moderation` | `pending_moderation` | failed |
| 需登录站点 | 跳转登录页 | `login_required` | failed（不变） |
| 带验证码 | 检测到 widget | `not_attempted` | failed（不变） |

- [ ] **Step 4: 若手动验证全部符合，更新计划文档状态并收尾**

在 `docs/superpowers/specs/2026-07-14-moderation-detection-design.md` 顶部把「状态：待评审」改为「状态：已实现并验证」。如本计划文件 `IMPLEMENTATION_PLAN.md` 风格，完成后可删除本计划文件（CLAUDE.md：所有阶段完成后删除计划文档）。

---

## Self-Review

**1. Spec 覆盖：**
- §4 决策（markFailed / URL+DOM / 方案A / 超时保守失败 / unverified 新值）→ Task 1（unverified）、Task 2（URL+DOM detectModeration）、Task 3（方案A 的 verifyAfterNavigation + 超时 unverified）、Task 5+6（moderation→markFailed 由 useFloatFill 据 verifyResult 落地）。✓
- §6.1 types（unverified + VERIFIED_SUCCESS）→ Task 1。✓
- §6.2 detectModeration → Task 2。✓
- §6.3 content verify-moderation handler → Task 4。✓
- §6.4 FormFillEngine 跳转后验证 + VERIFIED_SUCCESS → Task 5。✓
- §6.5 useFloatFill VERIFIED_SUCCESS → Task 6。✓
- §7 边界（AJAX 不变 / 原生待审核 / 原生已发布 / 超时 unverified / 快速路径 / 已入库覆盖 / 验证码登录不变 / directory 不变）→ Task 5（原生分支）+ 既有代码（AJAX/login/captcha/directory 不动）。✓
- §8 测试 → Task 1/2/3 单测 + Task 7 手动矩阵。✓（§8.5 useFloatFill chrome mock 明确标注超范围，与 spec 一致。）

**2. 占位符扫描：** 无 TBD/TODO/「适当处理」；每步含完整代码或确切命令。✓

**3. 类型一致性：** `VERIFIED_SUCCESS`、`detectModeration`、`verifyAfterNavigation`、`applyNavigationVerdict`、`ModerationVerdict`、`VerifyAfterNavigationDeps`、`verify-moderation` 消息/响应在各任务中签名一致；Task 5 注入的 `sendVerify` 返回 `{ok,moderation}` 与 Task 4 响应、Task 3 接口一致。✓

无返工项。

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-14-moderation-detection.md`.
