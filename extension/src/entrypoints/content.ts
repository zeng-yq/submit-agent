import { initFloatButton } from '@/agent/FloatButton.content'
import { getFloatButtonEnabled } from '@/lib/storage'
import { analyzeForms } from '@/agent/FormAnalyzer'
import { extractPageContent } from '@/agent/PageContentExtractor'
import { isVisible, waitForFormFields, fillAndVerify } from '@/agent/dom-utils'
import { annotateFields, annotateActive, clearAnnotations } from '@/agent/FormAnnotator.content'

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

export default defineContentScript({
	matches: ['<all_urls>'],
	runAt: 'document_end',

	async main() {
		console.debug('[Submit Agent] Content script loaded on', window.location.href)
		const enabled = await getFloatButtonEnabled()
		initFloatButton(enabled)

		// Listen for form analysis and fill commands from sidepanel
		chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
			if (message.type !== 'FLOAT_FILL') return

			switch (message.action) {
				case 'analyze': {
					const siteType = message.payload?.siteType as string | undefined

					;(async () => {
							// Wait for dynamic form fields to appear (SPA support)
							await waitForFormFields()

						// Expand lazy-loaded comment forms (wpDiscuz etc.)
						// before scanning so hidden fields become visible
						await expandLazyCommentForms(document)

						const analysis = analyzeForms(document)

						if (siteType === 'blog_comment') {
							const pageContent = extractPageContent(document)
							sendResponse({ ok: true, analysis, pageContent })
						} else {
							sendResponse({ ok: true, analysis })
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
