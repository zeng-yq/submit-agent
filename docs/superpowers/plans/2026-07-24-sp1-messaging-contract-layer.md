# SP-1 消息契约层（L3）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立类型化判别联合消息契约，拆过载的 `FLOAT_FILL` 为 `FILL_PROGRESS`/`TAB_COMMAND`，引入 `MessageRouter` 统一收发与 keepalive，修复 `content.ts:466` 的 `ok:true+error` 响应 bug。

**Architecture:** 新增 `src/messaging/`（L3）承载契约类型 `messages.ts` 与收发枢纽 `router.ts`。handler 不搬迁，留在 `background.ts`/`content.ts` 等原文件，仅从内联 if/else/switch 改为 `router.on(...)` 注册并改为「返回响应」风格（router 统一管 `sendResponse` + `return true`）。重命名以单一原子 commit 跨全部 sender/receiver/listener 完成，避免中间态断链。iframe postMessage 桥梁不动，仅其 6 种消息纳入类型联合。

**Tech Stack:** TypeScript（strict, strictNullChecks）、WXT（MV3 content/background/sidepanel）、Vitest + jsdom。路径别名 `@/*` → `src/*`。

## Global Constraints

- 测试命令：`pnpm test`（等同 `npx vitest run`）。基线 **304 测试 / 18 文件全绿**，每个任务结束必须维持全绿。
- 类型检查：`pnpm exec tsc --noEmit`（或 `pnpm exec wxt build`）净零新增错误。
- **行为等价**：除明确标注的 `content.ts:466` bug 修复外，不改变任何消息的业务语义，只改 type/action 命名与路由结构。
- **iframe 桥梁不动**：`content.ts:136-289`（`SA_MSG_SOURCE`、`requestIframeAnalysis`/`fillIframeFields`/`submitViaIframe`/`initRemoteCommentIframeHandlers`）保持原样；其 6 种消息仅形式化为类型。
- 提交规范：每个任务一次 commit，中文 conventional commit（如 `refactor(msg): ...`）。
- `console.log('[SA-DIAG] ...')` 调试日志：本 SP 不清理（属 SP-5 技术债），重命名时原样保留其周边代码。

---

## File Structure

| 文件 | 职责 | 任务 |
|---|---|---|
| `src/messaging/messages.ts` | 判别联合 `ExtensionMessage` + 各 type 的 payload/response 类型（纯类型，零运行时） | T1 |
| `src/messaging/router.ts` | `MessageRouter`（register/dispatch/keepalive）+ 类型化发送封装 `sendToTab`/`sendProgress`/`sendMessage` | T1 |
| `src/messaging/__tests__/router.test.ts` | router 分发/穷尽/未知/异步/异常 单测 | T1 |
| `src/entrypoints/background.ts` | if/else 链 → `router.on`；handler 改返回风格 | T2 |
| `src/entrypoints/content.ts` | switch → `router.on`；handler 改返回风格；修 `:466` | T3 |
| `src/agent/FormFillEngine.ts`、`src/hooks/useFloatFill.ts`、`src/agent/FloatButton.content.ts`、`src/hooks/useSites.ts`、`src/hooks/useProduct.ts`、`src/entrypoints/sidepanel/App.tsx` | FLOAT_FILL→新 type 重命名 + 发送封装采用 + listener 类型化 | T4/T5 |
| `src/lib/types.ts` | 删除 `MessageType`/`FloatFillAction`/`ExtMessage` 死类型（124-148） | T6 |

---

## Task 1: 创建消息契约 `messages.ts` + `router.ts` + router 单测

**Files:**
- Create: `src/messaging/messages.ts`
- Create: `src/messaging/router.ts`
- Test: `src/messaging/__tests__/router.test.ts`

**Interfaces:**
- Produces: `ExtensionMessage`（判别联合）、`FillProgressAction`、`TabCommandAction`、各类 payload/response 类型；`MessageRouter` 类（`on`/`attachRuntimeListener`/`dispatch`/`hasHandler`）；`sendToTab<R>`、`sendProgress`、`sendMessage` 发送封装。

- [ ] **Step 1: 写 `messages.ts`（契约类型）**

```ts
// src/messaging/messages.ts
import type { FormAnalysisResult } from '@/agent/FormAnalyzer'
import type { SubmitResponse } from '@/agent/comment-submit'
import type { SiteType, VerifyResult } from '@/agent/types'
import type { SiteData } from '@/lib/types'

/* ---------- FILL_PROGRESS：UI 生命周期信号（chrome.runtime.sendMessage 广播） ---------- */
export type FillProgressAction =
	| 'start' | 'progress' | 'done' | 'error'
	| 'no-product' | 'no-match' | 'reset' | 'all-done' | 'confirm'

export interface ProgressPayload {
	filled?: number
	failed?: number
	verifyResult?: VerifyResult
	message?: string
	notes?: string
	submitError?: string
}

export type FillProgressMessage = {
	type: 'FILL_PROGRESS'
	action: FillProgressAction
	payload?: ProgressPayload
}

/* ---------- TAB_COMMAND：content 指令（chrome.tabs.sendMessage 点对点） ---------- */
export type TabCommandAction =
	| 'analyze' | 'fill' | 'submit'
	| 'annotate' | 'annotate-active' | 'annotate-clear'
	| 'scroll-to-first' | 'verify-moderation'

export interface AnalyzePayload { siteType: SiteType }
export interface FillPayload { fields: Array<{ canonical_id: string; value: string; selector: string }> }
export interface SubmitPayload {
	fields: Array<{ selector: string; type?: string; effective_type?: string; name?: string; id?: string; canonical_id?: string }>
}
export interface AnnotateFieldsPayload { fields: Array<{ selector: string }> }
export interface AnnotateActivePayload { index: number }

export type TabCommandMessage =
	| { type: 'TAB_COMMAND'; action: 'analyze'; payload: AnalyzePayload }
	| { type: 'TAB_COMMAND'; action: 'fill'; payload: FillPayload }
	| { type: 'TAB_COMMAND'; action: 'submit'; payload: SubmitPayload }
	| { type: 'TAB_COMMAND'; action: 'annotate'; payload: AnnotateFieldsPayload }
	| { type: 'TAB_COMMAND'; action: 'annotate-active'; payload: AnnotateActivePayload }
	| { type: 'TAB_COMMAND'; action: 'annotate-clear' }
	| { type: 'TAB_COMMAND'; action: 'scroll-to-first'; payload: AnnotateFieldsPayload }
	| { type: 'TAB_COMMAND'; action: 'verify-moderation' }

/* ---------- 响应类型（复用既有，避免漂移） ---------- */
export interface AnalyzeResponse { ok: boolean; analysis: FormAnalysisResult; pageContent?: unknown; error?: string }
export interface FillResponse { ok: boolean; filled: number; failed: number; error?: string }
export interface SimpleResponse { ok: boolean; error?: string }
export interface VerifyModerationResponse { ok: boolean; moderation: boolean }

/* ---------- 既有单一职责 type ---------- */
export type ExtensionMessage =
	| FillProgressMessage
	| TabCommandMessage
	| { type: 'CHECK_SITE_MATCH'; payload: { url: string } }
	| { type: 'FLOAT_BUTTON_TOGGLE'; payload: { enabled: boolean } }
	| { type: 'FLOAT_ADD_SITE'; url: string }
	| { type: 'ADD_SITE'; payload: { name: string; submit_url: string; domain?: string; category: string; dr: number; notes: string } }
	| { type: 'DELETE_SITE'; payload: { siteName: string } }
	| { type: 'CLOSE_TAB' }
	| { type: 'SUBMIT_CONTROL'; action: 'open_submit_page'; payload: string }
	| { type: 'FETCH_PAGE_CONTENT'; payload: { url: string } }
	| { type: 'SUBMISSION_STATUS_CHANGED'; payload: { siteName: string; toggleState: string } }
	| { type: 'SITES_CHANGED' }
	| { type: 'PRODUCTS_CHANGED' }
	| { type: 'SITE_ADDED'; url: string }
	/* iframe（仅类型，桥梁不动） */
	| { type: 'SUBMIT_IFRAME'; commentSelector: string | null }
	| { type: 'REQUEST_IFRAME_ANALYSIS' }
	| { type: 'FILL_IFRAME_FIELDS'; fields: unknown }
	| { type: 'IFRAME_SUBMIT_RESULT'; result: unknown }
	| { type: 'IFRAME_FILL_RESULT'; result: unknown }
	| { type: 'IFRAME_ANALYSIS_RESULT'; analysis: unknown }

/** 收窄辅助：按 action 取 TAB_COMMAND 消息 */
export type TabCommandOf<A extends TabCommandAction> = Extract<TabCommandMessage, { action: A }>
/** 收窄辅助：按 action 取 FILL_PROGRESS 消息 */
export type FillProgressOf<A extends FillProgressAction> = Extract<FillProgressMessage, { action: A }>
```

