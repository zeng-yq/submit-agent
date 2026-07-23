import { getActiveProductId, setFloatButtonEnabled } from '@/lib/storage'
import { deleteSite, deleteSubmissionsBySite, listSubmissionsByProduct, getSite, addSite } from '@/lib/db'
import { loadSites, matchCurrentPage, reloadSites } from '@/lib/sites'
import type { SubmissionStatus } from '@/lib/types'
import { MessageRouter, type MsgCtx } from '@/messaging/router'
import type { ExtensionMessage } from '@/messaging/messages'

export default defineBackground(() => {
	console.log('[Submit Agent] Background service worker started')

	chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})

	const router = new MessageRouter()
	registerBackgroundHandlers(router)

	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
		const ctx: MsgCtx = { sender, tabId: sender.tab?.id }
		return router.dispatch(message as ExtensionMessage, ctx, sendResponse)
	})
})

export function registerBackgroundHandlers(router: MessageRouter): void {
	router.on('SUBMIT_CONTROL', (msg, ctx) => handleSubmitControl(msg as any, ctx))
	router.on('FETCH_PAGE_CONTENT', (msg) => handleFetchPageContent(msg as any))
	router.on('FLOAT_BUTTON_TOGGLE', (msg) => handleFloatButtonToggle(msg as any))
	router.on('FILL_PROGRESS', (msg, ctx) => handleFloatFill(msg, ctx))
	router.on('SUBMISSION_STATUS_CHANGED', (msg, ctx) => handleSubmissionStatusChanged(msg as any, ctx))
	router.on('CHECK_SITE_MATCH', (msg) => handleCheckSiteMatch(msg as any))
	router.on('DELETE_SITE', (msg) => handleDeleteSite(msg as any))
	router.on('FLOAT_ADD_SITE', (msg, ctx) => handleFloatAddSite(msg as any, ctx))
	router.on('ADD_SITE', (msg) => handleAddSite(msg as any))
	router.on('CLOSE_TAB', (_msg, ctx) => {
		if (ctx.tabId != null) chrome.tabs.remove(ctx.tabId).catch(() => {})
	})
	// STATUS_UPDATE：T6 确认无发送方后删除；SITE_ADDED 仅 bg 发送（无需 bg handler）
}

async function handleSubmitControl(
	message: { type: string; action: string; payload?: unknown },
	_ctx: MsgCtx,
): Promise<unknown> {
	switch (message.action) {
		case 'open_submit_page': {
			const url = message.payload as string
			if (!url) {
				return { error: 'No URL provided' }
			}
			try {
				const tab = await chrome.tabs.create({ url, active: true })
				if (!tab.id) {
					return { error: 'Failed to create tab' }
				}
				// 等待页面加载完成，确保内容脚本（document_end 注入）
				// 在 sidepanel 发送消息前已就绪
				const loaded = await waitForTabLoad(tab.id, TAB_COMPLETE_TIMEOUT_MS)
				if (loaded) {
					await new Promise((resolve) => setTimeout(resolve, JS_RENDER_DELAY_MS))
				} else {
					await new Promise((resolve) => setTimeout(resolve, FALLBACK_DELAY_MS))
				}
				return { ok: true, tabId: tab.id }
			} catch (err) {
				return { error: err instanceof Error ? err.message : String(err) }
			}
		}
		default:
			return { error: `Unknown SUBMIT_CONTROL action: ${message.action}` }
	}
}

const TAB_COMPLETE_TIMEOUT_MS = 20_000
const JS_RENDER_DELAY_MS = 2_000
const FALLBACK_DELAY_MS = 3_000

async function handleFetchPageContent(message: { type: string; url: string }): Promise<unknown> {
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

	try {
		// Remember the currently active tab so we can switch back after creating
		// a new tab. Using active:true avoids Chrome's background tab throttling.
		const [prevTab] = await chrome.tabs.query({ active: true, currentWindow: true })

		const tab = await chrome.tabs.create({ url, active: true })
		if (!tab.id) {
			return { error: 'Failed to open tab' }
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
					type: 'TAB_COMMAND',
					action: 'analyze',
					payload: { siteType: 'blog_comment' },
				})

				if (result?.ok && result.analysis) {
					return { ok: true, analysis: result.analysis, pageContent: result.pageContent }
				} else {
					return { error: result?.error || 'Content script did not return analysis' }
				}
			} catch {
				lastError = loaded
					? 'Content script did not respond'
					: `Page did not become available within ${TAB_COMPLETE_TIMEOUT_MS / 1000}s`
			}
		}

		return { error: lastError || 'Content script did not respond' }
	} catch (err) {
		return { error: err instanceof Error ? err.message : String(err) }
	} finally {
		await cleanup()
	}
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

