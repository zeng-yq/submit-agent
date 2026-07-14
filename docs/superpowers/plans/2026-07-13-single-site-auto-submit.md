# 单站自动提交 + 验证 + 验证成功才入库 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `blog_comment` 站点上，浮动按钮触发后 LLM 填完表单 → 自动点击提交 → 弱验证 → 验证通过才 `markSubmitted`。

**Architecture:** 新增纯 DOM 模块 `agent/comment-submit.ts`（从 autoComment 搬运、改写为 TS，含 `resolveSubmitButton` / `performClick` / `waitForSubmitOrNavigate` 等），由 `content.ts` 的新 `submit` case 调用；`FormFillEngine` 在填写后增加 Step 5（仅 blog_comment）发 submit 消息并回填 `FillResult.verifyResult`；`useFloatFill` 入库时按 siteType 分支——blog_comment 以验证结果为准，directory 维持原逻辑。

**Tech Stack:** WXT + React 19 + TypeScript + Vitest(jsdom) + idb。构建 `wxt build`，测试 `vitest run`。

## Global Constraints

- **不执行 `npm run dev` / `wxt`（watch 模式）**——只用 `wxt build` 做构建验证。
- **每次胶水层任务（Task 5/6/7）完成必须跑 `cd extension && npm run build`**，报错则修复（项目 CLAUDE.md 强制）。
- **纯 DOM 任务（Task 2/3/4）用 `cd extension && npx vitest run src/__tests__/comment-submit.test.ts` 验证**。
- **提交信息用中文**，每个任务一个 commit。
- **代码缩进用 tab**（匹配 `FormFillEngine.ts` / `dom-utils.ts` 现有风格）。
- **不引入新依赖**（`@types/chrome`、`jsdom`、`vitest` 均已装）。
- **测试文件路径**：`extension/src/__tests__/comment-submit.test.ts`（vitest include 模式 `src/__tests__/**/*.test.ts`）。
- **不碰** `directory_submit` 流程、Blogger 跨域 iframe、Disqus/Giscus 等跨域 iframe 评论系统。

## File Structure

| 文件 | 责任 | 改动 |
|---|---|---|
| `extension/src/agent/comment-submit.ts` | 纯 DOM 提交逻辑：定位按钮、4 级降级点击、弱验证、验证码检测 | **新增** |
| `extension/src/__tests__/comment-submit.test.ts` | comment-submit 的单元测试（jsdom + 动态 import） | **新增** |
| `extension/src/agent/types.ts` | `FillResult` 扩展 + `VerifyResult` 类型 | 修改 |
| `extension/src/entrypoints/content.ts` | 新增 `submit` case，调用 comment-submit | 修改 |
| `extension/src/agent/FormFillEngine.ts` | Step 5：blog_comment 时发 submit 消息、回填 FillResult | 修改 |
| `extension/src/hooks/useFloatFill.ts` | 入库按 siteType 分支 | 修改 |

`comment-submit.ts` 设计为**纯 DOM 模块**（不 import chrome），可在 jsdom 单测；content.ts 作薄胶水层调用它。这与现有 `dom-utils.ts` 的边界一致。

---

## Task 1: 扩展 FillResult / VerifyResult 类型

**Files:**
- Modify: `extension/src/agent/types.ts`

**Interfaces:**
- Produces: `VerifyResult` 类型、扩展后的 `FillResult`（含 `submitted` / `verifyResult` / `submitError`）—— Task 5/6/7 依赖。

- [ ] **Step 1: 修改 types.ts**

在 `extension/src/agent/types.ts` 的 `FillResult` 接口前，新增 `VerifyResult` 类型，并扩展 `FillResult`：

```ts
/** 自动提交后的验证结果（仅 blog_comment 自动提交场景） */
export type VerifyResult =
	| 'ajax'        // 拦截到评论提交的 fetch/XHR 或 submit 事件
	| 'navigating'  // 触发 beforeunload（整页跳转，WP 原生评论典型）
	| 'pagehide'    // 触发 pagehide
	| 'timeout'     // 10s 内无任何提交信号，且评论框未清空
	| 'cleared'     // timeout 后再查评论框已被清空（AJAX 提交成功标志）
	| 'not_attempted' // 未尝试提交（找不到按钮 / 点击失败 / 验证码）

/** Result of a form fill operation */
export interface FillResult {
	filled: number
	skipped: number
	failed: number
	notes: string
	/** 是否完成了提交点击动作（仅 blog_comment） */
	submitted?: boolean
	/** 提交验证结果（仅 blog_comment） */
	verifyResult?: VerifyResult
	/** 提交/验证失败原因 */
	submitError?: string
}
```

- [ ] **Step 2: 类型检查**

Run: `cd extension && npx tsc --noEmit`
Expected: 无新增错误（`FillResult` 是新增可选字段，向后兼容）。

- [ ] **Step 3: Commit**

```bash
git add extension/src/agent/types.ts
git commit -m "feat(types): FillResult 扩展 submitted/verifyResult/submitError 字段"
```

---

## Task 2: comment-submit.ts — 定位提交按钮（resolveSubmitButton / findSubmitButtonInForm / isFormSubmitUrl）