- [ ] **Step 2: 写失败的 router 单测（先测后实现）**

```ts
// src/messaging/__tests__/router.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MessageRouter } from '@/messaging/router'
import type { ExtensionMessage } from '@/messaging/messages'

describe('MessageRouter', () => {
	let sendResponse: ReturnType<typeof vi.fn>
	let ctx: { sender: chrome.runtime.MessageSender; tabId?: number }

	beforeEach(() => {
		sendResponse = vi.fn()
		ctx = { sender: { tab: { id: 7 } } as chrome.runtime.MessageSender, tabId: 7 }
	})

	it('无 action 的 type 命中已注册 handler 并回传同步返回值', () => {
		const router = new MessageRouter()
		const handler = vi.fn(() => ({ ok: true }))
		router.on('CLOSE_TAB', handler)
		const ret = router.dispatch({ type: 'CLOSE_TAB' } as ExtensionMessage, ctx, sendResponse)
		expect(handler).toHaveBeenCalledOnce()
		expect(sendResponse).toHaveBeenCalledWith({ ok: true })
		expect(ret).toBeUndefined() // 同步 → 不保活
	})

	it('带 action 的 type 按 action 二级路由', () => {
		const router = new MessageRouter()
		const analyze = vi.fn(() => ({ ok: true }))
		const fill = vi.fn(() => ({ ok: true }))
		router.on('TAB_COMMAND', 'analyze', analyze)
		router.on('TAB_COMMAND', 'fill', fill)
		router.dispatch({ type: 'TAB_COMMAND', action: 'fill', payload: { fields: [] } } as ExtensionMessage, ctx, sendResponse)
		expect(fill).toHaveBeenCalledOnce()
		expect(analyze).not.toHaveBeenCalled()
	})

	it('异步 handler 返回 true 保活通道，resolve 后回传', async () => {
		const router = new MessageRouter()
		router.on('TAB_COMMAND', 'analyze', () => Promise.resolve({ ok: true, analysis: { fields: [] } }))
		const ret = router.dispatch({ type: 'TAB_COMMAND', action: 'analyze', payload: { siteType: 'blog_comment' } } as ExtensionMessage, ctx, sendResponse)
		expect(ret).toBe(true)
		await new Promise((r) => setTimeout(r, 0))
		expect(sendResponse).toHaveBeenCalledWith({ ok: true, analysis: { fields: [] } })
	})

	it('handler 抛异常被捕获，回传 error，不崩', () => {
		const router = new MessageRouter()
		router.on('CLOSE_TAB', () => { throw new Error('boom') })
		const ret = router.dispatch({ type: 'CLOSE_TAB' } as ExtensionMessage, ctx, sendResponse)
		expect(ret).toBeUndefined()
		expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ error: 'boom' }))
	})

	it('未注册 handler → 返回 undefined，不调 sendResponse', () => {
		const router = new MessageRouter()
		const ret = router.dispatch({ type: 'CLOSE_TAB' } as ExtensionMessage, ctx, sendResponse)
		expect(ret).toBeUndefined()
		expect(sendResponse).not.toHaveBeenCalled()
	})

	it('hasHandler：遍历联合判断是否每个 type 至少有一条注册（注册覆盖守门）', () => {
		// 此测试由后续任务逐步补全到所有 type 都注册；此处仅验证机制
		const router = new MessageRouter()
		expect(router.hasHandler({ type: 'CLOSE_TAB' } as ExtensionMessage)).toBe(false)
		router.on('CLOSE_TAB', () => undefined)
		expect(router.hasHandler({ type: 'CLOSE_TAB' } as ExtensionMessage)).toBe(true)
	})
})
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `pnpm test -- src/messaging/__tests__/router.test.ts`
Expected: FAIL（`Cannot find module '@/messaging/router'`）

- [ ] **Step 4: 写 `router.ts` 最小实现使测试通过**

```ts
// src/messaging/router.ts
import type { ExtensionMessage, FillProgressAction, TabCommandAction } from './messages'

export interface MsgCtx {
	sender: chrome.runtime.MessageSender
	tabId?: number
}

type Handler = (msg: any, ctx: MsgCtx) => unknown | Promise<unknown>

