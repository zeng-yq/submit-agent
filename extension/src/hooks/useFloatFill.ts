import { useRef, useState, useEffect, useCallback } from 'react'
import type { SiteData } from '@/lib/types'
import { filterSubmittable, matchCurrentPage } from '@/lib/sites'

interface UseFloatFillOptions {
	activeProduct: { id: string } | null | undefined
	sites: SiteData[]
	startSubmission: (site: SiteData) => Promise<{ filled: number; failed: number; notes: string }>
	markSubmitted: (siteName: string, productId: string) => Promise<void>
	markFailed: (siteName: string, productId: string, error: string) => Promise<void>
	resetSubmission: (siteName: string) => Promise<void>
	reset: () => void
	resetUI: () => void
	setCurrentEngineSite: (site: SiteData | null) => void
}

export function useFloatFill({
	activeProduct,
	sites,
	startSubmission,
	markSubmitted,
	markFailed,
	resetSubmission,
	reset,
	resetUI,
	setCurrentEngineSite,
}: UseFloatFillOptions) {
	const floatFillRunningRef = useRef(false)
	const [pendingUnmatchedUrl, setPendingUnmatchedUrl] = useState<string | null>(null)

	// 用 ref 持有最新实现，每轮渲染同步更新，保持回调身份稳定
	const runFloatFillRef = useRef<() => Promise<void>>(async () => {})
	runFloatFillRef.current = async () => {
		if (floatFillRunningRef.current) return
		floatFillRunningRef.current = true
		chrome.storage.session.remove('floatFillPending').catch(() => {})
		chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'reset' }).catch(() => {})
		try {
			if (!activeProduct) {
				chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'no-product' }).catch(() => {})
				return
			}
			const res = await chrome.storage.session.get('floatFillTabId')
			const tabId = res.floatFillTabId as number | undefined
			if (!tabId) return
			try {
				const tab = await chrome.tabs.get(tabId)
				const tabUrl = tab.url ?? ''
				const submittable = filterSubmittable(sites)
				const matched = matchCurrentPage(submittable, tabUrl)
				if (matched) {
					chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'progress' }).catch(() => {})
					reset()
					setCurrentEngineSite(matched)
					try {
						const r = await startSubmission(matched)
						if (r.failed === 0 && r.filled > 0) {
							markSubmitted(matched.name, activeProduct.id)
						}
						setTimeout(() => { setCurrentEngineSite(null); resetUI() }, 3000)
					} catch (err) {
						chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'error' }).catch(() => {})
						markFailed(matched.name, activeProduct.id, err instanceof Error ? err.message : String(err))
						setTimeout(() => { setCurrentEngineSite(null); resetUI() }, 3000)
					}
				} else {
					chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'reset' }).catch(() => {})
					setPendingUnmatchedUrl(tabUrl)
				}
			} catch (err) {
				chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'error' }).catch(() => {})
			}
		} finally {
			floatFillRunningRef.current = false
		}
	}

	// 稳定身份的回调，通过 ref 委托执行
	const runFloatFill = useCallback(async () => {
		await runFloatFillRef.current()
	}, [])

	// 挂载时清理残留的 floatFillPending，避免后续误触发
	useEffect(() => {
		chrome.storage.session.remove('floatFillPending').catch(() => {})
	}, [])

	useEffect(() => {
		if (!activeProduct || sites.length === 0) return
		chrome.storage.session.get('floatFillPending').then((res) => {
			if (res.floatFillPending) {
				chrome.storage.session.remove('floatFillPending').catch(() => {})
				runFloatFill()
			}
		})
	}, [activeProduct, sites.length, runFloatFill])

	useEffect(() => {
		const handler = (message: any) => {
			if (message.type === 'FLOAT_FILL' && message.action === 'start') {
				runFloatFill()
				return
			}
			if (message.type === 'STATUS_UPDATE') {
				if (!activeProduct) return
				const { status, tabUrl } = message.payload ?? {}
				if (!status || !tabUrl) return
				const submittable = filterSubmittable(sites)
				const matched = matchCurrentPage(submittable, tabUrl)
				if (!matched) return
				if (status === 'not_started') resetSubmission(matched.name)
				else if (status === 'submitted') markSubmitted(matched.name, activeProduct.id)
				else if (status === 'failed') markFailed(matched.name, activeProduct.id)
			}
		}
		chrome.runtime.onMessage.addListener(handler)
		return () => chrome.runtime.onMessage.removeListener(handler)
	}, [runFloatFill, activeProduct, sites, markSubmitted, markFailed, resetSubmission])

	const confirmUnmatched = useCallback(async () => {
		if (!pendingUnmatchedUrl || !activeProduct) return
		const url = new URL(pendingUnmatchedUrl)
		const virtualSite: SiteData = {
			name: url.hostname,
			submit_url: pendingUnmatchedUrl,
			category: 'directory_submit',
			dr: null,
		}
		setPendingUnmatchedUrl(null)
		chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'progress' }).catch(() => {})
		reset()
		setCurrentEngineSite(virtualSite)
		try {
			const r = await startSubmission(virtualSite)
			if (r.failed === 0 && r.filled > 0) markSubmitted(virtualSite.name, activeProduct.id)
			setTimeout(() => { setCurrentEngineSite(null); resetUI() }, 3000)
		} catch (err) {
			chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'error' }).catch(() => {})
			markFailed(virtualSite.name, activeProduct.id, err instanceof Error ? err.message : String(err))
			setTimeout(() => { setCurrentEngineSite(null); resetUI() }, 3000)
		}
	}, [pendingUnmatchedUrl, activeProduct, startSubmission, markSubmitted, reset, resetUI, markFailed])

	const cancelUnmatched = useCallback(() => {
		setPendingUnmatchedUrl(null)
		chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'no-match' }).catch(() => {})
	}, [])

	return {
		pendingUnmatchedUrl,
		confirmUnmatched,
		cancelUnmatched,
	}
}
