import { useCallback, useRef, useState } from 'react'
import type { SiteData } from '@/lib/types'
import { getLLMConfig, getActiveProductId } from '@/lib/storage'
import { getProduct, listSubmissionsByProduct } from '@/lib/db'
import { loadSites, matchCurrentPage, getRandomUnsubmitted, filterSubmittable } from '@/lib/sites'
import type { FillEngineStatus, FillResult, SiteType, LogEntry } from '@/agent/types'
import { executeFormFill } from '@/agent/FormFillEngine'

const MAX_LOG_ENTRIES = 200

export interface UseFormFillEngineResult {
	status: FillEngineStatus
	result: FillResult | null
	error: Error | null
	logs: LogEntry[]
	startSubmission: (site: SiteData) => Promise<FillResult>
	startFloatFill: (tabId: number, currentUrl: string) => Promise<FillResult>
	stop: () => void
	reset: () => void
	clearLogs: () => void
}

export function useFormFillEngine(): UseFormFillEngineResult {
	const abortRef = useRef<AbortController | null>(null)
	const [status, setStatus] = useState<FillEngineStatus>('idle')
	const [result, setResult] = useState<FillResult | null>(null)
	const [error, setError] = useState<Error | null>(null)
	const [logs, setLogs] = useState<LogEntry[]>([])

	const handleLog = useCallback((entry: LogEntry) => {
		setLogs(prev => {
			const next = [...prev, entry]
			return next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next
		})
	}, [])

	const clearLogs = useCallback(() => {
		setLogs([])
	}, [])

	const stop = useCallback(() => {
		abortRef.current?.abort()
		abortRef.current = null
	}, [])

	const reset = useCallback(() => {
		stop()
		setStatus('idle')
		setResult(null)
		setError(null)
	}, [stop])

	const startSubmission = useCallback(
		async (site: SiteData): Promise<FillResult> => {
			stop()
			setError(null)
			setResult(null)
			setLogs([])

			const abort = new AbortController()
			abortRef.current = abort

			const llmConfig = await getLLMConfig()
			const productId = await getActiveProductId()
			if (!productId) throw new Error('No active product selected')

			const product = await getProduct(productId)
			if (!product) throw new Error('Product not found')

			const siteType: SiteType = site.category === 'blog_comment' ? 'blog_comment' : 'directory_submit'

			// Get tab ID from session storage (set by background when float button clicked)
			const sessionData = await chrome.storage.session.get('floatFillTabId')
			const tabId = sessionData.floatFillTabId as number | undefined
			if (!tabId) throw new Error('No active tab found')

			const fillResult = await executeFormFill({
				llmConfig,
				product,
				site,
				siteType,
				tabId,
				signal: abort.signal,
				callbacks: {
					onStatusChange: setStatus,
					onError: setError,
					onLog: handleLog,
				},
			})

			setResult(fillResult)
			return fillResult
		},
		[stop, handleLog]
	)

	const startFloatFill = useCallback(
		async (tabId: number, currentUrl: string): Promise<FillResult> => {
			stop()
			setError(null)
			setResult(null)
			setLogs([])

			const abort = new AbortController()
			abortRef.current = abort

			// Get product
			const productId = await getActiveProductId()
			if (!productId) {
				setStatus('no-product')
				throw new Error('No active product selected')
			}

			const product = await getProduct(productId)
			if (!product) {
				setStatus('no-product')
				throw new Error('Product not found')
			}

			// Find matching site or pick random unsubmitted
			const allSites = await loadSites()
			const submittable = filterSubmittable(allSites)

			const matched = matchCurrentPage(submittable, currentUrl)

			// Get already-submitted site names to avoid duplicates
			const existingSubmissions = await listSubmissionsByProduct(productId)
			const submittedNames = new Set(
				existingSubmissions
					.filter((s) => s.status === 'submitted' || s.status === 'approved')
					.map((s) => s.siteName)
			)

			const site = matched || getRandomUnsubmitted(submittable, submittedNames)

			if (!site) {
				setStatus('done')
				throw new Error('No available sites to submit to')
			}

			const siteType: SiteType = site.category === 'blog_comment' ? 'blog_comment' : 'directory_submit'
			const llmConfig = await getLLMConfig()

			const fillResult = await executeFormFill({
				llmConfig,
				product,
				site,
				siteType,
				tabId,
				signal: abort.signal,
				callbacks: {
					onStatusChange: setStatus,
					onError: setError,
					onLog: handleLog,
				},
			})

			setResult(fillResult)
			return fillResult
		},
		[stop, handleLog]
	)

	return {
		status,
		result,
		error,
		logs,
		startSubmission,
		startFloatFill,
		stop,
		reset,
		clearLogs,
	}
}