/** 类型化发送到 content tab，带超时；与原 FormFillEngine.sendToTab 行为等价 */
export function sendToTab<R>(tabId: number, message: ExtensionMessage, timeoutMs: number): Promise<R> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`Content script did not respond within ${timeoutMs}ms`))
		}, timeoutMs)
		chrome.tabs.sendMessage(tabId, message, (response) => {
			clearTimeout(timer)
			if (chrome.runtime.lastError) {
				reject(new Error(chrome.runtime.lastError.message))
				return
			}
			resolve(response as R)
		})
	})
}

/** 类型化广播 FILL_PROGRESS（fire-and-forget，吞错） */
export function sendProgress(action: FillProgressAction, payload?: unknown): void {
	chrome.runtime.sendMessage({ type: 'FILL_PROGRESS', action, payload }).catch(() => {})
}

/** 类型化广播任意消息 */
export function sendMessage(message: ExtensionMessage): Promise<unknown> {
	return chrome.runtime.sendMessage(message)
}

export class MessageRouter {
	private actionHandlers = new Map<string, Map<string, Handler>>()
	private simpleHandlers = new Map<string, Handler>()

	/** 注册无 action 的 type */
	on<T extends ExtensionMessage['type']>(type: T, handler: Handler): void
	/** 注册带 action 的 type（FILL_PROGRESS / TAB_COMMAND） */
	on<T extends ExtensionMessage['type']>(type: T, action: string, handler: Handler): void
	on(...args: [string, (string | Handler), Handler?]): void {
		if (args.length === 3) {
			const [type, action, handler] = args
			if (!this.actionHandlers.has(type)) this.actionHandlers.set(type, new Map())
			this.actionHandlers.get(type)!.set(action as string, handler!)
		} else {
			this.simpleHandlers.set(args[0], args[1] as Handler)
		}
	}

	/** 是否有 handler 处理该消息（注册覆盖守门用） */
	hasHandler(message: ExtensionMessage): boolean {
		const type = message.type
		if (type === 'FILL_PROGRESS' || type === 'TAB_COMMAND') {
			return this.actionHandlers.get(type)?.has((message as { action: string }).action) === true
		}
		return this.simpleHandlers.has(type)
	}

	/** 分发；返回 true 表示保活通道（异步），undefined 表示同步完成。由 onMessage listener 调用。 */
	dispatch(message: ExtensionMessage, ctx: MsgCtx, sendResponse: (r: unknown) => void): true | undefined {
		const handler = this.findHandler(message)
		if (!handler) return undefined
		try {
			const ret = handler(message, ctx)
			if (ret instanceof Promise) {
				ret.then(
					(response) => sendResponse(response),
					(err) => sendResponse({ error: err instanceof Error ? err.message : String(err) }),
				)
				return true
			}
			sendResponse(ret)
			return undefined
		} catch (err) {
			sendResponse({ error: err instanceof Error ? err.message : String(err) })
			return undefined
		}
	}

	private findHandler(message: ExtensionMessage): Handler | undefined {
		const type = message.type
		if (type === 'FILL_PROGRESS' || type === 'TAB_COMMAND') {
			return this.actionHandlers.get(type)?.get((message as { action: string }).action)
		}
		return this.simpleHandlers.get(type)
	}

	/** 绑定到 chrome.runtime.onMessage，内部统一管 sendResponse + return true */
	attachRuntimeListener(): void {
		chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
			const ctx: MsgCtx = { sender, tabId: sender.tab?.id }
			return this.dispatch(message as ExtensionMessage, ctx, sendResponse)
		})
	}
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `pnpm test -- src/messaging/__tests__/router.test.ts`
Expected: PASS（6 tests）

- [ ] **Step 6: tsc 校验**

Run: `pnpm exec tsc --noEmit`
Expected: 净零新增错误（新文件不应引入错误；既有 13 项基线保持）。

- [ ] **Step 7: 提交**

```bash
git add src/messaging/
git commit -m "feat(msg): 新增消息契约层 messages.ts 与 MessageRouter（L3）

- messages.ts：判别联合 ExtensionMessage + FILL_PROGRESS/TAB_COMMAND 分类
- router.ts：register/dispatch/keepalive 统一 + 类型化 sendToTab/sendProgress
- router.test.ts：分发/二级路由/异步保活/异常隔离/注册覆盖 6 例"
```

---

## Task 2: `background.ts` if/else 链迁移到 `MessageRouter`

**Files:**
- Modify: `src/entrypoints/background.ts:6-41`（onMessage listener）、各 `handleXxx` 函数（改为返回响应风格）

**Interfaces:**
- Consumes: `MessageRouter`、`ExtensionMessage`（来自 T1）
- Produces: background 侧 handler 全部经 `router.on(...)` 注册；FLOAT_FILL 名暂保留（T4 统一改名）。

**迁移要点**：原 handler 都是 `(message, sendResponse) => { ... sendResponse(x); return true/undefined }`。改为 `(msg, ctx) => { ...; return x }`，由 router 统一调 `sendResponse` + 判保活。异步 handler 直接返回 Promise。

- [ ] **Step 1: 改写 `background.ts` 的 listener 与 handler 注册**

将 `src/entrypoints/background.ts:11-40` 的整个 `chrome.runtime.onMessage.addListener((message, sender, sendResponse) => { if/else 链 })` 替换为：

```ts
	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
		const ctx: MsgCtx = { sender, tabId: sender.tab?.id }
		return router.dispatch(message as ExtensionMessage, ctx, sendResponse)
	})
```

在 `defineBackground` 内、listener 之前实例化 router 并调用模块级注册函数：

```ts
	const router = new MessageRouter()
	registerBackgroundHandlers(router)
```

并把原 if/else 各分支抽成**模块级**注册函数（导出，供 T6 单测调用）。handler 体抽成具名函数，逻辑等价：

```ts
// 文件模块级（defineBackground 之外）
export function registerBackgroundHandlers(router: MessageRouter): void {
	router.on('SUBMIT_CONTROL', (msg, ctx) => handleSubmitControl(msg as any, ctx))
	router.on('FETCH_PAGE_CONTENT', (msg) => handleFetchPageContent(msg as any))
	router.on('FLOAT_BUTTON_TOGGLE', (msg) => handleFloatButtonToggle(msg as any))
	router.on('FLOAT_FILL', (msg, ctx) => handleFloatFill(msg as any, ctx))
	router.on('SUBMISSION_STATUS_CHANGED', (msg, ctx) => handleSubmissionStatusChanged(msg as any, ctx))
	router.on('CHECK_SITE_MATCH', (msg) => handleCheckSiteMatch(msg as any))
	router.on('DELETE_SITE', (msg) => handleDeleteSite(msg as any))
	router.on('FLOAT_ADD_SITE', (msg, ctx) => handleFloatAddSite(msg as any, ctx))
	router.on('ADD_SITE', (msg) => handleAddSite(msg as any))
	router.on('CLOSE_TAB', (_msg, ctx) => {
		if (ctx.tabId != null) chrome.tabs.remove(ctx.tabId).catch(() => {})
	})
	// STATUS_UPDATE：T6 确认无发送方后删除；SITE_ADDED 仅 bg 发送（无需 bg handler）
}
```

