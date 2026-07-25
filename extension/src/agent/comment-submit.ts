/**
 * comment-submit — 博客评论自动提交 + 弱验证（纯 DOM 模块）。
 * 从 autoComment 搬运、改写为 TypeScript，适配 submit-agent 的 selector 体系。
 * 不 import chrome，可在 jsdom 单测；由 content.ts 的 submit case 调用。
 */

import type { VerifyResult } from '@/agent/types'

/** 判断 URL 是否可能是评论表单提交地址（排除静态资源/analytics/wp-admin） */
export function isFormSubmitUrl(url: string | URL): boolean {
	if (!url) return false
	const s = String(url).toLowerCase()
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

/** 登录页 URL 路径模式（提交后跳转到这些路径意味着未登录、提交失败） */
const LOGIN_URL_PATTERNS = [
	/\/login\b/i, /\/sign[-_]?in\b/i, /\/auth\b/i, /\/register\b/i,
	/\/account\/login\b/i, /\/user\/login\b/i,
]

/** 判断 URL 是否指向登录/注册页（用于检测"提交被重定向到登录页"的失败场景） */
export function isLoginRedirectUrl(url: string): boolean {
	try {
		const u = new URL(url, location.href)
		return LOGIN_URL_PATTERNS.some(p => p.test(u.pathname))
	} catch {
		return false
	}
}

/** WP 评论待审核 URL 模式：unapproved= 与 moderation-hash= 同时出现（WP 标准） */
const MODERATION_URL_PATTERNS = [/[?&]unapproved=\d+/i, /[?&]moderation-hash=/i]

/** 判断 URL 是否为评论待审核重定向（WP 原生提交后跳转，评论未实际发布） */
export function isModerationUrl(url: string): boolean {
	try {
		const u = new URL(url, location.href)
		return MODERATION_URL_PATTERNS.every(p => p.test(u.search))
	} catch {
		return false
	}
}

/** 评论待审核文本模式（多语种，AJAX 提交后 DOM 出现的提示） */
const MODERATION_TEXT_PATTERNS = [
	/awaiting moderation/i, /pending (moderation|approval|review)/i,
	/待审核/, /审核中/, /等候審核/,
]

/** 检测 DOM 中是否出现评论待审核提示（AJAX 提交场景，best-effort） */
export function isModerationContent(root: Element | Document | null): boolean {
	if (!root) return false
	if (root.querySelector('.comment-awaiting-moderation, [class*=moderation-notice], [id*=moderation]')) return true
	const text = (root.textContent || '').slice(0, 5000)
	return MODERATION_TEXT_PATTERNS.some(p => p.test(text))
}

/**
 * 当前页面是否处于评论待审核状态：URL 含 WP moderation 参数，或 DOM 出现待审核标记。
 * 供 content script 在提交后（含整页跳转后的新页面）对引擎做权威判定。
 */
export function detectModeration(): boolean {
	return isModerationUrl(location.href) || isModerationContent(document)
}

/**
 * 跳转后的新页面是否出现了刚提交的评论文本（「评论已发布」的正面证据）。
 * 归一化空白后子串匹配 document.body.textContent——textContent 天然完成 HTML 解码与
 * <p> 分段连接，无需自行处理转义。文本过短则降级返回 true（不因指纹太短误判失败）。
 */
export function commentVisibleOnPage(text: string): boolean {
	const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
	const needle = norm(text)
	if (needle.length < 6) return true
	const hay = norm(document.body?.textContent ?? '')
	return hay.includes(needle)
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

	// 方法 3：button / input[type=button] / 按钮语义 <a> 文本关键词
	//   非 WP 站点（OpenCart/Journal2、部分 Bootstrap 主题）常用 <a class="button"> + jQuery AJAX 提交，
	//   故纳入 a[role="button"] / a[class*=button] / a[class*=submit]，并用关键词过滤以避免误判导航链接。
	const clickables = Array.from(form.querySelectorAll<HTMLElement>(
		'button, input[type="button"], [role="button"], a[class*="button"], a[class*="submit"]'
	))
	for (const btn of clickables) {
		const text = `${btn.textContent ?? (btn as HTMLInputElement).value ?? ''} ${btn.className ?? ''} ${btn.id ?? ''}`.toLowerCase()
		if (SUBMIT_KEYWORDS.some(k => text.includes(k))) return btn
	}
	// 方法 4：表单只有一个可点击元素
	if (clickables.length === 1) return clickables[0]

	return null
}

/**
 * 在任意容器内用关键词搜索可点击提交按钮。
 * 无 form 祖先时的兜底（如 Blogger / Jetpack 跨域 iframe 内 SPA 式评论框）。
 */
function findSubmitButtonInContainer(scope: HTMLElement): HTMLElement | null {
	const candidates = Array.from(scope.querySelectorAll<HTMLElement>(
		'button[type="submit"], button:not([type]), input[type="submit"], [role="submit"], button, [role="button"]',
	))
	for (const btn of candidates) {
		const text = `${btn.getAttribute('value') ?? ''} ${btn.className ?? ''} ${btn.id ?? ''} ${btn.textContent ?? ''}`.toLowerCase()
		if (SUBMIT_KEYWORDS.some(k => text.includes(k))) return btn
	}
	return null
}

/** 无 form 祖先时，向上回溯查找提交按钮的最大层数（覆盖 Google Material 等按钮与输入框相距多层的组件） */
const COMMENT_SCOPE_MAX_DEPTH = 8

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
			// 无 form 祖先（如 Blogger/Jetpack 跨域 iframe 内 SPA 式评论框）：
			// 在 textarea 最近的评论容器内搜按钮；找不到则逐层向上扩大范围
			// （Google Material 等组件提交按钮与输入框相距多层，且祖先 class 不含 "comment"）
			let scope: HTMLElement | null = ta.closest<HTMLElement>(
				'[class*="comment-form"], [id*="respond"], [class*="comment-respond"], [class*="comment"]',
			) ?? ta.parentElement
			for (let depth = 0; scope && depth < COMMENT_SCOPE_MAX_DEPTH; depth++) {
				const btn = findSubmitButtonInContainer(scope)
				if (btn) return { form: null, button: btn }
				scope = scope.parentElement
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

/** reCAPTCHA / hCaptcha widget 选择器：需人工、无法自动通过，命中即放弃提交 */
const CAPTCHA_SELECTORS = [
	'.g-recaptcha', '.h-captcha',
	// [data-sitekey] 同时被 Turnstile 使用，用 :not(.cf-turnstile) 排除，交给 detectCloudflare
	'[data-sitekey]:not(.cf-turnstile)',
	'[name="g-recaptcha-response"]', '[name="h-captcha-response"]',
	'iframe[src*="recaptcha"]', 'iframe[src*="hcaptcha"]',
]

/** 检测目标容器内是否有 reCAPTCHA / hCaptcha widget（需人工，命中即放弃） */
export function detectCaptcha(root: Element | Document | null): boolean {
	if (!root) return false
	for (const sel of CAPTCHA_SELECTORS) {
		try {
			if ((root as Element).querySelector?.(sel)) return true
		} catch { /* 无效选择器 */ }
	}
	return false
}

/** Cloudflare Turnstile widget 选择器：managed 模式通常自动完成，可等待后再提交 */
const CLOUDFLARE_SELECTORS = [
	'.cf-turnstile',
	'iframe[src*="challenges.cloudflare.com"]',
]

/** 检测目标容器内是否有 Cloudflare Turnstile widget（通常自动完成） */
export function detectCloudflare(root: Element | Document | null): boolean {
	if (!root) return false
	for (const sel of CLOUDFLARE_SELECTORS) {
		try {
			if ((root as Element).querySelector?.(sel)) return true
		} catch { /* 无效选择器 */ }
	}
	return false
}

/** Cloudflare 整页人机验证挑战页的标志性标题（managed challenge / interstitial 通用） */
const CLOUDFLARE_CHALLENGE_TITLE = /just a moment/i
/** Cloudflare 整页挑战页的专属 DOM 信号（不出现在普通博客页面） */
const CLOUDFLARE_CHALLENGE_SELECTORS = [
	'#cf-challenge-running',
	'#cf-spinner-please-wait',
	'#cf-please-wait',
	'.cf-browser-verification',
]

/**
 * 当前页面是否为 Cloudflare 整页人机验证挑战页（"Just a moment..."）。
 * 提交触发整页跳转后，若落定的新页面是 CF 挑战页，评论显然未发布 → 由上层判定失败，
 * 避免在 CF 页上沿用 commentVisible 降级（评论文本缺失→true）误判为「评论已发布」。
 * 仅识别整页挑战信号（标志性标题 + 专属元素），不靠 challenges.cloudflare.com iframe：
 * 表单内 Turnstile widget 也用该 iframe，误伤会把可自动完成的 Turnstile 站点判成失败。
 */
export function detectCloudflareChallengePage(): boolean {
	if (CLOUDFLARE_CHALLENGE_TITLE.test(document.title)) return true
	for (const sel of CLOUDFLARE_CHALLENGE_SELECTORS) {
		try {
			if (document.querySelector(sel)) return true
		} catch { /* 无效选择器 */ }
	}
	return false
}

/** 图片验证码（服务端生成扭曲字符图，如 Captcha.ashx）选择器：需人工输入，命中即放弃 */
const IMAGE_CAPTCHA_SELECTORS = [
	'img[src*="captcha" i]',
]

/**
 * 检测目标容器内是否有需人工输入的验证码（无法自动通过）：
 * - 图片验证码：src 含 captcha（如 Captcha.ashx）
 * - 验证码输入字段：input/textarea/select 的 name/id/placeholder/aria-label 含 captcha（WordPress Really Simple CAPTCHA 等）
 * - 验证码 label 文本：如 conspirazzi 的 __Captcha__（配 blob: 图片，src 不含 captcha）
 */
export function detectImageCaptcha(root: Element | Document | null): boolean {
	if (!root) return false
	for (const sel of IMAGE_CAPTCHA_SELECTORS) {
		try {
			if ((root as Element).querySelector?.(sel)) return true
		} catch { /* 无效选择器 */ }
	}
	// 验证码输入字段：属性含 captcha
	for (const el of ((root as Element).querySelectorAll?.('input, textarea, select')) ?? []) {
		const hay = `${el.getAttribute('name') ?? ''} ${el.id ?? ''} ${el.getAttribute('placeholder') ?? ''} ${el.getAttribute('aria-label') ?? ''}`.toLowerCase()
		if (hay.includes('captcha')) return true
	}
	// 验证码 label / legend 文本：如 __Captcha__
	for (const el of ((root as Element).querySelectorAll?.('label, legend')) ?? []) {
		if ((el.textContent ?? '').toLowerCase().includes('captcha')) return true
	}
	return false
}

export type SubmitSignal = 'ajax' | 'navigating' | 'pagehide' | 'timeout' | 'login_required' | 'pending_moderation'

/** Navigation API 最小类型（lib.dom 可能缺失，避免引入 any） */
interface NavNavigateEvent { destination?: { url?: string } }
interface NavApi {
	addEventListener(type: string, cb: (e: NavNavigateEvent) => void): void
	removeEventListener(type: string, cb: (e: NavNavigateEvent) => void): void
}

/**
 * 点击提交后等待提交信号：拦截 fetch/XHR + 监听 submit/beforeunload/pagehide。
 * 任一信号触发即 resolve；超时 resolve 'timeout'。结束后恢复原始 fetch/XHR。
 */
export function waitForSubmitOrNavigate(timeoutMs = 10000): Promise<SubmitSignal> {
	return new Promise((resolve) => {
		let resolved = false
		const originalFetch = window.fetch
		const originalXHROpen = window.XMLHttpRequest.prototype.open
		let timer: ReturnType<typeof setTimeout>
		let submitDelayTimer: ReturnType<typeof setTimeout> | undefined

		function finish(result: SubmitSignal) {
			if (resolved) return
			resolved = true
			cleanup()
			resolve(result)
		}
		function cleanup() {
			clearTimeout(timer)
			if (submitDelayTimer) clearTimeout(submitDelayTimer)
			document.removeEventListener('submit', onSubmit, true)
			window.removeEventListener('beforeunload', onBeforeUnload)
			window.removeEventListener('pagehide', onPageHide)
			if (onNavigate && nav) nav.removeEventListener('navigate', onNavigate)
			if (window.XMLHttpRequest) window.XMLHttpRequest.prototype.open = originalXHROpen
			if (window.fetch) window.fetch = originalFetch
		}
		// 原生表单提交会同步先触发 submit，随后才触发 beforeunload/pagehide。
		// 若立即判定 ajax 会把 WP 原生评论误标为 ajax（spec §7 要求区分 navigating）。
		// 故 submit 后延迟 150ms：期间出现 beforeunload/pagehide 则由导航信号胜出，
		// 超时未导航才判定为真正的 AJAX 提交。fetch/XHR 拦截仍立即判定 ajax。
		const onSubmit = () => {
			submitDelayTimer = setTimeout(() => finish('ajax'), 150)
		}
		const onBeforeUnload = () => finish('navigating')
		const onPageHide = () => finish('pagehide')

		// Navigation API（Chrome 102+，MV3 可用）：navigate 事件在卸载前同步触发，
		// 可在内容上下文丢失前读取目标 URL。若跳转至登录页，判定 login_required（失败）。
		const nav = (globalThis as unknown as { navigation?: NavApi }).navigation
		let onNavigate: ((e: NavNavigateEvent) => void) | undefined
		if (nav) {
			onNavigate = (e) => {
				const dest = e.destination?.url
				if (dest && isLoginRedirectUrl(dest)) finish('login_required')
				else if (dest && isModerationUrl(dest)) finish('pending_moderation')
			}
			nav.addEventListener('navigate', onNavigate)
		}

		// 拦截 fetch
		window.fetch = function (this: typeof window, input: RequestInfo | URL, init?: RequestInit) {
			const url = typeof input === 'string'
				? input
				: input instanceof URL ? input.href : input.url
			if (!resolved && isFormSubmitUrl(url)) finish('ajax')
			return originalFetch.call(this, input, init)
		} as typeof fetch

		// 拦截 XHR
		window.XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string, ...rest: unknown[]) {
			if (!resolved && isFormSubmitUrl(url)) finish('ajax')
			return originalXHROpen.apply(this, [method, url, ...rest] as unknown as Parameters<XMLHttpRequest['open']>)
		} as XMLHttpRequest['open']

		document.addEventListener('submit', onSubmit, true)
		window.addEventListener('beforeunload', onBeforeUnload)
		window.addEventListener('pagehide', onPageHide)

		timer = setTimeout(() => finish('timeout'), timeoutMs)
	})
}

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
 *
 * waitFor 为可注入的提交信号等待函数（默认 waitForSubmitOrNavigate），
 * 便于单测注入 mock 而无需依赖模块命名空间 spyOn。
 */
export async function performClick(
	button: HTMLElement | null,
	form: HTMLFormElement | null,
	waitFor: (timeoutMs: number) => Promise<SubmitSignal> = waitForSubmitOrNavigate,
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
		const submitResult = await waitFor(10000)
		return { success: true, submitResult }
	}

	return { success: false, submitResult: 'timeout', error: '所有点击策略均失败' }
}

