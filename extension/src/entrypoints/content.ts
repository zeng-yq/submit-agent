import { initFloatButton } from '@/agent/FloatButton.content'
import { getFloatButtonEnabled } from '@/lib/storage'
import { analyzeForms, waitForAnalysisFields } from '@/agent/FormAnalyzer'
import { extractPageContent } from '@/agent/PageContentExtractor'
import { isVisible, waitForFormFields, fillAndVerify } from '@/agent/dom-utils'
import { annotateFields, annotateActive, clearAnnotations } from '@/agent/FormAnnotator.content'
import { executeSubmit, detectModeration, type SubmitResponse } from '@/agent/comment-submit'
import { isRemoteCommentIframeHost, isRemoteCommentSystem, REMOTE_COMMENT_IFRAME_SELECTORS } from '@/agent/form-analyzer/comment-system-detector'
import { MessageRouter } from '@/messaging/router'
import type { FormAnalysisResult } from '@/agent/FormAnalyzer'
import type { VerifyResult } from '@/agent/types'

/**
 * Find and unhide form inputs within a comment form container.
 * Walks up from each hidden input to find the hidden ancestor and makes it visible.
 * Handles display:none, visibility:hidden, and opacity:0.
 */
function unhideCommentFields(triggerEl: HTMLElement): void {
	const container = triggerEl.closest(
		'#wpdcom, .wpd_comm_form, .wpd-form, .comment-form, #respond, #commentform'
	)
	if (!container) return

	const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'file'])
	const inputs = container.querySelectorAll('input, textarea, select')

	for (const input of inputs) {
		// Skip non-fillable input types
		if (input.tagName.toLowerCase() === 'input') {
			const type = (input as HTMLInputElement).type?.toLowerCase() || 'text'
			if (SKIP_TYPES.has(type)) continue
		}

		// Walk up from this input to find the first hidden ancestor within the container
		let el: HTMLElement | null = input as HTMLElement
		while (el && el !== container) {
			// Check inline style first (wpDiscuz uses style="display:none")
			if (el.style.display === 'none') {
				el.style.display = ''
				break
			}
			const computed = window.getComputedStyle(el)
			if (computed.display === 'none') {
				el.style.display = 'block'
				break
			}
			if (computed.visibility === 'hidden') {
				el.style.visibility = 'visible'
				break
			}
			if (parseFloat(computed.opacity) === 0) {
				el.style.opacity = '1'
				break
			}
			el = el.parentElement
		}
	}
}

/**
 * Inject a script into the page's JS context to simulate a real click.
 * Content scripts run in an isolated world — their dispatched events
 * don't trigger jQuery handlers used by wpDiscuz etc.
 */
function injectPageClick(el: HTMLElement): void {
	const marker = 'data-sa-click-target'
	el.setAttribute(marker, '')
	const script = document.createElement('script')
	script.textContent = `(function(){
		var el = document.querySelector('[${marker}]');
		if (!el) return;
		el.removeAttribute('${marker}');
		el.focus();
		el.click();
		if (typeof jQuery === 'function') {
			jQuery(el).trigger('focus').trigger('click');
		}
	})();`
	document.documentElement.appendChild(script)
	script.remove()
}