> import：在文件顶部加 `import { MessageRouter, type MsgCtx } from '@/messaging/router'`、`import type { ExtensionMessage } from '@/messaging/messages'`。

- [ ] **Step 2: 把各 handler 改为「返回响应」风格**

逐个改写（保留原业务逻辑，仅去掉手写的 `sendResponse(...)`/`return true`，改为 `return` 值或 Promise）：

- `handleSubmitControl`：内部 `sendResponse({ error })` → `return { error }`；`sendResponse({ ok:true, tabId })` → `return { ok:true, tabId }`；async IIFE 改为直接 `async` 函数体（函数本身已是 `=> true | undefined`，改为 `async (msg, ctx) => { ... return { ok:true, tabId } }`）。签名改为 `(message, _ctx: MsgCtx)`。
- `handleFetchPageContent`：已是 `return true` 包 `run()`；改为 `async (message) => { ...; return { ok:true, analysis, pageContent } }`（把 `run()` 的 sendResponse 调用改为 `return`，cleanup 在 finally）。
- `handleFloatButtonToggle`：`sendResponse({ok:true})` → `return { ok:true }`；函数改 `async`。
- `handleFloatFill`：当前返回 `{ ok:true }` 并广播；改为 `async (message, ctx) => { ...原逻辑...; return { ok:true } }`（保留 `chrome.storage.session.set` / `chrome.sidePanel.open` / 广播副作用）。
- `handleCheckSiteMatch`：改为 `async`，`sendResponse(...)` → `return ...`。
- `handleDeleteSite` / `handleAddSite`：同理改 `async` + `return`。
- `handleFloatAddSite`：`return { ok:true }`。
- `handleStatusUpdate`、`handleSubmissionStatusChanged`：保留副作用（广播），返回 `undefined`（不响应）。注意 `handleStatusUpdate` 原 `STATUS_UPDATE` 分支 T6 会处理，先保留函数。
- `CLOSE_TAB`：已在注册处内联（见 Step 1），删除原 `else if (message.type === 'CLOSE_TAB')` 内联体。

> 关键：原 listener 的 `default: sendResponse({ error: 'Unknown message type' })` 不再需要——router 对未注册 type 返回 undefined（不响应），行为等价（调用方本就不依赖该 error）。

- [ ] **Step 3: 运行全量测试**

Run: `pnpm test`
Expected: 304 测试全绿（background 无直接单测，靠既有测试不回归 + 下一步手动验证）。

- [ ] **Step 4: tsc 校验**

Run: `pnpm exec tsc --noEmit`
Expected: 净零新增错误。若有「`handleXxx` 已声明但未使用」警告，确认是被 router.on 引用（应是）。

- [ ] **Step 5: 手动验证（交付用户）**

加载 `extension/dist/chrome-mv3`（先 `pnpm build`），在真实页面：
- 点浮动按钮 → sidepanel 打开（验证 FLOAT_FILL start 经 router）。
- sidepanel 触发填充 → 字段高亮 + 填值（验证 TAB_COMMAND analyze/fill 经 router 转发到 content）。
- 设置面板开关浮动按钮 → 按钮显隐（FLOAT_BUTTON_TOGGLE）。
- 悬浮按钮删除已知外链 → tab 关闭（DELETE_SITE + CLOSE_TAB）。

Expected: 与改造前行为一致。

- [ ] **Step 6: 提交**

```bash
git add src/entrypoints/background.ts
git commit -m "refactor(msg): background if/else 链迁移到 MessageRouter

handler 改为返回响应风格，由 router 统一管 sendResponse + keepalive；
FLOAT_FILL 名暂保留，T4 统一改名。"
```

---

## Task 3: `content.ts` switch 迁移到 `MessageRouter` + 修复 `:466` bug

**Files:**
- Modify: `src/entrypoints/content.ts:311-480`（onMessage switch → router 注册）、`:466`（iframe 超时响应 bug）

**Interfaces:**
- Consumes: `MessageRouter`、`ExtensionMessage`、`TabCommandOf`（来自 T1）
- Produces: content 侧 8 个 action 全部经 `router.on('FLOAT_FILL', action, handler)` 注册（T4 改名为 TAB_COMMAND）；handler 改返回风格。

- [ ] **Step 1: 用 `router.on` 替换 `content.ts:311-480` 的 listener + switch**

在 `main()` 内把原 `chrome.runtime.onMessage.addListener` 整块（311-480）替换为：

```ts
		const router = new MessageRouter()
		registerContentHandlers(router)
		router.attachRuntimeListener()
```

并把 8 个 handler 注册抽成**模块级**导出函数（供 T6 单测；handler 引用的 analyzeForms/fillAndVerify/executeSubmit 等均为模块级 import，提取无障碍）：

