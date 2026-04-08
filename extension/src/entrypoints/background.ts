import { handlePageControlMessage } from '@/agent/RemotePageController.background'
import { handleTabControlMessage, setupTabChangeEvents } from '@/agent/TabsController.background'
import { setFloatButtonEnabled } from '@/lib/storage'

export default defineBackground(() => {
	console.log('[Submit Agent] Background service worker started')

	setupTabChangeEvents()

	chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})

	chrome.runtime.onMessage.addListener((message, sender, sendResponse): true | undefined => {
		if (message.type === 'TAB_CONTROL') {
			return handleTabControlMessage(message, sender, sendResponse)
		} else if (message.type === 'PAGE_CONTROL') {
			return handlePageControlMessage(message, sender, sendResponse)
		} else if (message.type === 'SUBMIT_CONTROL') {
			return handleSubmitControl(message, sendResponse)
		} else if (message.type === 'FETCH_PAGE_CONTENT') {
			return handleFetchPageContent(message, sendResponse)
		} else if (message.type === 'FLOAT_BUTTON_TOGGLE') {
			return handleFloatButtonToggle(message, sendResponse)
		} else if (message.type === 'FLOAT_FILL') {
			return handleFloatFill(message, sender, sendResponse)
		} else {
			sendResponse({ error: 'Unknown message type' })
			return
		}
	})
})

function handleSubmitControl(
	message: { type: string; action: string; payload?: any },
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
			// Step 1: Open a background tab
			const tab = await chrome.tabs.create({ url, active: false })
			if (!tab.id) {
				sendResponse({ error: 'Failed to open tab' })
				return
			}
			openedTabId = tab.id

			// Step 2: Wait for the tab to finish loading
			const loaded = await waitForTabLoad(tab.id, PAGE_LOAD_TIMEOUT_MS)
			if (!loaded) {
				sendResponse({ error: `Page load timed out after ${PAGE_LOAD_TIMEOUT_MS / 1000}s` })
				return
			}

			// Step 3: Wait for JS frameworks to finish rendering
			await new Promise((resolve) => setTimeout(resolve, JS_RENDER_DELAY_MS))

			// Step 4: Ask content script for the rendered HTML
			const result = await chrome.tabs.sendMessage(tab.id, {
				type: 'PAGE_CONTROL',
				action: 'get_page_html',
			})

			if (result?.ok && result.html) {
				sendResponse({ ok: true, html: result.html })
			} else {
				sendResponse({ error: result?.error || 'Content script did not return HTML' })
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
	message: { type: string; action: string; payload?: any },
	sender: chrome.runtime.MessageSender,
	sendResponse: (response: unknown) => void
): true {
	const tabId = sender.tab?.id

	if (message.action === 'start' && tabId) {
		// Store requesting tab so sidepanel knows which tab to operate on
		chrome.storage.session.set({ floatFillTabId: tabId }).catch(() => {})
		// Auto-open sidepanel on this tab
		chrome.sidePanel.open({ tabId }).catch(() => {})
	}

	// Broadcast to sidepanel / relay back to content scripts
	chrome.runtime.sendMessage(message).catch(() => {})

	sendResponse({ ok: true })
	return true
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