async function expandLazyCommentForms(doc: Document): Promise<void> {
	// Selectors for comment inputs that commonly trigger field expansion.
	// Includes both <textarea> and contenteditable divs (wpDiscuz newer versions
	// use contenteditable instead of textarea for the comment input).
	const TRIGGERS = [
		// wpDiscuz — contenteditable variants (newer versions)
		'#wpdcom .wpd-field-textarea [contenteditable="true"]',
		'.wpdiscuz-textarea-wrap [contenteditable="true"]',
		'.wpd-comm .wpd-field-textarea [contenteditable="true"]',
		// wpDiscuz — textarea variants (older versions)
		'#wpdcom textarea',
		'.wpdiscuz-textarea-wrap textarea',
		'#wc_comment',
		'.wpd-field-textarea textarea',
		// WordPress default
		'#respond textarea#comment',
		'.comment-form textarea',
		'#commentform textarea',
		// Generic
		'textarea[name="comment"]',
		'textarea[id*="comment"]',
	]

	let triggerEl: HTMLElement | null = null
	for (const sel of TRIGGERS) {
		triggerEl = doc.querySelector(sel)
		if (triggerEl && isVisible(triggerEl)) break
		triggerEl = null
	}

	if (!triggerEl) return

	// Inject click into the page's JS context so wpDiscuz jQuery handlers fire
	injectPageClick(triggerEl)

	// Wait for DOM changes (wpDiscuz shows name/email fields via JS)
	await new Promise<void>((resolve) => {
		const observer = new MutationObserver(() => {})
		observer.observe(doc.body, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ['style', 'class'],
		})
		setTimeout(() => {
			observer.disconnect()
			resolve()
		}, 800)
	})

	// Fallback: directly unhide fields that are still hidden
	unhideCommentFields(triggerEl)
}

/** Message source identifier for cross-origin iframe communication */
const SA_MSG_SOURCE = 'submit-agent-iframe'

/** Request form analysis from a Blogger iframe via postMessage */
function requestIframeAnalysis(iframe: HTMLIFrameElement): Promise<FormAnalysisResult | null> {
	return new Promise((resolve) => {
		const timeout = setTimeout(() => {
			window.removeEventListener('message', handler)
			resolve(null)
		}, 4000)

		const handler = (event: MessageEvent) => {
			if (event.data?.source !== SA_MSG_SOURCE) return
			if (event.data?.type !== 'IFRAME_ANALYSIS_RESULT') return
			clearTimeout(timeout)
			window.removeEventListener('message', handler)
			resolve(event.data.analysis as FormAnalysisResult)
		}

		window.addEventListener('message', handler)
		try {
			iframe.contentWindow?.postMessage(
				{ source: SA_MSG_SOURCE, type: 'REQUEST_IFRAME_ANALYSIS' },
				'*',
			)
		} catch {
			clearTimeout(timeout)
			window.removeEventListener('message', handler)
			resolve(null)
		}
	})
}

/** Send fill commands to a Blogger iframe via postMessage */
function fillIframeFields(
	iframe: HTMLIFrameElement,
	fields: Array<{ canonical_id: string; value: string; selector: string }>,
): Promise<{ filled: number; failed: number }> {
	return new Promise((resolve) => {
		const timeout = setTimeout(() => {
			window.removeEventListener('message', handler)
			resolve({ filled: 0, failed: fields.length })
		}, 5000)

		const handler = (event: MessageEvent) => {
			if (event.data?.source !== SA_MSG_SOURCE) return
			if (event.data?.type !== 'IFRAME_FILL_RESULT') return
			clearTimeout(timeout)
			window.removeEventListener('message', handler)
			resolve(event.data.result as { filled: number; failed: number })
		}

		window.addEventListener('message', handler)
		try {
			iframe.contentWindow?.postMessage(
				{ source: SA_MSG_SOURCE, type: 'FILL_IFRAME_FIELDS', fields },
				'*',
			)
		} catch {
			clearTimeout(timeout)
			window.removeEventListener('message', handler)
			resolve({ filled: 0, failed: fields.length })
		}
	})
}

/**
 * 通过 postMessage 让远程评论 iframe 在其自身上下文内执行提交（按钮在跨域 iframe 内）。
 * 17s 超时：外层 FormFillEngine sendToTab 为 20s，留 3s IPC 抖动；超时返回 null 由调用方兜底。
 */