async function handleFloatFill(
	message: { type: string; action: string; payload?: unknown },
	ctx: MsgCtx,
): Promise<{ ok: true }> {
	const tabId = ctx.tabId

	if (message.action === 'start' && tabId) {
		// Ensure floatFillTabId is written before broadcasting, so sidepanel
		// always reads the correct value instead of a stale one.
		chrome.storage.session.set({ floatFillTabId: tabId, floatFillPending: true })
			.then(() => {
				chrome.sidePanel.open({ tabId }).catch(() => {})
				chrome.runtime.sendMessage(message).catch(() => {})
			})
			.catch(() => {
				chrome.sidePanel.open({ tabId }).catch(() => {})
				chrome.runtime.sendMessage(message).catch(() => {})
			})
	} else {
		// Broadcast to sidepanel
		chrome.runtime.sendMessage(message).catch(() => {})
	}

	// Forward to content script tab (chrome.runtime.sendMessage doesn't reach content scripts)
	if (!tabId) {
		chrome.storage.session.get('floatFillTabId').then((res) => {
			const targetTabId = res.floatFillTabId as number | undefined
			if (targetTabId) {
				chrome.tabs.sendMessage(targetTabId, message).catch(() => {})
			}
		}).catch(() => {})
	}

	return { ok: true }
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

async function handleFloatButtonToggle(message: { type: string; enabled: boolean }): Promise<{ ok: true }> {
	const { enabled } = message
	await setFloatButtonEnabled(enabled)
	chrome.tabs.query({}, (tabs) => {
		for (const tab of tabs) {
			if (tab.id) {
				chrome.tabs.sendMessage(tab.id, { type: 'FLOAT_BUTTON_TOGGLE', enabled }).catch(() => {})
			}
		}
	})
	return { ok: true }
}

/** Map SubmissionStatus (DB) to the float button's 3-state toggle */
function toToggleState(status: SubmissionStatus): 'not_started' | 'submitted' | 'failed' {
	if (status === 'submitted' || status === 'approved') return 'submitted'
	if (status === 'failed' || status === 'rejected') return 'failed'
	return 'not_started'
}

function handleSubmissionStatusChanged(
	message: { type: string; payload: { siteName: string; toggleState: string } },
	_ctx: MsgCtx,
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

async function handleCheckSiteMatch(
	message: { type: string; payload: { url: string } },
): Promise<{ isKnownSite: boolean; siteName?: string; submissionStatus?: 'not_started' | 'submitted' | 'failed' }> {
	const url = message.payload?.url
	if (!url) {
		return { isKnownSite: false }
	}
	try {
		const sites = await loadSites()
		const matched = matchCurrentPage(sites, url)
		if (!matched) {
			return { isKnownSite: false }
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

		return { isKnownSite: true, siteName: matched.name, submissionStatus }
	} catch {
		return { isKnownSite: false }
	}
}

async function handleDeleteSite(
	message: { type: string; payload: { siteName: string } },
): Promise<{ success: boolean; error?: string }> {
	const { siteName } = message.payload ?? {}
	if (!siteName) {
		return { success: false, error: 'No siteName provided' }
	}
	try {
		await deleteSite(siteName)
		await deleteSubmissionsBySite(siteName)
		await reloadSites()
		chrome.runtime.sendMessage({ type: 'SITES_CHANGED' }).catch(() => {})
		return { success: true }
	} catch (err) {
		return { success: false, error: err instanceof Error ? err.message : String(err) }
	}
}

async function handleFloatAddSite(
	message: { type: string; url: string },
	ctx: MsgCtx,
): Promise<{ ok: true }> {
	const tabId = ctx.tabId
	if (tabId) {
		chrome.sidePanel.open({ tabId }).catch(() => {})
		chrome.runtime.sendMessage({ type: 'FLOAT_ADD_SITE', url: message.url }).catch(() => {})
	}
	return { ok: true }
}

async function handleAddSite(
	message: { type: string; payload: { name: string; submit_url: string; domain?: string; category: string; dr: number; notes: string } },
): Promise<{ success: boolean; error?: string }> {
	const { name, submit_url, domain, category, dr, notes } = message.payload
	if (!name) {
		return { success: false, error: 'No name provided' }
	}
	try {
		const existing = await getSite(name)
		if (existing) {
			return { success: false, error: '该外链已存在' }
		}
		const now = Date.now()
		await addSite({
			name,
			submit_url,
			domain,
			category: category as import('@/lib/types').SiteCategory,
			dr,
			notes: notes || undefined,
			createdAt: now,
			updatedAt: now,
		})
		await reloadSites()
		chrome.runtime.sendMessage({ type: 'SITES_CHANGED' }).catch(() => {})
		chrome.tabs.query({}, (tabs) => {
			for (const tab of tabs) {
				if (tab.id) {
					chrome.tabs.sendMessage(tab.id, { type: 'SITE_ADDED', url: submit_url }).catch(() => {})
				}
			}
		})
		return { success: true }
	} catch (err) {
		return { success: false, error: err instanceof Error ? err.message : String(err) }
	}
}