```ts
// 文件模块级（defineContentScript 之外）
export function registerContentHandlers(router: MessageRouter): void {
	router.on('FLOAT_FILL', 'analyze', async (msg) => {
			const siteType = (msg as { payload?: { siteType?: string } }).payload?.siteType
			await waitForFormFields()
			await expandLazyCommentForms(document)
			const analysis = analyzeForms(document)
			if (isRemoteCommentSystem(analysis.commentSystem?.name) && analysis.fields.length === 0) {
				const iframe = document.querySelector<HTMLIFrameElement>(REMOTE_COMMENT_IFRAME_SELECTORS)
				if (iframe) {
					iframe.scrollIntoView({ block: 'center' })
					const iframeAnalysis = await requestIframeAnalysis(iframe)
					if (iframeAnalysis) analysis.fields = iframeAnalysis.fields
				}
			}
			if (siteType === 'blog_comment') {
				return { ok: true, analysis, pageContent: extractPageContent(document) }
			}
			return { ok: true, analysis }
		})

		router.on('FLOAT_FILL', 'fill', async (msg) => {
			const fields = (msg as { payload?: { fields?: Array<{ canonical_id: string; value: string; selector: string }> } }).payload?.fields
			if (!fields) return { ok: false, error: 'No fields provided' }
			let filled = 0
			let failed = 0
			const remoteIframe = document.querySelector<HTMLIFrameElement>(REMOTE_COMMENT_IFRAME_SELECTORS)
			if (remoteIframe) {
				const result = await fillIframeFields(remoteIframe, fields)
				filled += result.filled
				failed += result.failed
			} else {
				for (const field of fields) {
					try {
						const el = document.querySelector(field.selector)
						if (el) (await fillAndVerify(el as HTMLElement, field.value)) ? filled++ : failed++
						else failed++
					} catch { failed++ }
				}
			}
			return { ok: true, filled, failed }
		})

		router.on('FLOAT_FILL', 'annotate', (msg) => {
			const fields = (msg as { payload?: { fields?: Array<{ selector: string }> } }).payload?.fields
			if (fields) annotateFields(fields)
			return { ok: true }
		})

		router.on('FLOAT_FILL', 'annotate-active', (msg) => {
			const index = (msg as { payload?: { index?: number } }).payload?.index
			if (typeof index === 'number') annotateActive(index)
			return { ok: true }
		})

		router.on('FLOAT_FILL', 'annotate-clear', () => { clearAnnotations(); return { ok: true } })

		router.on('FLOAT_FILL', 'scroll-to-first', (msg) => {
			const fields = (msg as { payload?: { fields?: Array<{ selector: string }> } }).payload?.fields
			if (fields && fields.length > 0) {
				const firstEl = document.querySelector(fields[0].selector)
				if (firstEl) (firstEl as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' })
			}
			return { ok: true }
		})

		router.on('FLOAT_FILL', 'verify-moderation', () => ({ ok: true, moderation: detectModeration() }))

		router.on('FLOAT_FILL', 'submit', async (msg) => {
			const fields = (msg as { payload?: { fields?: Array<{ selector: string; type?: string; effective_type?: string; name?: string; id?: string; canonical_id?: string }> } }).payload?.fields
			try {
				const commentField = fields?.find((f) =>
					f.type === 'textarea'
					|| f.effective_type === 'comment'
					|| /comment|reply|message/i.test(`${f.canonical_id ?? ''} ${f.name ?? ''} ${f.id ?? ''}`)
				)
				const commentSelector = commentField?.selector ?? null
				const remoteIframe = document.querySelector<HTMLIFrameElement>(REMOTE_COMMENT_IFRAME_SELECTORS)
				if (remoteIframe) {
					const r = await submitViaIframe(remoteIframe, commentSelector)
					// 【bug 修复】iframe 超时（submitViaIframe 返回 null）：原返回 ok:true+not_attempted
					// 会让 runSubmitAndVerify 跳过跨页复核。改为 verifyResult:'navigating' 命中
					// FormFillEngine.ts:189 的跨页验证分支（与 resolveLostSignal 用 navigating 表达
					// "经导航验证"的既有语义一致），给跨页复核一次机会。
					return r ?? { ok: true, clicked: true, verifyResult: 'navigating' as VerifyResult, error: '跨域 iframe 提交超时，转入跨页面验证' }
				}
				return await executeSubmit(commentSelector)
			} catch (err) {
				return { ok: false, error: err instanceof Error ? err.message : String(err) }
			}
		})
}
```

> import 补充：`import { MessageRouter } from '@/messaging/router'`。删除原 `chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => { ... })` 整块（311-480）。

- [ ] **Step 2: 确认 `:466` bug 修复已包含在上面的 submit handler**

核对：原 `:466` 的 `r ?? { ok: true, clicked: false, verifyResult: 'not_attempted', error: '跨域 iframe 提交超时，请手动提交' }` 已替换为 `r ?? { ok: true, clicked: true, verifyResult: 'navigating', error: '跨域 iframe 提交超时，转入跨页面验证' }`。

- [ ] **Step 3: 运行全量测试**

Run: `pnpm test`
Expected: 304 测试全绿。

- [ ] **Step 4: 补 `:466` 修复的回归说明测试（在 submit-flow.test.ts 加 1 例）**

在 `src/__tests__/submit-flow.test.ts` 末尾 `describe` 内追加（验证 navigating 响应会触发 verifyNavigation，保护此次修复不被回退）：

```ts
	it('submit 返回 navigating（如 iframe 超时经修复）→ 触发 verifyNavigation 复核', async () => {
		const verifyNavigation = vi.fn().mockResolvedValue('confirmed')
		const r = await runSubmitAndVerify({
			sendSubmit: vi.fn().mockResolvedValue(ok({ clicked: true, verifyResult: 'navigating' })),
			verifyNavigation,
		})
		expect(verifyNavigation).toHaveBeenCalledOnce()
		expect(VERIFIED_SUCCESS).toContain(r.verifyResult)
	})
```

> 注：此测试覆盖的是 runSubmitAndVerify 的 navigating→verifyNavigation 路径（即 `:466` 修复所依赖的入口），确保 content.ts 返回 navigating 后上层确实会复核。content.ts 的 submit handler 本身是 onMessage 内 IIFE，无法直接单测（提取为可测单元属 SP-2/SP-4），故以路径覆盖 + 手动验证兜底。

- [ ] **Step 5: 运行测试确认新例通过**

Run: `pnpm test -- src/__tests__/submit-flow.test.ts`
Expected: PASS（原 7 例 + 新 1 例 = 8 例）

- [ ] **Step 6: tsc 校验**

Run: `pnpm exec tsc --noEmit`
Expected: 净零新增错误。

- [ ] **Step 7: 提交**

```bash
git add src/entrypoints/content.ts src/__tests__/submit-flow.test.ts
git commit -m "refactor(msg): content switch 迁移到 MessageRouter；修复 iframe 超时响应 bug

- 8 个 action 改为 router.on 注册，handler 返回响应风格
- :466 iframe 超时由 ok:true+not_attempted 改为 verifyResult:navigating
  命中跨页验证分支，与顶层跳转路径对称
- 补 submit-flow 回归测试 1 例"
```

---

## Task 4: 原子重命名 `FLOAT_FILL` → `FILL_PROGRESS` / `TAB_COMMAND`

**Files:**
- Modify: `src/agent/FormFillEngine.ts`（10 处发送）
- Modify: `src/hooks/useFloatFill.ts`（~13 处发送 + 1 处监听）
- Modify: `src/agent/FloatButton.content.ts`（1 处发送 + 1 处监听）
- Modify: `src/entrypoints/background.ts`（router.on 的 FLOAT_FILL 注册 + handleFetchPageContent 内 analyze 发送）
- Modify: `src/entrypoints/content.ts`（router.on 的 FLOAT_FILL 注册）

