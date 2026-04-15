import { setFloatButtonEnabled } from '@/lib/storage'
import { loadSites, matchCurrentPage } from '@/lib/sites'

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
		} else if (message.type === 'CHECK_SITE_MATCH') {
			return handleCheckSiteMatch(message, sendResponse)
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
			chrome.tabs.create({ url, active: true }).then((tab) => {
				sendResponse({ ok: true, tabId: tab.id })
			})
			return true
		}
		default:
			sendResponse({ error: `Unknown SUBMIT_CONTROL action: ${message.action}` })
			return
	}
}

const PAGE_LOAD_TIMEOUT_MS = 30_000
const JS_RENDER_DELAY_MS = 2_000

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
			const tab = await chrome.tabs.create({ url, active: false })
			if (!tab.id) {
				sendResponse({ error: 'Failed to open tab' })
				return
			}
			openedTabId = tab.id

			const loaded = await waitForTabLoad(tab.id, PAGE_LOAD_TIMEOUT_MS)
			if (!loaded) {
				sendResponse({ error: `Page load timed out after ${PAGE_LOAD_TIMEOUT_MS / 1000}s` })
				return
			}

			await new Promise((resolve) => setTimeout(resolve, JS_RENDER_DELAY_MS))

			const result = await chrome.tabs.sendMessage(tab.id, {
				type: 'FLOAT_FILL',
				action: 'analyze',
				payload: { siteType: 'directory_submit' },
			})

			if (result?.ok && result.analysis) {
				sendResponse({ ok: true, analysis: result.analysis })
			} else {
				sendResponse({ error: result?.error || 'Content script did not return analysis' })
			}
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

function handleCheckSiteMatch(
	message: { type: string; payload: { url: string } },
	sendResponse: (response: unknown) => void
): true {
	const url = message.payload?.url
	if (!url) {
		sendResponse({ isKnownSite: false })
		return true
	}

	loadSites()
		.then((sites) => {
			const matched = matchCurrentPage(sites, url)
			sendResponse({ isKnownSite: matched !== undefined })
		})
		.catch(() => {
			sendResponse({ isKnownSite: false })
		})

	return true
}