/** 检测到 Cloudflare Turnstile 后等待自动完成的超时（managed 模式通常 2-5s，留余量） */
const CLOUDFLARE_WAIT_MS = 10000

/** executeSubmit 的返回结构（对齐 TAB_COMMAND submit case 的 sendResponse 体） */
export interface SubmitResponse {
	ok: boolean
	clicked: boolean
	verifyResult: VerifyResult
	error?: string
}

/**
 * 在当前 frame 上下文执行评论提交流程：定位按钮 → 验证码检测 → 点击 → 弱验证。
 * 纯 DOM，依赖当前 realm 的 document/window，主文档与跨域 iframe 内均可执行——
 * iframe 内 content script 调用时，裸 document/window/globalThis 自动指向该 iframe，
 * 故 resolveSubmitButton / waitForSubmitOrNavigate / 拦截器均在该 iframe 内生效。
 * 由 content.ts 的 submit case（主文档直调）与远程评论 iframe handler（postMessage 触发）共用。
 */
export async function executeSubmit(commentSelector: string | null): Promise<SubmitResponse> {
	const { form, button } = resolveSubmitButton(commentSelector)
	if (!button) {
		return { ok: true, clicked: false, verifyResult: 'not_attempted', error: '未找到提交按钮' }
	}
	// reCAPTCHA / hCaptcha：需人工、无法自动通过 → 直接放弃，不硬闯
	if (detectCaptcha(form)) {
		return { ok: true, clicked: false, verifyResult: 'captcha', error: '检测到 reCAPTCHA/hCaptcha，无法自动提交' }
	}
	// 图片验证码 / 验证码字段（Captcha.ashx、WordPress Really Simple CAPTCHA 等）：需人工输入，无法自动通过 → 直接放弃
	if (detectImageCaptcha(form)) {
		return { ok: true, clicked: false, verifyResult: 'captcha', error: '检测到验证码，需人工输入，无法自动提交' }
	}
	// Cloudflare Turnstile：managed 模式通常自动完成 → 等待后再提交，
	// 超时后若提交仍失败，由下方 verify 逻辑判定为失败
	if (detectCloudflare(form)) {
		await sleep(CLOUDFLARE_WAIT_MS)
	}

	const clickRes = await performClick(button, form)
	if (!clickRes.success) {
		return { ok: true, clicked: false, verifyResult: 'not_attempted', error: clickRes.error }
	}

	// 提交被重定向到登录页 → 直接判定失败，不再走 timeout+cleared 检查
	if (clickRes.submitResult === 'login_required') {
		return { ok: true, clicked: true, verifyResult: 'login_required', error: '检测到跳转登录页，未提交成功' }
	}

	// 评论待审核（WP 原生跳转 moderation-hash）→ 判定失败，未实际发布
	if (clickRes.submitResult === 'pending_moderation') {
		return { ok: true, clicked: true, verifyResult: 'pending_moderation', error: '评论待审核，未发布' }
	}

	// timeout 时再查评论框是否被清空（AJAX 提交成功标志）
	let verifyResult: VerifyResult = clickRes.submitResult
	// AJAX moderation：提交报告 ajax，但 DOM 可能出现待审核提示
	if (verifyResult === 'ajax') {
		await sleep(1500)
		if (isModerationContent(document)) verifyResult = 'pending_moderation'
	}
	if (verifyResult === 'timeout' && commentSelector) {
		await sleep(3000)
		const ta = document.querySelector<HTMLTextAreaElement>(commentSelector)
		const cleared = !ta || !(ta.value?.trim())
		if (cleared) verifyResult = 'cleared'
	}

	return {
		ok: true,
		clicked: true,
		verifyResult,
		error: verifyResult === 'pending_moderation' ? '评论待审核，未发布' : clickRes.error,
	}
}