**Interfaces:**
- Consumes: `FillProgressAction`、`TabCommandAction`、`sendToTab`、`sendProgress`（来自 T1）
- Produces: 代码中 `FLOAT_FILL` 字面量归零；sender 采用类型化发送封装。

> **原子性**：本任务必须单一 commit 完成全部 sender + receiver + listener 改名，否则中间态消息断链。每个文件按下面的映射表替换。

**映射表**（action → 新 type）：

| action | 新 type | 所在文件:行（基线） |
|---|---|---|
| `start` | `FILL_PROGRESS` | FloatButton:579、useFloatFill:118(监听) |
| `progress` | `FILL_PROGRESS` | FormFillEngine:268、useFloatFill:54,149 |
| `done` | `FILL_PROGRESS` | FormFillEngine:514 |
| `error` | `FILL_PROGRESS` | FormFillEngine:533、useFloatFill:68,76,82,91,157,162 |
| `no-product` | `FILL_PROGRESS` | useFloatFill:42 |
| `no-match` | `FILL_PROGRESS` | useFloatFill:170 |
| `reset` | `FILL_PROGRESS` | useFloatFill:39,87 |
| `analyze` | `TAB_COMMAND` | FormFillEngine:230、background:147 |
| `annotate` | `TAB_COMMAND` | FormFillEngine:272 |
| `annotate-active` | `TAB_COMMAND` | FormFillEngine:417 |
| `scroll-to-first` | `TAB_COMMAND` | FormFillEngine:280 |
| `fill` | `TAB_COMMAND` | FormFillEngine:426 |
| `submit` | `TAB_COMMAND` | FormFillEngine:455 |
| `verify-moderation` | `TAB_COMMAND` | FormFillEngine:481 |
| router 注册 `FLOAT_FILL` | content/background 的 `router.on('FLOAT_FILL', ...)` | content.ts、background.ts |

- [ ] **Step 1: `FormFillEngine.ts` 改名 + 采用类型化发送**

逐处替换（示例）：
- `:230` `const analyzeMsg = { type: 'FLOAT_FILL', action: 'analyze', payload: analyzePayload }` → 删除 analyzeMsg，改用 `await sendToTab<AnalyzeResponse>(tabId, { type: 'TAB_COMMAND', action: 'analyze', payload: analyzePayload }, ANALYZE_TIMEOUT_MS)`。import：`import { sendToTab, sendProgress } from '@/messaging/router'`、`import type { AnalyzeResponse, FillResponse, VerifyModerationResponse } from '@/messaging/messages'`。删除文件内私有 `sendToTab`（125-140），改用从 router 导入的。
- `:268` `chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'progress' })` → `sendProgress('progress')`
- `:272-276` annotate → `{ type: 'TAB_COMMAND', action: 'annotate', payload: { fields: ... } }`（经 `sendToTab`）
- `:280` scroll-to-first → `{ type: 'TAB_COMMAND', action: 'scroll-to-first', ... }`
- `:417` annotate-active → `{ type: 'TAB_COMMAND', action: 'annotate-active', payload: { index: i } }`
- `:426` fill → `{ type: 'TAB_COMMAND', action: 'fill', payload: { fields: [field] } }`
- `:455` submit → `{ type: 'TAB_COMMAND', action: 'submit', payload: { fields: ... } }`
- `:481` verify-moderation → `{ type: 'TAB_COMMAND', action: 'verify-moderation' }`
- `:514` done → `sendProgress('done')`
- `:533` error → `sendProgress('error')`

> `runSubmitAndVerify` 的 `sendSubmit`/`verifyNavigation` 闭包内 `sendToTab` 改用导入的类型化版本（签名一致，`sendToTab<SubmitResponse>(tabId, msg, 20_000)`）。

- [ ] **Step 2: `useFloatFill.ts` 改名**

所有 `chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: X })` → `sendProgress(X)`（X ∈ reset/no-product/progress/error/no-match）。import：`import { sendProgress } from '@/messaging/router'`。
监听 `:118` `if (message.type === 'FLOAT_FILL' && message.action === 'start')` → `if (message.type === 'FILL_PROGRESS' && message.action === 'start')`。
`STATUS_UPDATE` 监听（:122）保持不变（T6 处理）。

- [ ] **Step 3: `FloatButton.content.ts` 改名**

- `:579` `sendMessageWithRetry({ type: 'FLOAT_FILL', action: 'start' })` → `sendMessageWithRetry({ type: 'FILL_PROGRESS', action: 'start' })`
- `:693` `if (message.type === 'FLOAT_FILL')` → `if (message.type === 'FILL_PROGRESS')`

- [ ] **Step 4: `background.ts` router 注册 + handleFetchPageContent 改名**

- T2 中 `router.on('FLOAT_FILL', ...)` → 该 handler 处理的是 `start`（FILL_PROGRESS）。改为 `router.on('FILL_PROGRESS', 'start', (msg, ctx) => handleFloatFill(msg, ctx))`。其余 FILL_PROGRESS action（progress/done/error/...）background 仅做转发广播——核对 `handleFloatFill` 逻辑：原代码对所有非 start 的 FLOAT_FILL 也走广播 + 转发。改造后，为这些 action 注册同一转发 handler：`for (const a of ['progress','done','error','no-product','no-match','reset','all-done','confirm'] as const) router.on('FILL_PROGRESS', a, forwardingHandler)`，`forwardingHandler` 只做 `chrome.runtime.sendMessage(msg).catch(()=>{})` + 按 ctx/floatFillTabId 转发到 content tab（保留原 `:233-246` 逻辑）。
- `:147`（handleFetchPageContent 内）`{ type: 'FLOAT_FILL', action: 'analyze', payload: { siteType: 'blog_comment' } }` → `{ type: 'TAB_COMMAND', action: 'analyze', payload: { siteType: 'blog_comment' } }`

- [ ] **Step 5: `content.ts` router 注册改名**

T3 中 `router.on('FLOAT_FILL', action, handler)` 8 处 → `router.on('TAB_COMMAND', action, handler)`（analyze/fill/submit/annotate/annotate-active/annotate-clear/scroll-to-first/verify-moderation 全部）。

- [ ] **Step 6: 全量 grep 验证 FLOAT_FILL 归零**

Run: `grep -rn "FLOAT_FILL" src`
Expected: **无输出**（FLOAT_FILL 字面量在 src 下完全消失；iframe 的 6 种消息本就不叫 FLOAT_FILL）。

- [ ] **Step 7: 运行全量测试**

Run: `pnpm test`
Expected: 304 + T3 新增 1 = 305 测试全绿。

- [ ] **Step 8: tsc 校验**

