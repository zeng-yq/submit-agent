import { initFloatButton } from '@/agent/FloatButton.content'
import { getFloatButtonEnabled } from '@/lib/storage'
import { analyzeForms, waitForAnalysisFields } from '@/agent/FormAnalyzer'
import { extractPageContent } from '@/agent/PageContentExtractor'
import { isVisible, waitForFormFields, fillAndVerify } from '@/agent/dom-utils'
import { annotateFields, annotateActive, clearAnnotations } from '@/agent/FormAnnotator.content'
import { resolveSubmitButton, detectCaptcha, detectCloudflare, detectImageCaptcha, performClick, isModerationContent, detectModeration } from '@/agent/comment-submit'
import { isRemoteCommentIframeHost, isRemoteCommentSystem, REMOTE_COMMENT_IFRAME_SELECTORS } from '@/agent/form-analyzer/comment-system-detector'
import type { FormAnalysisResult } from '@/agent/FormAnalyzer'
import type { VerifyResult } from '@/agent/types'

/** 检测到 Cloudflare Turnstile 后等待自动完成的超时（managed 模式通常 2-5s，留余量） */
const CLOUDFLARE_WAIT_MS = 10000

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

		// Listen for form analysis and fill commands from sidepanel
		chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
			if (message.type !== 'FLOAT_FILL') return

			switch (message.action) {
				case 'analyze': {
					const siteType = message.payload?.siteType as string | undefined

					;(async () => {
						try {
							// Wait for dynamic form fields to appear (SPA support)
							await waitForFormFields()

							// Expand lazy-loaded comment forms (wpDiscuz etc.)
							// before scanning so hidden fields become visible
							await expandLazyCommentForms(document)

							const analysis = analyzeForms(document)

							// When a remote comment system (Blogger / Jetpack Verbum) is detected but no
							// fields found in the main document, fetch them from the cross-origin iframe
							// via postMessage.
							if (isRemoteCommentSystem(analysis.commentSystem?.name) && analysis.fields.length === 0) {
								const iframe = document.querySelector<HTMLIFrameElement>(REMOTE_COMMENT_IFRAME_SELECTORS)
								if (iframe) {
									// 滚动 iframe 进入视口，触发懒加载的远程评论表单（Jetpack Verbum）渲染
									iframe.scrollIntoView({ block: 'center' })
									const iframeAnalysis = await requestIframeAnalysis(iframe)
									if (iframeAnalysis) {
										analysis.fields = iframeAnalysis.fields
									}
								}
							}

							if (siteType === 'blog_comment') {
								const pageContent = extractPageContent(document)
								sendResponse({ ok: true, analysis, pageContent })
							} else {
								sendResponse({ ok: true, analysis })
							}
						} catch (err) {
							sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
						}
					})()

					return true // keep message channel open for async response
				}
				case 'fill': {
					const fields = message.payload?.fields as Array<{
						canonical_id: string
						value: string
						selector: string
					}>
					if (!fields) {
						sendResponse({ ok: false, error: 'No fields provided' })
						return
					}

					;(async () => {
						let filled = 0
						let failed = 0

						// Check if fields are in a remote comment iframe (Blogger / Jetpack Verbum)
						const remoteIframe = document.querySelector<HTMLIFrameElement>(REMOTE_COMMENT_IFRAME_SELECTORS)

						if (remoteIframe) {
							const result = await fillIframeFields(remoteIframe, fields)
							filled += result.filled
							failed += result.failed
						} else {
							for (const field of fields) {
								try {
									const el = document.querySelector(field.selector)
									if (el) {
										const ok = await fillAndVerify(el as HTMLElement, field.value)
										if (ok) {
											filled++
										} else {
											failed++
										}
									} else {
										failed++
									}
								} catch {
									failed++
								}
							}
						}

						sendResponse({ ok: true, filled, failed })
					})()

					return true // keep message channel open for async response
				}
				case 'annotate': {
					const fields = message.payload?.fields as Array<{ selector: string }> | undefined
					if (fields) {
						annotateFields(fields)
					}
					sendResponse({ ok: true })
					return
				}
				case 'scroll-to-first': {
					const fields = message.payload?.fields as Array<{ selector: string }> | undefined
					if (fields && fields.length > 0) {
						const firstEl = document.querySelector(fields[0].selector)
						if (firstEl) {
							;(firstEl as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' })
						}
					}
					sendResponse({ ok: true })
					return
				}
				case 'annotate-active': {
					const index = message.payload?.index as number | undefined
					if (typeof index === 'number') {
						annotateActive(index)
					}
					sendResponse({ ok: true })
					return
				}
				case 'annotate-clear': {
					clearAnnotations()
					sendResponse({ ok: true })
					return
				}
				case 'verify-moderation': {
					// 整页跳转后引擎复核：返回当前页是否处于待审核（URL 参数 或 DOM 标记）
					sendResponse({ ok: true, moderation: detectModeration() })
					return
				}
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
							// reCAPTCHA / hCaptcha：需人工、无法自动通过 → 直接失败，不硬闯
							if (detectCaptcha(form)) {
								sendResponse({ ok: true, clicked: false, verifyResult: 'not_attempted' as VerifyResult, error: '检测到 reCAPTCHA/hCaptcha，请手动提交' })
								return
							}
							// 图片验证码（如 Captcha.ashx）：需人工输入 → 填好其他字段后放弃提交，由用户手动补验证码
							if (detectImageCaptcha(form)) {
								sendResponse({ ok: true, clicked: false, verifyResult: 'not_attempted' as VerifyResult, error: '检测到图片验证码，请手动填写后提交' })
								return
							}
							// Cloudflare Turnstile：managed 模式通常自动完成 → 等待超时后再提交，
							// 超时后若提交仍失败，由下方 verify 逻辑判定为失败
							if (detectCloudflare(form)) {
								await new Promise((r) => setTimeout(r, CLOUDFLARE_WAIT_MS))
							}

							const clickRes = await performClick(button, form)
							if (!clickRes.success) {
								sendResponse({ ok: true, clicked: false, verifyResult: 'not_attempted' as VerifyResult, error: clickRes.error })
								return
							}

							// 提交被重定向到登录页 → 直接判定失败，不再走 timeout+cleared 检查
							if (clickRes.submitResult === 'login_required') {
								sendResponse({ ok: true, clicked: true, verifyResult: 'login_required' as VerifyResult, error: '检测到跳转登录页，未提交成功' })
								return
							}

							// 评论待审核（WP 原生跳转 moderation-hash）→ 判定失败，未实际发布
							if (clickRes.submitResult === 'pending_moderation') {
								sendResponse({ ok: true, clicked: true, verifyResult: 'pending_moderation' as VerifyResult, error: '评论待审核，未发布' })
								return
							}

							// timeout 时再查评论框是否被清空（AJAX 提交成功标志）
							let verifyResult: VerifyResult = clickRes.submitResult
							// AJAX moderation：提交报告 ajax，但 DOM 可能出现待审核提示
							if (verifyResult === 'ajax') {
								await new Promise((r) => setTimeout(r, 1500))
								if (isModerationContent(document)) verifyResult = 'pending_moderation'
							}
							if (verifyResult === 'timeout' && commentSelector) {
								await new Promise((r) => setTimeout(r, 3000))
								const ta = document.querySelector<HTMLTextAreaElement>(commentSelector)
								const cleared = !ta || !(ta.value?.trim())
								if (cleared) verifyResult = 'cleared'
							}

							sendResponse({ ok: true, clicked: true, verifyResult, error: verifyResult === 'pending_moderation' ? '评论待审核，未发布' : clickRes.error })
						} catch (err) {
							sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
						}
					})()

					return true // keep message channel open for async response
				}
			}
		})
	},
})
