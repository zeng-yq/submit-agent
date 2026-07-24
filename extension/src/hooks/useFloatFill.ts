import { useRef, useState, useEffect, useCallback } from 'react'
import type { SiteData } from '@/lib/types'
import { VERIFIED_SUCCESS, verifyResultLabel } from '@/agent/types'
import type { VerifyResult } from '@/agent/types'
import { filterSubmittable, matchCurrentPage } from '@/lib/sites'
import { sendProgress } from '@/messaging/router'
import type { ExtensionMessage } from '@/messaging/messages'

interface UseFloatFillOptions {
	activeProduct: { id: string } | null | undefined
	sites: SiteData[]
	startSubmission: (site: SiteData) => Promise<{ filled: number; failed: number; notes: string; verifyResult?: string; submitError?: string }>
	markSubmitted: (siteName: string, productId: string, verifyResult?: string) => Promise<void>
	markFailed: (siteName: string, productId: string, error?: string, verifyResult?: string) => Promise<void>
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
		sendProgress('reset')
		try {
			if (!activeProduct) {
				sendProgress('no-product')
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
					sendProgress('progress')
					reset()
					setCurrentEngineSite(matched)
					try {
						const r = await startSubmission(matched)
						const isBlogComment = matched.category === 'blog_comment'
						if (isBlogComment) {
							// blog_comment：以提交验证结果为准
							// TODO: 入库映射逻辑待补单测（见 spec §7）—— 需 mock chrome + 注入 markSubmitted/markFailed 驱动 FILL_PROGRESS start，当前依赖手动验证矩阵覆盖
							const verified = VERIFIED_SUCCESS.includes((r.verifyResult ?? 'not_attempted') as VerifyResult)
							if (verified) {
								markSubmitted(matched.name, activeProduct.id, r.verifyResult)
							} else {
								sendProgress('error')
								markFailed(matched.name, activeProduct.id, r.submitError || verifyResultLabel(r.verifyResult), r.verifyResult)
							}
						} else {
							// directory：维持原逻辑（填写成功即标记，不自动提交）
							if (r.failed === 0 && r.filled > 0) {
								markSubmitted(matched.name, activeProduct.id)
							} else if (r.filled === 0) {
								sendProgress('error')
								markFailed(matched.name, activeProduct.id, '页面未发现可填写的表单字段')
							}
						}
						setTimeout(() => { setCurrentEngineSite(null); resetUI() }, 3000)
					} catch (err) {
						sendProgress('error')
						markFailed(matched.name, activeProduct.id, err instanceof Error ? err.message : String(err))
						setTimeout(() => { setCurrentEngineSite(null); resetUI() }, 3000)
					}
				} else {
					sendProgress('reset')
					setPendingUnmatchedUrl(tabUrl)
				}
			} catch (err) {
				sendProgress('error')
			}
		} finally {
			floatFillRunningRef.current = false
		}
	}

	// 稳定身份的回调，通过 ref 委托执行
	const runFloatFill = useCallback(async () => {
		await runFloatFillRef.current()
	}, [])

	// runFloatFill 内部会清理 floatFillPending，无需在挂载时清除
	// （挂载时清除会导致 sidepanel 新打开时读不到 pending flag，fallback 失效）

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
		const handler = (message: ExtensionMessage) => {
			if (message.type === 'FILL_PROGRESS' && message.action === 'start') {
				runFloatFill()
				return
			}
			if (message.type === 'STATUS_UPDATE') {
				if (!activeProduct) return
				const { status, tabUrl } = message.payload
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
		sendProgress('progress')
		reset()
		setCurrentEngineSite(virtualSite)
		try {
			const r = await startSubmission(virtualSite)
			if (r.failed === 0 && r.filled > 0) {
				markSubmitted(virtualSite.name, activeProduct.id)
			} else if (r.filled === 0) {
				sendProgress('error')
				markFailed(virtualSite.name, activeProduct.id, '页面未发现可填写的表单字段')
			}
			setTimeout(() => { setCurrentEngineSite(null); resetUI() }, 3000)
		} catch (err) {
			sendProgress('error')
			markFailed(virtualSite.name, activeProduct.id, err instanceof Error ? err.message : String(err))
			setTimeout(() => { setCurrentEngineSite(null); resetUI() }, 3000)
		}
	}, [pendingUnmatchedUrl, activeProduct, startSubmission, markSubmitted, reset, resetUI, markFailed])

	const cancelUnmatched = useCallback(() => {
		setPendingUnmatchedUrl(null)
		sendProgress('no-match')
	}, [])

	return {
		pendingUnmatchedUrl,
		confirmUnmatched,
		cancelUnmatched,
	}
}
