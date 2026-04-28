import { getActiveProductId, setFloatButtonEnabled } from '@/lib/storage'
import { deleteSite, deleteSubmissionsBySite, listSubmissionsByProduct } from '@/lib/db'
import { loadSites, matchCurrentPage, reloadSites } from '@/lib/sites'
import type { SubmissionStatus } from '@/lib/types'

export default defineBackground(() => {
	console.log('[Submit Agent] Background service worker started')

	chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})

	chrome.runtime.onMessage.addListener((message, sender, sendResponse): true | undefined => {
		if (message.type === 'SUBMIT_CONTROL') {
			return handleSubmitControl(message, sendResponse)
		} else if (message.type === 'FETCH_PAGE_CONTENT') {
			return handleFetchPageContent(message, sendResponse)
		} else if (message.type === 'FLOAT_BUTTON_TOGGLE') {
			return handleFloatButtonToggle(message, sendResponse)
		} else if (message.type === 'FLOAT_FILL') {
			return handleFloatFill(message, sender, sendResponse)
		} else if (message.type === 'STATUS_UPDATE') {
			return handleStatusUpdate(message, sender)
		} else if (message.type === 'SUBMISSION_STATUS_CHANGED') {
			return handleSubmissionStatusChanged(message)
		} else if (message.type === 'CHECK_SITE_MATCH') {
			return handleCheckSiteMatch(message, sendResponse)
		} else if (message.type === 'DELETE_SITE') {
			return handleDeleteSite(message, sendResponse)
		} else {
			sendResponse({ error: 'Unknown message type' })
			return
		}
	})
})

function handleSubmitControl(
	message: { type: string; action: string; payload?: unknown },
	sendResponse: (response: unknown) => void
): true | undefined {
	switch (message.action) {
		case 'open_submit_page': {
			const url = message.payload as string
			if (!url) {
				sendResponse({ error: 'No URL provided' })
				return
			}
			;(async () => {
				try {
					const tab = await chrome.tabs.create({ url, active: true })
					if (!tab.id) {
						sendResponse({ error: 'Failed to create tab' })
						return
					}
					// 等待页面加载完成，确保内容脚本（document_end 注入）
					// 在 sidepanel 发送消息前已就绪
					const loaded = await waitForTabLoad(tab.id, TAB_COMPLETE_TIMEOUT_MS)
					if (loaded) {
						await new Promise((resolve) => setTimeout(resolve, JS_RENDER_DELAY_MS))
					} else {
						await new Promise((resolve) => setTimeout(resolve, FALLBACK_DELAY_MS))
					}
					sendResponse({ ok: true, tabId: tab.id })
				} catch (err) {
					sendResponse({ error: err instanceof Error ? err.message : String(err) })
				}
			})()
			return true
		}
		default:
			sendResponse({ error: `Unknown SUBMIT_CONTROL action: ${message.action}` })
			return
	}
}

const TAB_COMPLETE_TIMEOUT_MS = 20_000
const JS_RENDER_DELAY_MS = 2_000
const FALLBACK_DELAY_MS = 3_000

function handleFetchPageContent(
	message: { type: string; url: string },
	sendResponse: (response: unknown) => void
): true {
	const { url } = message
	let openedTabId: number | null = null

	const cleanup = async () => {
		if (openedTabId !== null) {
			try {
				await chrome.tabs.remove(openedTabId)
			} catch {
				// Tab may already be closed
			}
			openedTabId = null
		}
	}

	const run = async () => {
		try {
			// Remember the currently active tab so we can switch back after creating
			// a new tab. Using active:true avoids Chrome's background tab throttling.
			const [prevTab] = await chrome.tabs.query({ active: true, currentWindow: true })

			const tab = await chrome.tabs.create({ url, active: true })
			if (!tab.id) {
				sendResponse({ error: 'Failed to open tab' })
				return
			}
			openedTabId = tab.id

			// Immediately switch back so the user isn't disrupted.
			if (prevTab?.id) {
				chrome.tabs.update(prevTab.id, { active: true }).catch(() => {})
			}

			// Wait for tab "complete" status, but don't treat timeout as fatal.
			// Many sites have persistent connections (analytics, websockets, SSE)
			// that keep tab status as "loading" even when DOM is fully rendered.
			const loaded = await waitForTabLoad(tab.id, TAB_COMPLETE_TIMEOUT_MS)

			if (loaded) {
				await new Promise((resolve) => setTimeout(resolve, JS_RENDER_DELAY_MS))
			} else {
				// Tab didn't reach "complete", but content script (injected at document_end)
				// may already be available. Use a shorter delay before trying.
				await new Promise((resolve) => setTimeout(resolve, FALLBACK_DELAY_MS))
			}

			// Retry sendMessage up to 3 times — content script may not be
			// fully initialized on the first attempt for slow-loading pages.
			const MAX_SEND_ATTEMPTS = 3
			const RETRY_DELAY_MS = 2_000
			let lastError: string | undefined

			for (let attempt = 0; attempt < MAX_SEND_ATTEMPTS; attempt++) {
				if (attempt > 0) {
					await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
				}
				try {
					const result = await chrome.tabs.sendMessage(tab.id, {
						type: 'FLOAT_FILL',
						action: 'analyze',
						payload: { siteType: 'blog_comment' },
					})

					if (result?.ok && result.analysis) {
						sendResponse({ ok: true, analysis: result.analysis, pageContent: result.pageContent })
						return
					} else {
						sendResponse({ error: result?.error || 'Content script did not return analysis' })
						return
					}
				} catch {
					lastError = loaded
						? 'Content script did not respond'
						: `Page did not become available within ${TAB_COMPLETE_TIMEOUT_MS / 1000}s`
				}
			}

			sendResponse({ error: lastError || 'Content script did not respond' })
		} catch (err) {
			sendResponse({ error: err instanceof Error ? err.message : String(err) })
		} finally {
			await cleanup()
		}
	}

	run()
	return true
}