function submitViaIframe(
	iframe: HTMLIFrameElement,
	commentSelector: string | null,
): Promise<SubmitResponse | null> {
	return new Promise((resolve) => {
		const timeout = setTimeout(() => {
			window.removeEventListener('message', handler)
			resolve(null)
		}, 17000)

		const handler = (event: MessageEvent) => {
			if (event.data?.source !== SA_MSG_SOURCE) return
			if (event.data?.type !== 'IFRAME_SUBMIT_RESULT') return
			clearTimeout(timeout)
			window.removeEventListener('message', handler)
			resolve(event.data.result as SubmitResponse)
		}

		window.addEventListener('message', handler)
		try {
			iframe.contentWindow?.postMessage(
				{ source: SA_MSG_SOURCE, type: 'SUBMIT_IFRAME', commentSelector },
				'*',
			)
		} catch {
			clearTimeout(timeout)
			window.removeEventListener('message', handler)
			resolve(null)
		}
	})
}

/** Initialize remote comment iframe content script handlers (Blogger / Jetpack Verbum) */
function initRemoteCommentIframeHandlers(): void {
	window.addEventListener('message', async (event: MessageEvent) => {
		if (event.data?.source !== SA_MSG_SOURCE) return

		if (event.data.type === 'REQUEST_IFRAME_ANALYSIS') {
			// 远程评论表单（Jetpack Verbum）可能懒加载，轮询等待字段渲染再回传
			const analysis = await waitForAnalysisFields(document)
			event.source?.postMessage(
				{ source: SA_MSG_SOURCE, type: 'IFRAME_ANALYSIS_RESULT', analysis },
				{ targetOrigin: '*' },
			)
		}

		if (event.data.type === 'FILL_IFRAME_FIELDS') {
			const fields = event.data.fields as Array<{
				canonical_id: string
				value: string
				selector: string
			}>
			let filled = 0
			let failed = 0
			for (const field of fields) {
				try {
					const el = document.querySelector(field.selector)
					if (el) {
						const ok = await fillAndVerify(el as HTMLElement, field.value)
						ok ? filled++ : failed++
					} else {
						failed++
					}
				} catch {
					failed++
				}
			}
			event.source?.postMessage(
				{ source: SA_MSG_SOURCE, type: 'IFRAME_FILL_RESULT', result: { filled, failed } },
				{ targetOrigin: '*' },
			)
		}

		if (event.data.type === 'SUBMIT_IFRAME') {
			// 在 iframe 自身上下文执行提交（裸 document/window 自动指向该 iframe）
			const commentSelector = (event.data.commentSelector as string | null) ?? null
			const result = await executeSubmit(commentSelector)
			event.source?.postMessage(
				{ source: SA_MSG_SOURCE, type: 'IFRAME_SUBMIT_RESULT', result },
				{ targetOrigin: '*' },
			)
		}
	})
}

export default defineContentScript({
	matches: ['<all_urls>'],
	runAt: 'document_end',
	allFrames: true,

	async main() {
		console.debug('[Submit Agent] Content script loaded on', window.location.href)

		// Iframe context: only handle remote comment iframes (Blogger / Jetpack Verbum)
		if (window !== window.top) {
			if (isRemoteCommentIframeHost(location.hostname)) {
				initRemoteCommentIframeHandlers()
			}
			return
		}

		const enabled = await getFloatButtonEnabled()
		await initFloatButton(enabled)

		// 路由 FLOAT_FILL 消息到各 action handler（handler 改返回风格，由 router 统一管 sendResponse + 保活）
		const router = new MessageRouter()
		registerContentHandlers(router)
		router.attachRuntimeListener()
	},
})

/**
 * 注册 content 侧 8 个 FLOAT_FILL action handler。
 *
 * FLOAT_FILL 暂未纳入 ExtensionMessage 联合（T4 统一改名 TAB_COMMAND 时补齐），
 * `router.on` 第一参数用 `'FLOAT_FILL' as any` 过渡绕过类型守门，T4 后移除。
 * handler 内访问 payload 用 `as` 窄化（与原 switch 行为等价）。
 */