**Files:**
- Create: `extension/src/agent/comment-submit.ts`
- Create: `extension/src/__tests__/comment-submit.test.ts`

**Interfaces:**
- Produces: `isFormSubmitUrl(url)`、`findSubmitButtonInForm(form)`、`resolveSubmitButton(commentSelector)` —— Task 4/5 依赖。

- [ ] **Step 1: 写失败测试**

创建 `extension/src/__tests__/comment-submit.test.ts`，仿 `dom-utils.test.ts` 的 `new JSDOM` + 动态 import 模式：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { JSDOM } from 'jsdom'

let dom: JSDOM
let doc: Document
let win: Window

async function loadModule() {
	dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
		runScripts: 'dangerously',
		url: 'https://example.com',
	})
	// @ts-expect-error 注入到全局，让模块拿到正确的 document/window
	globalThis.document = dom.window.document
	// @ts-expect-error
	globalThis.window = dom.window
	win = dom.window
	doc = dom.window.document
	return await import('@/agent/comment-submit')
}

beforeEach(async () => {
	await loadModule()
})

describe('isFormSubmitUrl', () => {
	it('排除静态资源', async () => {
		const mod = await loadModule()
		expect(mod.isFormSubmitUrl('https://a.com/app.js')).toBe(false)
		expect(mod.isFormSubmitUrl('https://a.com/style.css')).toBe(false)
		expect(mod.isFormSubmitUrl('https://a.com/pic.png')).toBe(false)
	})

	it('排除 analytics / wp-admin admin-ajax', async () => {
		const mod = await loadModule()
		expect(mod.isFormSubmitUrl('https://www.google-analytics.com/collect')).toBe(false)
		expect(mod.isFormSubmitUrl('https://a.com/wp-admin/admin-ajax.php')).toBe(false)
	})

	it('放行评论提交地址', async () => {
		const mod = await loadModule()
		expect(mod.isFormSubmitUrl('https://a.com/wp-comments-post.php')).toBe(true)
		expect(mod.isFormSubmitUrl('https://a.com/api/comment')).toBe(true)
	})
})

describe('findSubmitButtonInForm', () => {
	it('WP 标准选择器 #submit 优先', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `
			<form id="commentform">
				<input id="submit" type="submit" value="Post Comment">
				<button type="button">Cancel</button>
			</form>`
		const form = doc.getElementById('commentform') as HTMLFormElement
		const btn = mod.findSubmitButtonInForm(form)
		expect(btn?.id).toBe('submit')
	})

	it('button[type=submit] 兜底', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `
			<form>
				<button type="submit">Submit</button>
			</form>`
		const form = doc.querySelector('form') as HTMLFormElement
		expect(mod.findSubmitButtonInForm(form)?.textContent).toBe('Submit')
	})

	it('关键词匹配（中文"提交"）', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `
			<form>
				<button type="button">提交评论</button>
			</form>`
		const form = doc.querySelector('form') as HTMLFormElement
		expect(mod.findSubmitButtonInForm(form)?.textContent).toBe('提交评论')
	})

	it('表单只有一个按钮时返回它', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `
			<form>
				<button>Only</button>
			</form>`
		const form = doc.querySelector('form') as HTMLFormElement
		expect(mod.findSubmitButtonInForm(form)?.textContent).toBe('Only')
	})

	it('无按钮返回 null', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<form><input type="text"></form>`
		const form = doc.querySelector('form') as HTMLFormElement
		expect(mod.findSubmitButtonInForm(form)).toBeNull()
	})
})

describe('resolveSubmitButton', () => {
	it('通过评论框 selector 定位同表单的提交按钮', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `
			<form id="commentform">
				<textarea id="comment" name="comment"></textarea>
				<input id="submit" type="submit">
			</form>`
		const res = mod.resolveSubmitButton('#comment')
		expect(res.button?.id).toBe('submit')
		expect(res.form?.id).toBe('commentform')
	})

	it('评论框 selector 找不到时，用 WP form 选择器兜底', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `
			<form id="commentform" action="/wp-comments-post.php">
				<button type="submit">Post</button>
			</form>`
		const res = mod.resolveSubmitButton(null)
		expect(res.button?.textContent).toBe('Post')
	})

	it('页面上没有任何评论表单时返回 {form:null, button:null}', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<div>no form</div>`
		const res = mod.resolveSubmitButton(null)
		expect(res.form).toBeNull()
		expect(res.button).toBeNull()
	})
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `cd extension && npx vitest run src/__tests__/comment-submit.test.ts`
Expected: FAIL（`Cannot find module '@/agent/comment-submit'`）。

- [ ] **Step 3: 实现 comment-submit.ts（本任务的三个函数）**

创建 `extension/src/agent/comment-submit.ts`：