function waitForTabLoad(tabId: number, timeoutMs: number): Promise<boolean> {
	return new Promise((resolve) => {
		chrome.tabs.get(tabId).then((tab) => {
			if (tab.status === 'complete') {
				resolve(true)
				return
			}

			let resolved = false
			const listener = (
				updatedTabId: number,
				changeInfo: chrome.tabs.TabChangeInfo,
			) => {
				if (updatedTabId !== tabId || resolved) return
				if (changeInfo.status === 'complete') {
					resolved = true
					chrome.tabs.onUpdated.removeListener(listener)
					resolve(true)
				}
			}

			chrome.tabs.onUpdated.addListener(listener)

			setTimeout(() => {
				if (!resolved) {
					resolved = true
					chrome.tabs.onUpdated.removeListener(listener)
					resolve(false)
				}
			}, timeoutMs)
		}).catch(() => {
			resolve(false)
		})
	})
}

function handleFloatFill(
	message: { type: string; action: string; payload?: unknown },
	sender: chrome.runtime.MessageSender,
	sendResponse: (response: unknown) => void
): true {
	const tabId = sender.tab?.id

	if (message.action === 'start' && tabId) {
		// Store requesting tab so sidepanel knows which tab to operate on
		chrome.storage.session.set({ floatFillTabId: tabId, floatFillPending: true }).catch(() => {})
		// Auto-open sidepanel on this tab
		chrome.sidePanel.open({ tabId }).catch(() => {})
	}

	// Broadcast to sidepanel
	chrome.runtime.sendMessage(message).catch(() => {})

	// Forward to content script tab (chrome.runtime.sendMessage doesn't reach content scripts)
	if (!tabId) {
		chrome.storage.session.get('floatFillTabId').then((res) => {
			const targetTabId = res.floatFillTabId as number | undefined
			if (targetTabId) {
				chrome.tabs.sendMessage(targetTabId, message).catch(() => {})
			}
		}).catch(() => {})
	}

	sendResponse({ ok: true })
	return true
}

function handleStatusUpdate(
	message: { type: string; payload: unknown },
	sender: chrome.runtime.MessageSender
): undefined {
	// Broadcast status updates from content script to sidepanel, with tab URL for site matching
	chrome.runtime.sendMessage({
		...message,
		payload: { ...(message.payload as object), tabUrl: sender.tab?.url },
	}).catch(() => {})
	return
}

function handleFloatButtonToggle(
	message: { type: string; enabled: boolean },
	sendResponse: (response: unknown) => void
): true {
	const { enabled } = message
	setFloatButtonEnabled(enabled).then(() => {
		chrome.tabs.query({}, (tabs) => {
			for (const tab of tabs) {
				if (tab.id) {
					chrome.tabs.sendMessage(tab.id, { type: 'FLOAT_BUTTON_TOGGLE', enabled }).catch(() => {})
				}
			}
		})
		sendResponse({ ok: true })
	})
	return true
}

/** Map SubmissionStatus (DB) to the float button's 3-state toggle */
function toToggleState(status: SubmissionStatus): 'not_started' | 'submitted' | 'failed' {
	if (status === 'submitted' || status === 'approved') return 'submitted'
	if (status === 'failed' || status === 'rejected') return 'failed'
	return 'not_started'
}

function handleSubmissionStatusChanged(
	message: { type: string; payload: { siteName: string; toggleState: string } }
): undefined {
	// Forward status changes from sidepanel to all content script tabs
	chrome.tabs.query({}, (tabs) => {
		for (const tab of tabs) {
			if (tab.id) {
				chrome.tabs.sendMessage(tab.id, message).catch(() => {})
			}
		}
	})
	return
}

function handleCheckSiteMatch(
	message: { type: string; payload: { url: string } },
	sendResponse: (response: unknown) => void
): true {
	const url = message.payload?.url
	if (!url) {
		sendResponse({ isKnownSite: false })
		return true
	}

	(async () => {
		try {
			const sites = await loadSites()
			const matched = matchCurrentPage(sites, url)
			if (!matched) {
				sendResponse({ isKnownSite: false })
				return
			}

			const activeProductId = await getActiveProductId()
			let submissionStatus: 'not_started' | 'submitted' | 'failed' = 'not_started'

			if (activeProductId) {
				const subs = await listSubmissionsByProduct(activeProductId)
				const sub = subs.find(s => s.siteName === matched.name)
				if (sub) {
					submissionStatus = toToggleState(sub.status)
				}
			}

			sendResponse({ isKnownSite: true, siteName: matched.name, submissionStatus })
		} catch {
			sendResponse({ isKnownSite: false })
		}
	})()

	return true
}

function handleDeleteSite(
	message: { type: string; payload: { siteName: string } },
	sendResponse: (response: unknown) => void
): true {
	const { siteName } = message.payload ?? {}
	if (!siteName) {
		sendResponse({ success: false, error: 'No siteName provided' })
		return true
	}

	;(async () => {
		try {
			await deleteSite(siteName)
			await deleteSubmissionsBySite(siteName)
			await reloadSites()
			sendResponse({ success: true })
		} catch (err) {
			sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) })
		}
	})()

	return true
}