export function registerContentHandlers(router: MessageRouter): void {
	router.on('FLOAT_FILL' as any, 'analyze', async (msg: any) => {
		const siteType = (msg as { payload?: { siteType?: string } }).payload?.siteType
		await waitForFormFields()
		await expandLazyCommentForms(document)
		const analysis = analyzeForms(document)
		if (isRemoteCommentSystem(analysis.commentSystem?.name) && analysis.fields.length === 0) {
			const iframe = document.querySelector<HTMLIFrameElement>(REMOTE_COMMENT_IFRAME_SELECTORS)
			if (iframe) {
				// 滚动 iframe 进入视口，触发懒加载的远程评论表单（Jetpack Verbum）渲染
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

	router.on('FLOAT_FILL' as any, 'fill', async (msg: any) => {
		const fields = (msg as { payload?: { fields?: Array<{ canonical_id: string; value: string; selector: string }> } }).payload?.fields
		if (!fields) return { ok: false, error: 'No fields provided' }
		let filled = 0
		let failed = 0
		// 远程评论 iframe（Blogger / Jetpack Verbum）：字段在跨域 iframe 内
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
				} catch {
					failed++
				}
			}
		}
		return { ok: true, filled, failed }
	})

	router.on('FLOAT_FILL' as any, 'annotate', (msg: any) => {
		const fields = (msg as { payload?: { fields?: Array<{ selector: string }> } }).payload?.fields
		if (fields) annotateFields(fields)
		return { ok: true }
	})

	router.on('FLOAT_FILL' as any, 'annotate-active', (msg: any) => {
		const index = (msg as { payload?: { index?: number } }).payload?.index
		if (typeof index === 'number') annotateActive(index)
		return { ok: true }
	})

	router.on('FLOAT_FILL' as any, 'annotate-clear', () => {
		clearAnnotations()
		return { ok: true }
	})

	router.on('FLOAT_FILL' as any, 'scroll-to-first', (msg: any) => {
		const fields = (msg as { payload?: { fields?: Array<{ selector: string }> } }).payload?.fields
		if (fields && fields.length > 0) {
			const firstEl = document.querySelector(fields[0].selector)
			if (firstEl) (firstEl as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' })
		}
		return { ok: true }
	})

	// 整页跳转后引擎复核：返回当前页是否处于待审核（URL 参数 或 DOM 标记）
	router.on('FLOAT_FILL' as any, 'verify-moderation', () => ({ ok: true, moderation: detectModeration() }))

	router.on('FLOAT_FILL' as any, 'submit', async (msg: any) => {
		const fields = (msg as { payload?: { fields?: Array<{ selector: string; type?: string; effective_type?: string; name?: string; id?: string; canonical_id?: string }> } }).payload?.fields
		try {
			// 从已填字段里识别评论框 selector（textarea / comment 语义）
			const commentField = fields?.find((f) =>
				f.type === 'textarea'
				|| f.effective_type === 'comment'
				|| /comment|reply|message/i.test(`${f.canonical_id ?? ''} ${f.name ?? ''} ${f.id ?? ''}`)
			)
			const commentSelector = commentField?.selector ?? null

			// 远程评论 iframe（Blogger / Jetpack Verbum）：提交按钮在跨域 iframe 内，
			// 主文档定位不到 → 通过 postMessage 让 iframe 在自身上下文执行 executeSubmit
			const remoteIframe = document.querySelector<HTMLIFrameElement>(REMOTE_COMMENT_IFRAME_SELECTORS)
			if (remoteIframe) {
				const r = await submitViaIframe(remoteIframe, commentSelector)
				// 【bug 修复】iframe 超时（submitViaIframe 返回 null）：原返回 ok:true+not_attempted
				// 会让 runSubmitAndVerify（FormFillEngine.ts:179）因 ok:true 跳过跨页复核。改为
				// verifyResult:'navigating' 命中 FormFillEngine.ts:189 的 navigating→verifyNavigation
				// 分支（与 resolveLostSignal 用 navigating 表达"经导航验证"的既有语义一致），
				// 给跨页复核一次机会。
				return r ?? { ok: true, clicked: true, verifyResult: 'navigating' as VerifyResult, error: '跨域 iframe 提交超时，转入跨页面验证' }
			}

			// 主文档路径（普通 WP 等原生表单）：executeSubmit 在当前上下文执行
			return await executeSubmit(commentSelector)
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) }
		}
	})
}