Run: `pnpm exec tsc --noEmit`
Expected: 净零新增错误。若 FormFillEngine 删除私有 sendToTab 后有残留引用，清理。

- [ ] **Step 9: 手动验证（交付用户）**

`pnpm build` 后加载扩展，真实 WP 博客站点跑完整链路：浮动按钮 → sidepanel → 分析 → 填充 → 高亮 → 提交 → 三态更新。Expected: 与改造前一致。

- [ ] **Step 10: 提交**

```bash
git add src/agent/FormFillEngine.ts src/hooks/useFloatFill.ts src/agent/FloatButton.content.ts src/entrypoints/background.ts src/entrypoints/content.ts
git commit -m "refactor(msg): FLOAT_FILL 原子拆分为 FILL_PROGRESS + TAB_COMMAND

- UI 信号 → FILL_PROGRESS（runtime 广播），采用 sendProgress 封装
- content 指令 → TAB_COMMAND（tabs 点对点），采用类型化 sendToTab
- sender/receiver/listener 单 commit 同步改名，消除 background 三向转发歧义"
```

---

## Task 5: listener 类型化（消灭 `any` 消息参数）

**Files:**
- Modify: `src/agent/FloatButton.content.ts:687`（onMessage listener）
- Modify: `src/hooks/useFloatFill.ts:117`（handler 参数）
- Modify: `src/hooks/useSites.ts:42`（handler 参数）
- Modify: `src/hooks/useProduct.ts:49`（handler 参数）
- Modify: `src/entrypoints/sidepanel/App.tsx:187`（handler 参数）

**Interfaces:**
- Consumes: `ExtensionMessage` 及其收窄类型（来自 T1）

> 现状：所有 listener 的 `handler = (message: any) => { if (message.type === 'X') ... }`。改为 `(message: ExtensionMessage)`，访问 payload 时用类型收窄。

- [ ] **Step 1: `FloatButton.content.ts` listener 类型化**

`:687` 的 `chrome.runtime.onMessage.addListener((message) => {` → 参数标注 `(message: ExtensionMessage)`。内部 `message.enabled`、`message.payload`、`message.url` 访问因联合收窄已类型安全（FLOAT_BUTTON_TOGGLE → payload.enabled；SUBMISSION_STATUS_CHANGED → payload.siteName/toggleState；SITE_ADDED → url；FILL_PROGRESS → action）。import：`import type { ExtensionMessage } from '@/messaging/messages'`。

- [ ] **Step 2: `useFloatFill.ts` handler 类型化**

`:117` `(message: any)` → `(message: ExtensionMessage)`。`message.payload`（STATUS_UPDATE 分支）——STATUS_UPDATE 尚未在联合中（T6 处理），此处先用 `as` 局部收窄并加 `// TODO(T6): STATUS_UPDATE 死消息清理` 注释，或扩展联合临时纳入。**决策**：T6 会清理 STATUS_UPDATE，本步先保留 `message: any` 于该单分支、其余分支类型化——为避免半残，直接在 T6 一并处理 STATUS_UPDATE，本步只类型化 FILL_PROGRESS 分支（`message.type === 'FILL_PROGRESS'` 时 message 已收窄）。handler 签名改 `ExtensionMessage`，STATUS_UPDATE 分支内 `(message as { payload?: { status?: string; tabUrl?: string } }).payload`。

- [ ] **Step 3: `useSites.ts` / `useProduct.ts` handler 类型化**

- useSites `:42` `(message: any)` → `(message: ExtensionMessage)`；`message.type === SITES_CHANGED` 收窄为 `{ type: 'SITES_CHANGED' }`，无 payload 访问，直接类型安全。
- useProduct `:49` 同理（PRODUCTS_CHANGED 无 payload）。

- [ ] **Step 4: `sidepanel/App.tsx` handler 类型化**

`:187` `(message: any)` → `(message: ExtensionMessage)`；`message.type === 'FLOAT_ADD_SITE'` 收窄后 `message.url` 类型安全。

- [ ] **Step 5: 运行全量测试**

Run: `pnpm test`
Expected: 305 测试全绿。

- [ ] **Step 6: tsc 校验**

Run: `pnpm exec tsc --noEmit`
Expected: 净零新增错误。确认 `(message: any)` 在上述 5 文件已消除（grep `message: any` 应大幅减少）。

- [ ] **Step 7: 提交**

```bash
git add src/agent/FloatButton.content.ts src/hooks/useFloatFill.ts src/hooks/useSites.ts src/hooks/useProduct.ts src/entrypoints/sidepanel/App.tsx
git commit -m "refactor(msg): listener 消息参数类型化为 ExtensionMessage

消灭 5 处 handler 的 any 参数，联合收窄后 payload 访问类型安全。"
```

---

## Task 6: 删除死类型 + 清理死消息 + 收尾

**Files:**
- Modify: `src/lib/types.ts:123-148`（删除 MessageType/FloatFillAction/ExtMessage）
- Modify: `src/entrypoints/background.ts`（STATUS_UPDATE handler 决策）
- Modify: `src/hooks/useFloatFill.ts`（STATUS_UPDATE 监听决策）
- Test: `src/messaging/__tests__/router.test.ts`（补全注册覆盖测试）

**Interfaces:**
- Consumes: 全部前置任务。

- [ ] **Step 1: 确认死消息现状**

Run: `grep -rn "STATUS_UPDATE\|SUBMIT_CONTROL\|SITE_ADDED" src --include="*.ts" --include="*.tsx"`
逐个判断：
- `SUBMIT_CONTROL`：有发送方（sidepanel App.tsx SUBMIT_CONTROL open_submit_page）+ background handler。**非死**，保留。
- `SITE_ADDED`：background:414 发送，FloatButton:729 监听。**非死**，保留。
- `STATUS_UPDATE`：background:20 handler（转发）+ useFloatFill:122 监听。**需查发送方**——grep content.ts 无 STATUS_UPDATE 发送。若无发送方 → 死消息，删除 background handler（:20 分支 + handleStatusUpdate 函数）+ useFloatFill:122-133 监听分支。

> 若 Step 1 发现 STATUS_UPDATE 仍有发送方（如动态注入），则保留并在 messages.ts 已纳入联合（已纳入？检查：当前联合**未含 STATUS_UPDATE**——T1 联合没有它）。决策：STATUS_UPDATE 不在联合中，说明它是被遗漏的死消息。删除 background 的 STATUS_UPDATE handler 与 useFloatFill 的监听分支。

- [ ] **Step 2: 删除 STATUS_UPDATE 死代码**