```ts
/**
 * comment-submit — 博客评论自动提交 + 弱验证（纯 DOM 模块）。
 * 从 autoComment 搬运、改写为 TypeScript，适配 submit-agent 的 selector 体系。
 * 不 import chrome，可在 jsdom 单测；由 content.ts 的 submit case 调用。
 */

/** 判断 URL 是否可能是评论表单提交地址（排除静态资源/analytics/wp-admin） */
export function isFormSubmitUrl(url: string | URL): boolean {
	if (!url) return false
	const s = String(typeof url === 'string' ? url : url.url).toLowerCase()
	const excludePatterns = [
		/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|webp|mp4|webm|ogg|mp3|wav|zip|tar|gz)$/,
		/google-analytics|googletagmanager|doubleclick|facebook\.com\/tr|analytics|tracking|pixel/i,
		/\/wp-admin\/admin-ajax/,
	]
	for (const p of excludePatterns) {
		if (p.test(s)) return false
	}
	return true
}

/** 多语种提交关键词 */
const SUBMIT_KEYWORDS = [
	'submit', 'post', 'comment', 'publish', 'reply', 'respond', 'send',
	'publicar', 'responder', 'enviar', 'comentar', 'anzeigen', 'absenden',
	'提交', '评论', '发送', '发表', '回答', '返信',
]

/** 在指定 form 内查找提交按钮 */
export function findSubmitButtonInForm(form: HTMLFormElement | null): HTMLElement | null {
	if (!form) return null

	// 方法 1：WP / wpDiscuz 标准选择器
	const wpSelectors = [
		'#submit', '#submit-btn', '#publish', '#wp-submit',
		'input[type="submit"]#submit', '.submit', '[name="submit"]',
		'.wpd-submit-btn', '.wpdiscuz-submit-btn', '.wpd-button',
		'button[class*="wpdiscuz"]', '.wc_comment_submit',
	]
	for (const sel of wpSelectors) {
		try {
			const btn = form.querySelector<HTMLElement>(sel)
			if (btn) return btn
		} catch { /* 无效选择器，跳过 */ }
	}

	// 方法 2：显式 submit 类元素（含 button 无 type，默认 submit）
	const candidates = Array.from(form.querySelectorAll<HTMLElement>(
		'button[type="submit"], button:not([type]), input[type="submit"], input[type="image"], [role="submit"]'
	))
	// 优先返回命中关键词的
	for (const btn of candidates) {
		const text = `${btn.getAttribute('value') ?? ''} ${btn.className ?? ''} ${btn.id ?? ''} ${btn.textContent ?? ''}`.toLowerCase()
		if (SUBMIT_KEYWORDS.some(k => text.includes(k))) return btn
	}
	if (candidates.length > 0) return candidates[0]

	// 方法 3：button/input[type=button] 文本关键词
	const allButtons = Array.from(form.querySelectorAll<HTMLElement>('button, input[type="button"]'))
	for (const btn of allButtons) {
		const text = `${btn.textContent ?? (btn as HTMLInputElement).value ?? ''} ${btn.className ?? ''} ${btn.id ?? ''}`.toLowerCase()
		if (SUBMIT_KEYWORDS.some(k => text.includes(k))) return btn
	}
	// 方法 4：表单只有一个按钮
	if (allButtons.length === 1) return allButtons[0]

	return null
}

/** 从评论框 selector（或 WP form 选择器兜底）定位 form + 提交按钮 */
export function resolveSubmitButton(commentSelector: string | null): {
	form: HTMLFormElement | null
	button: HTMLElement | null
} {
	// 优先：用评论框找同表单
	if (commentSelector) {
		const ta = document.querySelector<HTMLElement>(commentSelector)
		if (ta) {
			const form = (ta as HTMLTextAreaElement).form
				|| (ta.closest('form') as HTMLFormElement | null)
			if (form) {
				const btn = findSubmitButtonInForm(form)
				if (btn) return { form, button: btn }
			}
		}
	}

	// 兜底：WP 标准 form 选择器
	const formSelectors = [
		'#commentform', '.comment-form', 'form[name="commentform"]',
		'form[action*="wp-comments-post.php"]', 'form[id*="comment"]',
	]
	for (const sel of formSelectors) {
		const form = document.querySelector<HTMLFormElement>(sel)
		if (form) {
			const btn = findSubmitButtonInForm(form)
			if (btn) return { form, button: btn }
		}
	}

	// 兜底：评论区域内找 form
	const areaSelectors = ['#comments', '#respond', '.comment-respond', '.comments-area']
	for (const sel of areaSelectors) {
		const area = document.querySelector(sel)
		if (area) {
			const form = (area.querySelector('form') || area.closest('form')) as HTMLFormElement | null
			if (form) {
				const btn = findSubmitButtonInForm(form)
				if (btn) return { form, button: btn }
			}
		}
	}

	return { form: null, button: null }
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `cd extension && npx vitest run src/__tests__/comment-submit.test.ts`
Expected: PASS（全部用例）。

- [ ] **Step 5: Commit**

```bash
git add extension/src/agent/comment-submit.ts extension/src/__tests__/comment-submit.test.ts
git commit -m "feat(comment-submit): 新增提交按钮定位 isFormSubmitUrl/findSubmitButtonInForm/resolveSubmitButton"
```

---

## Task 3: comment-submit.ts — 验证码检测 + 弱验证（detectCaptcha / waitForSubmitOrNavigate）

**Files:**
- Modify: `extension/src/agent/comment-submit.ts`（追加函数）
- Modify: `extension/src/__tests__/comment-submit.test.ts`（追加测试）

**Interfaces:**
- Produces: `detectCaptcha(root)`、`waitForSubmitOrNavigate(timeoutMs)` —— Task 4/5 依赖。`waitForSubmitOrNavigate` 必须 `export`（Task 4 的 performClick 测试要 spyOn 它）。

- [ ] **Step 1: 追加失败测试**

在 `extension/src/__tests__/comment-submit.test.ts` 末尾追加：

```ts
describe('detectCaptcha', () => {
	it('检测到 reCAPTCHA widget', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<form><div class="g-recaptcha" data-sitekey="x"></div></form>`
		const form = doc.querySelector('form')!
		expect(mod.detectCaptcha(form)).toBe(true)
	})

	it('检测到 Turnstile', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<form><div class="cf-turnstile"></div></form>`
		expect(mod.detectCaptcha(doc.querySelector('form')!)).toBe(true)
	})

	it('无验证码返回 false', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<form><input type="text"></form>`
		expect(mod.detectCaptcha(doc.querySelector('form')!)).toBe(false)
	})
})

describe('waitForSubmitOrNavigate', () => {
	it('submit 事件 → ajax', async () => {
		const mod = await loadModule()
		const p = mod.waitForSubmitOrNavigate(1000)
		win.document.dispatchEvent(new win.Event('submit', { bubbles: true }))
		expect(await p).toBe('ajax')
	})

	it('beforeunload → navigating', async () => {
		const mod = await loadModule()
		const p = mod.waitForSubmitOrNavigate(1000)
		win.dispatchEvent(new win.Event('beforeunload'))
		expect(await p).toBe('navigating')
	})

	it('pagehide → pagehide', async () => {
		const mod = await loadModule()
		const p = mod.waitForSubmitOrNavigate(1000)
		win.dispatchEvent(new win.Event('pagehide'))
		expect(await p).toBe('pagehide')
	})

	it('超时 → timeout，并恢复原始 fetch/XHR', async () => {
		const mod = await loadModule()
		const originalFetch = win.fetch
		const p = mod.waitForSubmitOrNavigate(200)
		expect(await p).toBe('timeout')
		// cleanup 后 fetch 应已恢复
		expect(win.fetch).toBe(originalFetch)
	})

	it('拦截 fetch 评论提交 → ajax', async () => {
		const mod = await loadModule()
		const originalFetch = win.fetch
		const p = mod.waitForSubmitOrNavigate(1000)
		// 模拟站点发出评论提交请求
		try { await win.fetch('https://a.com/wp-comments-post.php') } catch {}
		expect(await p).toBe('ajax')
		// cleanup 恢复
		expect(win.fetch).toBe(originalFetch)
	})
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `cd extension && npx vitest run src/__tests__/comment-submit.test.ts`
Expected: FAIL（`detectCaptcha` / `waitForSubmitOrNavigate` 未导出）。

- [ ] **Step 3: 追加实现**

在 `extension/src/agent/comment-submit.ts` 末尾追加：

```ts
/** 验证码 widget 选择器（搬 autoComment MANUAL_REQUIRED_WIDGET_SELECTORS） */
const CAPTCHA_SELECTORS = [
	'.g-recaptcha', '.h-captcha', '.cf-turnstile', '[data-sitekey]',
	'[name="g-recaptcha-response"]', '[name="h-captcha-response"]',
	'iframe[src*="recaptcha"]', 'iframe[src*="hcaptcha"]',
	'iframe[src*="challenges.cloudflare.com"]',
]

/** 检测目标容器内是否有验证码 widget（命中则不硬闯，提示手动） */
export function detectCaptcha(root: Element | Document | null): boolean {
	if (!root) return false
	for (const sel of CAPTCHA_SELECTORS) {
		try {
			if ((root as Element).querySelector?.(sel)) return true
		} catch { /* 无效选择器 */ }
	}
	return false
}

export type SubmitSignal = 'ajax' | 'navigating' | 'pagehide' | 'timeout'

/**
 * 点击提交后等待提交信号：拦截 fetch/XHR + 监听 submit/beforeunload/pagehide。
 * 任一信号触发即 resolve；超时 resolve 'timeout'。结束后恢复原始 fetch/XHR。
 */
export function waitForSubmitOrNavigate(timeoutMs = 10000): Promise<SubmitSignal> {
	return new Promise((resolve) => {
		let resolved = false
		const originalFetch = window.fetch
		const originalXHROpen = window.XMLHttpRequest.prototype.open

		function finish(result: SubmitSignal) {
			if (resolved) return
			resolved = true
			cleanup()
			resolve(result)
		}
		function cleanup() {
			clearTimeout(timer)
			document.removeEventListener('submit', onSubmit, true)
			window.removeEventListener('beforeunload', onBeforeUnload)
			window.removeEventListener('pagehide', onPageHide)
			if (window.XMLHttpRequest) window.XMLHttpRequest.prototype.open = originalXHROpen
			if (window.fetch) window.fetch = originalFetch
		}
		const onSubmit = () => finish('ajax')
		const onBeforeUnload = () => finish('navigating')
		const onPageHide = () => finish('pagehide')

		// 拦截 fetch
		window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
			const url = typeof input === 'string' ? input : (input as Request).url ?? String(input)
			if (!resolved && isFormSubmitUrl(url)) finish('ajax')
			return originalFetch.apply(this, arguments as unknown as Parameters<typeof fetch>)
		} as typeof fetch

		// 拦截 XHR
		window.XMLHttpRequest.prototype.open = function (method: string, url: string, ...rest: unknown[]) {
			if (!resolved && isFormSubmitUrl(url)) finish('ajax')
			return originalXHROpen.call(this, method, url, ...(rest as []))
		} as XMLHttpRequest['open']

		document.addEventListener('submit', onSubmit, true)
		window.addEventListener('beforeunload', onBeforeUnload)
		window.addEventListener('pagehide', onPageHide)

		const timer = setTimeout(() => finish('timeout'), timeoutMs)
	})
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `cd extension && npx vitest run src/__tests__/comment-submit.test.ts`
Expected: PASS（含新增 detectCaptcha / waitForSubmitOrNavigate 用例）。

- [ ] **Step 5: Commit**

```bash
git add extension/src/agent/comment-submit.ts extension/src/__tests__/comment-submit.test.ts
git commit -m "feat(comment-submit): 新增验证码检测 detectCaptcha 与弱验证 waitForSubmitOrNavigate"
```

---

## Task 4: comment-submit.ts — 4 级降级点击 performClick

**Files:**
- Modify: `extension/src/agent/comment-submit.ts`（追加 `performClick`）
- Modify: `extension/src/__tests__/comment-submit.test.ts`（追加测试）

**Interfaces:**
- Consumes: `waitForSubmitOrNavigate`（Task 3）
- Produces: `performClick(button, form)` → `{ success, submitResult, error? }` —— Task 5 依赖。

- [ ] **Step 1: 追加失败测试**

在测试文件末尾追加（用 `vi.spyOn` mock `waitForSubmitOrNavigate`，验证降级链）：

```ts
import { vi } from 'vitest'

describe('performClick', () => {
	it('第一策略成功执行 → 返回 success + submitResult', async () => {
		const mod = await loadModule()
		const spy = vi.spyOn(mod, 'waitForSubmitOrNavigate').mockResolvedValue('ajax')
		doc.body.innerHTML = `<form><button id="btn" type="submit">Go</button></form>`
		const btn = doc.getElementById('btn') as HTMLElement
		const form = doc.querySelector('form') as HTMLFormElement
		const res = await mod.performClick(btn, form)
		expect(res.success).toBe(true)
		expect(res.submitResult).toBe('ajax')
		spy.mockRestore()
	})

	it('按钮不存在 → success:false', async () => {
		const mod = await loadModule()
		const res = await mod.performClick(null as unknown as HTMLElement, null)
		expect(res.success).toBe(false)
		expect(res.error).toBeTruthy()
	})

	it('合成事件 + click 都抛异常时，降级到 requestSubmit / form.submit', async () => {
		const mod = await loadModule()
		const spy = vi.spyOn(mod, 'waitForSubmitOrNavigate').mockResolvedValue('navigating')
		doc.body.innerHTML = `<form id="f"><button id="btn">Go</button></form>`
		const btn = doc.getElementById('btn') as HTMLElement
		const form = doc.querySelector('form') as HTMLFormElement
		// 让 button.click 抛异常（模拟不可点击）；requestSubmit 不存在；form.submit 工作
		btn.click = () => { throw new Error('nope') }
		Object.defineProperty(btn, 'dispatchEvent', { value: () => { throw new Error('nope') } })
		form.requestSubmit = undefined as unknown as HTMLFormElement['requestSubmit']
		const res = await mod.performClick(btn, form)
		// 最终 form.submit() 成功执行 → waitForSubmitOrNavigate 返回 navigating
		expect(res.success).toBe(true)
		expect(res.submitResult).toBe('navigating')
		spy.mockRestore()
	})
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `cd extension && npx vitest run src/__tests__/comment-submit.test.ts`
Expected: FAIL（`performClick` 未导出）。

- [ ] **Step 3: 追加 performClick 实现**

在 `comment-submit.ts` 末尾追加（重构 autoComment 的 4 级降级为策略遍历，更清晰）：

```ts
export interface PerformClickResult {
	success: boolean
	submitResult: SubmitSignal
	error?: string
}

/** 合成完整鼠标事件链（拟人化，绕过部分反爬） */
function syntheticEventClick(button: HTMLElement): void {
	button.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' })
	const rect = button.getBoundingClientRect()
	const clientX = Math.round(rect.left + rect.width / 2)
	const clientY = Math.round(rect.top + rect.height / 2)
	const mouseOpts = { view: window, bubbles: true, cancelable: true, clientX, clientY }
	if (typeof PointerEvent !== 'undefined') {
		button.dispatchEvent(new PointerEvent('pointerdown', { ...mouseOpts, pointerId: 1, pointerType: 'mouse', isPrimary: true }))
	}
	button.dispatchEvent(new MouseEvent('mousedown', mouseOpts))
	button.dispatchEvent(new MouseEvent('mouseup', mouseOpts))
	if (typeof PointerEvent !== 'undefined') {
		button.dispatchEvent(new PointerEvent('pointerup', { ...mouseOpts, pointerId: 1, pointerType: 'mouse', isPrimary: true }))
	}
	button.dispatchEvent(new MouseEvent('click', mouseOpts))
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * 4 级降级点击。任一策略成功执行（不抛异常）即等待提交信号并返回。
 * 降级仅在"该策略抛异常"时触发；submitResult 透传给上层判断提交是否真发生。
 */
export async function performClick(
	button: HTMLElement | null,
	form: HTMLFormElement | null,
): Promise<PerformClickResult> {
	if (!button) return { success: false, submitResult: 'timeout', error: '提交按钮为空' }

	// 4 级策略：合成事件 → button.click() → form.requestSubmit → form.submit
	// 注意：requestSubmit / form.submit 在不可用时必须抛异常，才能触发降级到下一级
	// （用 optional chaining 会静默返回 undefined，被误判为"成功执行"）
	const strategies: Array<{ name: string; fn: () => void | Promise<void> }> = [
		{ name: 'synthetic', fn: () => syntheticEventClick(button) },
		{ name: 'click', fn: () => button.click() },
		{
			name: 'requestSubmit',
			fn: () => {
				if (!form || typeof form.requestSubmit !== 'function') throw new Error('requestSubmit 不可用')
				form.requestSubmit(button)
			},
		},
		{
			name: 'submit',
			fn: () => {
				if (!form) throw new Error('form 不存在')
				form.submit()
			},
		},
	]

	for (const s of strategies) {
		try {
			await s.fn()
		} catch {
			continue // 该策略抛异常 → 试下一级
		}
		// 策略执行成功，等待提交信号（合成事件后给 DOM 一点时间）
		if (s.name === 'synthetic') await sleep(40)
		const submitResult = await waitForSubmitOrNavigate(10000)
		return { success: true, submitResult }
	}

	return { success: false, submitResult: 'timeout', error: '所有点击策略均失败' }
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `cd extension && npx vitest run src/__tests__/comment-submit.test.ts`
Expected: PASS（含 performClick 三个用例）。

- [ ] **Step 5: Commit**

```bash
git add extension/src/agent/comment-submit.ts extension/src/__tests__/comment-submit.test.ts
git commit -m "feat(comment-submit): 新增 4 级降级点击 performClick"
```

---

## Task 5: content.ts — 新增 submit case（胶水层）

**Files:**
- Modify: `extension/src/entrypoints/content.ts`（在 `case 'annotate-clear'` 后、switch 结束前，约第 385 行后插入 `case 'submit'`）
- Modify: `extension/src/agent/comment-submit.ts`（无需改动，已 export 全部所需函数）

**Interfaces:**
- Consumes: `resolveSubmitButton` / `detectCaptcha` / `performClick`（Task 2/3/4）、`FormAnalysisResult`（已在 content.ts import）
- Produces: `submit` action 的响应 `{ ok, clicked, verifyResult, error? }` —— Task 6 依赖。

- [ ] **Step 1: 在 content.ts 顶部 import 区追加 comment-submit 导入**

找到 `content.ts` 现有的 `import ... from '@/agent/dom-utils'`（约第 5 行）和 `import { analyzeForms } from '@/agent/FormAnalyzer'`，在附近追加：

```ts
import { resolveSubmitButton, detectCaptcha, performClick } from '@/agent/comment-submit'
import type { VerifyResult } from '@/agent/types'
```

- [ ] **Step 2: 在 switch 里新增 `case 'submit'` 块**

在 `case 'annotate-clear'` 块之后、switch 的闭合 `}` 之前（约第 385 行后）插入：

```ts
case 'submit': {
	const fields = message.payload?.fields as Array<{
		selector: string
		type?: string
		effective_type?: string
		name?: string
		id?: string
		canonical_id?: string
	}> | undefined

	;(async () => {
		try {
			// 从已填字段里识别评论框 selector（textarea / comment 语义）
			const commentField = fields?.find((f) =>
				f.type === 'textarea'
				|| f.effective_type === 'comment'
				|| /comment|reply|message/i.test(`${f.canonical_id ?? ''} ${f.name ?? ''} ${f.id ?? ''}`)
			)
			const commentSelector = commentField?.selector ?? null

			const { form, button } = resolveSubmitButton(commentSelector)
			if (!button) {
				sendResponse({ ok: true, clicked: false, verifyResult: 'not_attempted' as VerifyResult, error: '未找到提交按钮' })
				return
			}
			if (detectCaptcha(form)) {
				sendResponse({ ok: true, clicked: false, verifyResult: 'not_attempted' as VerifyResult, error: '检测到验证码，请手动提交' })
				return
			}

			const clickRes = await performClick(button, form)
			if (!clickRes.success) {
				sendResponse({ ok: true, clicked: false, verifyResult: 'not_attempted' as VerifyResult, error: clickRes.error })
				return
			}

			// timeout 时再查评论框是否被清空（AJAX 提交成功标志）
			let verifyResult: VerifyResult = clickRes.submitResult
			if (verifyResult === 'timeout' && commentSelector) {
				await new Promise((r) => setTimeout(r, 3000))
				const ta = document.querySelector<HTMLTextAreaElement>(commentSelector)
				const cleared = !ta || !(ta.value?.trim())
				if (cleared) verifyResult = 'cleared'
			}

			sendResponse({ ok: true, clicked: true, verifyResult, error: clickRes.error })
		} catch (err) {
			sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
		}
	})()

	return true // keep message channel open for async response
}
```

- [ ] **Step 3: 构建验证**

Run: `cd extension && npm run build`
Expected: 构建成功，无 TS 错误。若报 `VerifyResult` 未导出，确认 Task 1 已完成；若报 `performClick` 签名不符，对照 Task 4。

- [ ] **Step 4: Commit**

```bash
git add extension/src/entrypoints/content.ts
git commit -m "feat(content): 新增 FLOAT_FILL submit action，调用 comment-submit 完成提交+验证"
```

---

## Task 6: FormFillEngine — Step 5 自动提交 + 回填 FillResult（胶水层）

**Files:**
- Modify: `extension/src/agent/FormFillEngine.ts`（在第 375 行 `const result: FillResult = {...}` 之前插入 Step 5；并扩展 result 字段）

**Interfaces:**
- Consumes: `submit` action（Task 5）、扩展后的 `FillResult` / `VerifyResult`（Task 1）
- Produces: `FillResult` 含 `submitted` / `verifyResult` / `submitError` —— Task 7 依赖。

- [ ] **Step 1: 在 FormFillEngine.ts 顶部 import VerifyResult 类型**

找到 `import type { ... } from './types'`（第 11 行），把 `VerifyResult` 加入导入列表：

```ts
import type { FillEngineStatus, FillResult, SiteType, FieldValueMap, LogEntry, LogLevel, LLMFieldData, LLMFieldValue, VerifyResult } from './types'
```

- [ ] **Step 2: 在 Step 4 结束（`const result` 之前）插入 Step 5**

定位到这段（约第 368-374 行）：
```ts
		const result: FillResult = {
			filled: filledCount,
			skipped: analysis.fields.length - fieldsToFill.length,
			failed: failedCount,
			notes: `Filled ${filledCount} of ${analysis.fields.length} fields.`,
		}
```
在它**之前**插入 Step 5（注意缩进用 tab，匹配文件风格）：

```ts
		// Step 5: 自动提交 + 弱验证（仅 blog_comment 且填写无失败时）
		let submitted: boolean | undefined
		let verifyResult: VerifyResult | undefined
		let submitError: string | undefined
		if (siteType === 'blog_comment' && failedCount === 0 && filledCount > 0) {
			log('info', 'fill', '正在自动提交评论并验证...')
			try {
				const submitResponse = await sendToTab<{
					ok: boolean
					clicked: boolean
					verifyResult: VerifyResult
					error?: string
				}>(
					tabId,
					{
						type: 'FLOAT_FILL',
						action: 'submit',
						payload: {
							fields: analysis.fields.map((f) => ({
								selector: f.selector,
								type: f.type,
								effective_type: f.effective_type,
								name: f.name,
								id: f.id,
								canonical_id: f.canonical_id,
							})),
						},
					},
					20_000,
				)
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
					verifyResult = 'not_attempted'
					submitError = submitResponse?.error || '提交消息无响应'
					log('error', 'fill', `自动提交失败: ${submitError}`)
				}
			} catch (err) {
				verifyResult = 'not_attempted'
				submitError = err instanceof Error ? err.message : String(err)
				log('error', 'fill', `自动提交异常: ${submitError}`)
			}
		}

```

- [ ] **Step 3: 把三个字段加入 result**

把原 `const result: FillResult = {...}` 改为（追加三字段）：

```ts
		const result: FillResult = {
			filled: filledCount,
			skipped: analysis.fields.length - fieldsToFill.length,
			failed: failedCount,
			notes: `Filled ${filledCount} of ${analysis.fields.length} fields.`,
			submitted,
			verifyResult,
			submitError,
		}
```

- [ ] **Step 4: 跑现有 FormFillEngine 测试，确认无回归**

Run: `cd extension && npx vitest run src/__tests__/FormFillEngine.test.ts`
Expected: PASS（现有测试只测 `fuzzyMatchField`，不受影响；若失败说明 import 改错）。

- [ ] **Step 5: 构建验证**

Run: `cd extension && npm run build`
Expected: 构建成功。

- [ ] **Step 6: Commit**

```bash
git add extension/src/agent/FormFillEngine.ts
git commit -m "feat(FormFillEngine): blog_comment 填写后自动提交+验证，回填 FillResult"
```

---

## Task 7: useFloatFill — 入库按 siteType 分支（胶水层）

**Files:**
- Modify: `extension/src/hooks/useFloatFill.ts`（`runFloatFillRef` 的 matched 路径，第 56-68 行；扩展 `UseFloatFillOptions.startSubmission` 返回类型）

**Interfaces:**
- Consumes: `FillResult`（Task 1，现在含 `verifyResult` / `submitError`）

- [ ] **Step 1: 扩展 startSubmission 返回类型**

找到 `interface UseFloatFillOptions`（第 5-15 行），把 `startSubmission` 的返回类型从 `Promise<{ filled: number; failed: number; notes: string }>` 改为含新字段：

```ts
	startSubmission: (site: SiteData) => Promise<{ filled: number; failed: number; notes: string; verifyResult?: string; submitError?: string }>
```

（用 `string` 而非 `VerifyResult` 避免在 hook 层引入 agent 类型耦合；运行时值仍是 VerifyResult 联合。）

- [ ] **Step 2: 改 runFloatFillRef 的 matched 入库逻辑（第 56-68 行）**

把这段：
```ts
						const r = await startSubmission(matched)
						if (r.failed === 0 && r.filled > 0) {
							markSubmitted(matched.name, activeProduct.id)
						} else if (r.filled === 0) {
							chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'error' }).catch(() => {})
							markFailed(matched.name, activeProduct.id, '页面未发现可填写的表单字段')
						}
```
改为按 siteType 分支：
```ts
						const r = await startSubmission(matched)
						const isBlogComment = matched.category === 'blog_comment'
						if (isBlogComment) {
							// blog_comment：以提交验证结果为准
							const verified = ['ajax', 'navigating', 'pagehide', 'cleared'].includes(r.verifyResult ?? '')
							if (verified) {
								markSubmitted(matched.name, activeProduct.id)
							} else {
								chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'error' }).catch(() => {})
								markFailed(matched.name, activeProduct.id, r.submitError || `提交未确认(${r.verifyResult ?? 'not_attempted'})`)
							}
						} else {
							// directory：维持原逻辑（填写成功即标记，不自动提交）
							if (r.failed === 0 && r.filled > 0) {
								markSubmitted(matched.name, activeProduct.id)
							} else if (r.filled === 0) {
								chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'error' }).catch(() => {})
								markFailed(matched.name, activeProduct.id, '页面未发现可填写的表单字段')
							}
						}
```

- [ ] **Step 3: 构建验证**

Run: `cd extension && npm run build`
Expected: 构建成功（`matched.category` 是 `SiteCategory`，含 `'blog_comment'`，比较合法）。

- [ ] **Step 4: Commit**

```bash
git add extension/src/hooks/useFloatFill.ts
git commit -m "feat(useFloatFill): 入库按 siteType 分支，blog_comment 以验证结果为准"
```

---

## Task 8: 端到端手动验证 + 收尾

**Files:** 无代码改动，仅验证。

**Interfaces:** —

- [ ] **Step 1: 完整构建**

Run: `cd extension && npm run build`
Expected: 构建成功，dist 产物更新。

- [ ] **Step 2: 全量测试**

Run: `cd extension && npm run test`
Expected: 全部 PASS（含新增 comment-submit.test.ts 的 16+ 用例 + 现有 11 个测试文件无回归）。

- [ ] **Step 3: 手动验证（在 Chrome 加载 dist，配好 LLM key 与 product）**

按下列矩阵验证，每条记录实际 `verifyResult` 与 submissions 表状态：

| # | 场景 | 预期 verifyResult | 预期入库 |
|---|---|---|---|
| 1 | WordPress 原生博客（点浮动按钮） | navigating / pagehide | markSubmitted |
| 2 | wpDiscuz 博客 | ajax / cleared | markSubmitted |
| 3 | 评论框在但找不到提交按钮的非主流站 | not_attempted | markFailed + sidepanel 提示手动 |
| 4 | 带 reCAPTCHA 的博客 | not_attempted（验证码） | markFailed + 提示手动 |
| 5 | directory_submit 站点（如 AI 导航站） | 不触发 submit | 行为不变（填写成功 markSubmitted） |

- 若 #1/#2 verifyResult 不是 navigating/ajax/cleared：检查 `resolveSubmitButton` 是否选错按钮、`performClick` 是否被站点 JS 拦截。
- 若 #5 误触发自动提交：确认 `siteType === 'blog_comment'` 判断生效（category 必须严格等于 `'blog_comment'`）。

- [ ] **Step 4: 更新提交状态记录（可选）**

确认 submissions 表中 blog_comment 站点在验证通过后才为 `submitted`、失败为 `failed`（用扩展 UI 或 IndexedDB 面板核对）。若 spec 里提到的 `SubmissionRecord.verifyResult` 字段需要落库，作为后续小迭代（非本计划阻塞项）。

- [ ] **Step 5: 最终 Commit（若有验证中的小修）**

```bash
git add -A
git commit -m "test: 端到端验证单站自动提交+验证+入库（A 阶段）"
```

---

## 完成标志

- 8 个 Task 全部 commit。
- `npm run build` 与 `npm run test` 全绿。
- 手动验证矩阵 5 条全部符合预期。
- blog_comment 站点的 submissions 状态真实反映"提交验证通过"。
- `comment-submit.ts` 为纯 DOM 独立模块，子系统 B（批量）可直接复用其 `submit` 消息与函数。
