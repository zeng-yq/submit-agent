import { initFloatButton } from '@/agent/FloatButton.content'
import { getFloatButtonEnabled } from '@/lib/storage'
import { analyzeForms } from '@/agent/FormAnalyzer'
import { extractPageContent } from '@/agent/PageContentExtractor'
import { fillField } from '@/agent/dom-utils'
import { annotateFields, annotateActive, clearAnnotations } from '@/agent/FormAnnotator.content'

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
						// Wait briefly for SPA hydration if title is empty
						if (!document.title) {
							await new Promise(r => setTimeout(r, 500))
						}

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

					let filled = 0
					let failed = 0

					for (const field of fields) {
						try {
							const el = document.querySelector(field.selector)
							if (el) {
								fillField(el as HTMLElement, field.value)
								filled++
							} else {
								failed++
							}
						} catch {
							failed++
						}
					}

					sendResponse({ ok: true, filled, failed })
					return
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
