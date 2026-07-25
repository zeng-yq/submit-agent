import { useCallback, useRef, useState } from 'react'
import type { SiteData, SubmissionRecord } from '@/lib/types'
import { VERIFIED_SUCCESS, verifyResultLabel } from '@/agent/types'
import type { VerifyResult, FillResult } from '@/agent/types'

const BATCH_TARGET = 20

// 已是终态（不再作为候选）的提交状态：已完成 + 失败
const TERMINAL_STATUSES = new Set(['submitted', 'approved', 'skipped', 'failed'])

export interface BatchProgress {
	attempted: number
	succeeded: number
	target: number
}

interface BatchSubmitOptions {
	activeProduct: { id: string } | null | undefined
	sites: SiteData[]
	submissions: Map<string, SubmissionRecord>
	startSubmission: (site: SiteData) => Promise<FillResult>
	markSubmitted: (siteName: string, productId: string, verifyResult?: string) => Promise<void>
	markFailed: (siteName: string, productId: string, error?: string, verifyResult?: string) => Promise<void>
	/** abort 当前正在执行的 startSubmission（来自 useFormFillEngine.stop） */
	stop: () => void
}

function shuffle<T>(arr: T[]): T[] {
	const a = [...arr]
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1))
		;[a[i], a[j]] = [a[j], a[i]]
	}
	return a
}

/**
 * 批量随机提交博客外链：从未提交的 blog_comment 中随机取一条 → 开 tab → startSubmission →
 * 判定（VERIFIED_SUCCESS）→ 关 tab → 下一条，直到成功满 target 条或候选耗尽。
 * 串行执行（startSubmission 内部会 stop 上一次）。可随时 stopBatch 中断，中断不标记失败、不泄漏标签页。
 */
export function useBatchSubmit({
	activeProduct,
	sites,
	submissions,
	startSubmission,
	markSubmitted,
	markFailed,
	stop,
}: BatchSubmitOptions) {
	const [isRunning, setIsRunning] = useState(false)
	const [progress, setProgress] = useState<BatchProgress | undefined>(undefined)

	const isRunningRef = useRef(false)
	const stopRequestedRef = useRef(false)

	const start = useCallback(async () => {
		if (isRunningRef.current || !activeProduct) return

		// 1) 算候选：blog_comment + 有 submit_url + 状态非终态
		const terminalNames = new Set<string>()
		for (const sub of submissions.values()) {
			if (TERMINAL_STATUSES.has(sub.status)) terminalNames.add(sub.siteName)
		}
		const candidates = shuffle(
			sites.filter(
				(s) => s.category === 'blog_comment' && !!s.submit_url && !terminalNames.has(s.name)
			)
		)
		if (candidates.length === 0) return

		isRunningRef.current = true
		setIsRunning(true)
		stopRequestedRef.current = false
		let succeeded = 0
		let attempted = 0
		setProgress({ attempted, succeeded, target: BATCH_TARGET })

		try {
			for (const site of candidates) {
				if (stopRequestedRef.current || succeeded >= BATCH_TARGET) break

				// 2) 开 tab（复用 background open_submit_page，已含 waitForTabLoad + 渲染延迟）
				let tabId: number | undefined
				try {
					const resp = await chrome.runtime.sendMessage({
						type: 'SUBMIT_CONTROL',
						action: 'open_submit_page',
						payload: site.submit_url,
					})
					if (resp?.ok && resp.tabId) {
						tabId = resp.tabId
						await chrome.storage.session.set({ floatFillTabId: tabId })
					}
				} catch {
					/* 开 tab 失败，下面会按失败处理 */
				}

				// 3) 提交 + 判定；主动停止（abort）不标记失败
				let aborted = false
				try {
					if (!tabId) throw new Error('打开提交页失败')
					const r = await startSubmission(site)
					const verified = VERIFIED_SUCCESS.includes(
						(r.verifyResult ?? 'not_attempted') as VerifyResult
					)
					if (verified) {
						await markSubmitted(site.name, activeProduct.id, r.verifyResult)
						succeeded++
					} else {
						await markFailed(
							site.name,
							activeProduct.id,
							r.submitError || verifyResultLabel(r.verifyResult),
							r.verifyResult
						)
					}
				} catch (err) {
					if (stopRequestedRef.current) {
						aborted = true
					} else {
						await markFailed(
							site.name,
							activeProduct.id,
							err instanceof Error ? err.message : String(err)
						)
					}
				}

				// 4) 进度（被中断的那一条不计入已尝试）
				if (!aborted) {
					attempted++
					setProgress({ attempted, succeeded, target: BATCH_TARGET })
				}

				// 5) 关 tab（无论成败/中断，都关掉刚开的这一条）
				if (tabId != null) {
					try {
						await chrome.tabs.remove(tabId)
					} catch {
						/* tab 可能已被关闭或提交导致页面自行跳转关闭 */
					}
				}

				if (aborted) break
			}
		} finally {
			isRunningRef.current = false
			setIsRunning(false)
			// 清掉 session 里的 tab 指针，避免悬浮按钮路径误用已关闭的 tab
			chrome.storage.session.remove('floatFillTabId').catch(() => {})
		}
	}, [activeProduct, sites, submissions, startSubmission, markSubmitted, markFailed])

	const stopBatch = useCallback(() => {
		stopRequestedRef.current = true
		stop()
		// 兜底：stop() 后 startSubmission 理论上会抛错进 catch 关 tab；
		// 若它没能立即返回，这里主动读 session 关掉当前提交 tab，避免泄漏。
		chrome.storage.session
			.get('floatFillTabId')
			.then((res) => {
				if (res.floatFillTabId) {
					chrome.tabs.remove(res.floatFillTabId).catch(() => {})
				}
			})
			.catch(() => {})
	}, [stop])

	return { isRunning, progress, start, stopBatch }
}
