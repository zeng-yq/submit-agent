import { initFloatButton } from '@/agent/FloatButton.content'
import { getFloatButtonEnabled } from '@/lib/storage'
import { analyzeForms } from '@/agent/FormAnalyzer'
import { extractPageContent } from '@/agent/PageContentExtractor'
import { isVisible, waitForFormFields, fillAndVerify } from '@/agent/dom-utils'
import { annotateFields, annotateActive, clearAnnotations } from '@/agent/FormAnnotator.content'
import type { FormAnalysisResult } from '@/agent/FormAnalyzer'

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

/** Initialize Blogger iframe content script handlers */
function initBloggerIframeHandlers(): void {
	window.addEventListener('message', async (event: MessageEvent) => {
		if (event.data?.source !== SA_MSG_SOURCE) return

		if (event.data.type === 'REQUEST_IFRAME_ANALYSIS') {
			const analysis = analyzeForms(document)
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

/** CSS selectors for Blogger comment iframe */
const BLOGGER_IFRAME_SELECTORS = 'iframe#comment-editor, iframe.blogger-comment-from-post, iframe[src*="blogger.com/comment"]'

export default defineContentScript({
	matches: ['<all_urls>'],
	runAt: 'document_end',
	allFrames: true,

	async main() {
		console.debug('[Submit Agent] Content script loaded on', window.location.href)

		// Iframe context: only handle Blogger comment iframe
		if (window !== window.top) {
			if (location.hostname.includes('blogger.com')) {
				initBloggerIframeHandlers()
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

							// When Blogger comment system detected but no fields found,
							// try to get fields from the Blogger iframe via postMessage
							if (analysis.commentSystem?.name === 'blogger' && analysis.fields.length === 0) {
								const iframe = document.querySelector<HTMLIFrameElement>(BLOGGER_IFRAME_SELECTORS)
								if (iframe) {
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

						// Check if fields are in a Blogger iframe
						const bloggerIframe = document.querySelector<HTMLIFrameElement>(BLOGGER_IFRAME_SELECTORS)

						if (bloggerIframe) {
							const result = await fillIframeFields(bloggerIframe, fields)
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
			}
		})
	},
})