- `background.ts`：移除 `router.on` 中对 STATUS_UPDATE 的处理（T2 中已注释未注册）+ 删除 `handleStatusUpdate` 函数（:252-262）。
- `useFloatFill.ts`：删除 `:122-133` 的 `if (message.type === 'STATUS_UPDATE') { ... }` 整块。

- [ ] **Step 3: 删除 `lib/types.ts` 死类型**

删除 `src/lib/types.ts:123-148` 的 `MessageType`、`FloatFillAction`、`ExtMessage` 三段（含注释）。先 grep 确认零引用：

Run: `grep -rn "MessageType\|FloatFillAction\|ExtMessage" src`
Expected: 仅命中 `lib/types.ts` 自身（定义处）。确认后删除。

- [ ] **Step 4: 补全 router 注册覆盖测试**

T2/T3 已把 background/content 的 handler 注册抽成 `registerBackgroundHandlers`/`registerContentHandlers` 导出函数。在 `src/messaging/__tests__/router.test.ts` 新增一个测试文件（或并入 router.test.ts），直接调用它们断言注册覆盖：

```ts
// src/messaging/__tests__/registration.test.ts
import { describe, it, expect } from 'vitest'
import { MessageRouter } from '@/messaging/router'
import { registerContentHandlers } from '@/entrypoints/content'
import { registerBackgroundHandlers } from '@/entrypoints/background'
import type { ExtensionMessage } from '@/messaging/messages'

describe('handler 注册覆盖', () => {
	it('content 侧 TAB_COMMAND 全部 action 已注册', () => {
		const router = new MessageRouter()
		registerContentHandlers(router)
		const actions = ['analyze','fill','submit','annotate','annotate-active','annotate-clear','scroll-to-first','verify-moderation'] as const
		for (const a of actions) {
			expect(router.hasHandler({ type: 'TAB_COMMAND', action: a } as ExtensionMessage)).toBe(true)
		}
	})

	it('background 侧单一职责 type 已注册', () => {
		const router = new MessageRouter()
		registerBackgroundHandlers(router)
		const types = ['SUBMIT_CONTROL','FETCH_PAGE_CONTENT','FLOAT_BUTTON_TOGGLE','FILL_PROGRESS','CHECK_SITE_MATCH','DELETE_SITE','FLOAT_ADD_SITE','ADD_SITE','CLOSE_TAB'] as const
		for (const t of types) {
			// FILL_PROGRESS 是 action-type，用 start 探测
			const probe = (t === 'FILL_PROGRESS' ? { type: 'FILL_PROGRESS', action: 'start' } : { type: t }) as ExtensionMessage
			expect(router.hasHandler(probe)).toBe(true)
		}
	})
})
```

> 说明：`registerContentHandlers`/`registerBackgroundHandlers` 仅做注册（handler 体是闭包，调用时不会执行 DOM/chrome 副作用），故可在 jsdom 单测中安全调用。新增 `ExtensionMessage` type 成员时，若忘记在某侧注册，本测试或 compiler（dispatch assertNever）会暴露——对应 spec §2.4 的"注册覆盖（测试期保证）"。
>
> **import 副作用注意**：从 `@/entrypoints/background`、`@/entrypoints/content` 导入会触发其模块级求值。WXT 的 `defineBackground`/`defineContentScript` 是注册辅助，**不在 import 时执行回调**（回调由构建产物的 bootstrap 调用），故模块级仅有函数定义与常量，无 chrome 调用。若实际运行时发现 import 触发了 chrome 副作用（如 define 回调被立即执行），则在 `vitest.config.ts` 的 `setupFiles` 中 mock `chrome` 全局，或将注册函数迁至不带 define 的 `src/messaging/handlers/*.ts`（属可选优化，非本 SP 必需）。

- [ ] **Step 5: 运行全量测试**

Run: `pnpm test`
Expected: 全绿（含新覆盖测试）。

- [ ] **Step 6: 终态校验（对照 spec §6 验收标准）**

- Run: `grep -rn "FLOAT_FILL" src` → 无输出 ✅
- Run: `grep -rn "MessageType\|FloatFillAction\|ExtMessage" src` → 无输出 ✅
- Run: `pnpm exec tsc --noEmit` → 净零新增错误 ✅
- Run: `pnpm test` → 全绿 ✅
- 确认 `messages.ts` 新增 type 时 dispatch 的 assertNever/compiler 约束生效（router.on 未注册 → hasHandler false，测试可捕获）✅

- [ ] **Step 7: 手动验证（交付用户）**

`pnpm build` + 加载扩展，完整跑：浮动按钮触发、WP 评论自动提交、Blogger 跨域 iframe 提交（验证桥梁未受影响）、删除外链、开关浮动按钮。Expected: 全链路与改造前一致；iframe 超时场景现在会触发跨页验证（可在 Blogger 站点观察日志 "转入跨页面验证"）。

- [ ] **Step 8: 提交**

```bash
git add src/lib/types.ts src/entrypoints/background.ts src/hooks/useFloatFill.ts src/entrypoints/content.ts src/messaging/__tests__/router.test.ts
git commit -m "refactor(msg): 删除死类型与死消息，补注册覆盖测试

- 删 lib/types.ts 的 MessageType/FloatFillAction/ExtMessage（零引用）
- 删 STATUS_UPDATE 死 handler 与监听（无发送方）
- content/background handler 注册抽为可测函数，补注册覆盖测试"
```

---

## Self-Review 笔记

**Spec 覆盖核对**：
- G1 类型化契约 → T1 messages.ts + T4/T5 采用 ✅
- G2 拆 FLOAT_FILL → T4 ✅
- G3 MessageRouter → T1 创建 + T2(bg)/T3(content) 采用 ✅
- G4 修 :466 → T3 Step 2 ✅
- G5 清死类型/死消息 → T6 ✅
- 测试策略 → T1 router 测试、T3 回归测试、T6 注册覆盖测试 ✅
- 非目标（iframe 桥梁不动）→ 全程未触 content.ts:136-289 ✅

**风险点已处理**：
- 重命名原子性 → T4 单 commit + grep 守门 ✅
- :466 修复可测性 → 以 runSubmitAndVerify navigating 路径覆盖（content handler 不可单测，SP-2/SP-4 再提取）✅ 已诚实标注
- STATUS_UPDATE 死消息 → T6 Step 1 先 grep 确认再删 ✅

**后续 SP 衔接**：T4 的类型化 `sendToTab`/`sendProgress` 为 SP-2 拆 `executeFormFill` + DI 提供 IPC seam；T2/T3 抽出的 `registerContentHandlers`/`registerBackgroundHandlers` 为 SP-4 拆 FloatButton 提供可测注册范式。
