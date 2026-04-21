import { useCallback, useRef, useState } from 'react'
import type { BacklinkRecord, BacklinkStatus, SiteRecord } from '@/lib/types'
import { updateBacklink, listBacklinksByStatus, addSite, listBacklinks, saveBacklink, getBacklinkByUrl, getSiteByDomain } from '@/lib/db'
import { extractDomain } from '@/lib/backlinks'
import { analyzeBacklink, type AnalysisStep } from '@/lib/backlink-analyzer'
import type { LogEntry } from '@/agent/types'

export interface BatchRecord {
	id: string
	startTime: number
	endTime?: number
	status: 'running' | 'completed' | 'stopped'
	itemIds: string[]
	stats: {
		publishable: number
		not_publishable: number
		skipped: number
		error: number
		total: number
	}
}

export function useBacklinkAgent() {
	const stopRequestedRef = useRef(false)
	const abortRef = useRef<AbortController | null>(null)

	const [status, setStatus] = useState<'idle' | 'running'>('idle')
	const [currentStep, setCurrentStep] = useState<AnalysisStep | null>(null)
	const [currentIndex, setCurrentIndex] = useState(0)
	const [batchSize, setBatchSize] = useState(0)
	const [backlinks, setBacklinks] = useState<BacklinkRecord[]>([])
	const [isRunning, setIsRunning] = useState(false)
	const [analyzingId, setAnalyzingId] = useState<string | null>(null)
	const [batchHistory, setBatchHistory] = useState<BatchRecord[]>([])
	const [activeBatchId, setActiveBatchId] = useState<string | null>(null)
	const [logs, setLogs] = useState<LogEntry[]>([])
	const logIdRef = useRef(0)
	const currentBatchIdRef = useRef<string | null>(null)

	/** Update current batch stats after an item is analyzed */
	const updateBatchStats = useCallback((backlinkId: string, newStatus: BacklinkStatus) => {
		const bid = currentBatchIdRef.current
		if (!bid) return
		setBatchHistory(prev => prev.map(b => {
			if (b.id !== bid) return b
			const key = newStatus === 'publishable' ? 'publishable'
				: newStatus === 'not_publishable' ? 'not_publishable'
				: newStatus === 'skipped' ? 'skipped'
				: newStatus === 'error' ? 'error'
				: null
			return {
				...b,
				itemIds: [...b.itemIds, backlinkId],
				stats: key ? { ...b.stats, [key]: b.stats[key] + 1, total: b.stats.total + 1 } : b.stats,
			}
		}))
	}, [])

	const handleLog = useCallback((entry: LogEntry) => {
		setLogs(prev => {
			const next = [...prev, entry]
			return next.length > 200 ? next.slice(-200) : next
		})
	}, [])

	const clearLogs = useCallback(() => {
		setLogs([])
		logIdRef.current = 0
	}, [])

	/** Analyze a single backlink */
	const analyzeOne = useCallback(
		async (backlink: BacklinkRecord, progress?: string): Promise<void> => {
			abortRef.current?.abort()
			const ac = new AbortController()
			abortRef.current = ac
			setAnalyzingId(backlink.id)

			try {
				// Check if domain already exists in sites table (外链资源库)
				const domain = extractDomain(backlink.sourceUrl)
				const existingSite = await getSiteByDomain(domain)
				if (existingSite) {
					const updated = await updateBacklink({
						...backlink,
						status: 'skipped',
						analysisLog: ['跳过: 该域名已在外链资源库中'],
					})
					setBacklinks(prev => prev.map(b => b.id === backlink.id ? updated : b))
					updateBatchStats(backlink.id, 'skipped')
					return
				}

				const prefix = progress ? `[${progress}] ` : ''
				handleLog({ id: ++logIdRef.current, timestamp: Date.now(), level: 'info', phase: 'system', message: `${prefix}开始分析: ${backlink.sourceUrl}` })

				const result = await analyzeBacklink({
					url: backlink.sourceUrl,
					signal: ac.signal,
					onProgress: (step) => setCurrentStep(step),
					onLog: handleLog,
				})

				const publishable = !!result?.canComment
				const newStatus: BacklinkStatus = publishable ? 'publishable' : 'not_publishable'

				const analysisLog = [
					result.summary,
					`表单类型: ${result.formType}`,
					`CMS: ${result.cmsType}`,
					`信心度: ${(result.confidence * 100).toFixed(0)}%`,
				]

				const updated = await updateBacklink({
					...backlink,
					status: newStatus,
					analysisLog,
				})

				// If publishable, add to sites table
				if (publishable) {
					const siteRecord: SiteRecord = {
						name: backlink.sourceTitle || extractDomain(backlink.sourceUrl),
						submit_url: backlink.sourceUrl,
						category: 'blog_comment',
						dr: null,
						status: 'alive',
						createdAt: Date.now(),
						updatedAt: Date.now(),
					}
					await addSite(siteRecord)
				}

				setBacklinks(prev => prev.map(b => b.id === backlink.id ? updated : b))
				updateBatchStats(backlink.id, newStatus)
				handleLog({ id: ++logIdRef.current, timestamp: Date.now(), level: publishable ? 'success' : 'warning', phase: 'system', message: `分析完成: ${publishable ? '可发布' : '不可发布'}` })
			} catch (error) {
				if (ac.signal.aborted) return
				const errorMsg = error instanceof Error ? error.message : String(error)
				handleLog({ id: ++logIdRef.current, timestamp: Date.now(), level: 'error', phase: 'system', message: `分析出错: ${errorMsg}` })
				try {
					const updated = await updateBacklink({
						...backlink,
						status: 'error',
						analysisLog: [...backlink.analysisLog, `错误: ${errorMsg}`],
					})
					setBacklinks(prev => prev.map(b => b.id === backlink.id ? updated : b))
					updateBatchStats(backlink.id, 'error')
				} catch {
					console.error('Failed to update backlink error status:', errorMsg)
				}
			} finally {
				setAnalyzingId(null)
			}
		},
		[updateBatchStats, handleLog]
	)

	const startAnalysis = useCallback(
		async (count: number = 20) => {
			if (isRunning) return
			stopRequestedRef.current = false
			setIsRunning(true)
			setStatus('running')

			// Create new batch record
			const batchId = crypto.randomUUID()
			const newBatch: BatchRecord = {
				id: batchId,
				startTime: Date.now(),
				status: 'running',
				itemIds: [],
				stats: { publishable: 0, not_publishable: 0, skipped: 0, error: 0, total: 0 },
			}
			setBatchHistory(prev => [newBatch, ...prev])
			setActiveBatchId(batchId)
			currentBatchIdRef.current = batchId

			try {
				// Clear logs at the start of a new batch
				logIdRef.current = 0
				setLogs([])

				// Load all backlinks for display
				setBacklinks(await listBacklinks())
				const pending = await listBacklinksByStatus('pending')
				const batch = pending.slice(0, count)
				setBatchSize(batch.length)

				for (let i = 0; i < batch.length; i++) {
					if (stopRequestedRef.current) break
					setCurrentIndex(i)
					await analyzeOne(batch[i], `${i + 1}/${batch.length}`)
				}

				// Refresh full list after batch
				setBacklinks(await listBacklinks())
			} finally {
				const stopped = stopRequestedRef.current
				const bid = currentBatchIdRef.current
				// Finalize batch record
				setBatchHistory(prev => prev.map(b =>
					b.id === bid
						? { ...b, status: stopped ? 'stopped' : 'completed', endTime: Date.now() }
						: b
				))
				setIsRunning(false)
				setStatus('idle')
				setCurrentStep(null)
				currentBatchIdRef.current = null
			}
		},
		[analyzeOne, isRunning]
	)

	/** Request stop after current item finishes */
	const stop = useCallback(() => {
		stopRequestedRef.current = true
		abortRef.current?.abort()
	}, [])

	/** Reset agent state */
	const reset = useCallback(() => {
		abortRef.current?.abort()
		abortRef.current = null
		stopRequestedRef.current = false
		setStatus('idle')
		setCurrentStep(null)
		setCurrentIndex(0)
		setBatchSize(0)
		setIsRunning(false)
		setAnalyzingId(null)
	}, [])

	/** Reload backlinks from DB */
	const reload = useCallback(async () => {
		setBacklinks(await listBacklinks())
	}, [])

	/** Add a URL manually to the pending list (no automatic analysis) */
	const addUrl = useCallback(
		async (url: string): Promise<{ success: boolean; error?: string }> => {
			// Validate URL
			try {
				new URL(url)
			} catch {
				return { success: false, error: 'Invalid URL' }
			}

			// Check duplicate
			const existing = await getBacklinkByUrl(url)
			if (existing) {
				return { success: false, error: 'Duplicate URL' }
			}

			// Create pending record
			const record = await saveBacklink({
				sourceUrl: url,
				sourceTitle: '',
				pageAscore: 0,
				status: 'pending',
				analysisLog: [],
			})

			setBacklinks(prev => [...prev, record])

			return { success: true }
		},
		[]
	)

	/** Select a batch to filter the table view */
	const selectBatch = useCallback((id: string | null) => {
		setActiveBatchId(id)
	}, [])

	/** Dismiss a batch card from history */
	const dismissBatch = useCallback((id: string) => {
		setBatchHistory(prev => prev.filter(b => b.id !== id))
		setActiveBatchId(prev => prev === id ? null : prev)
	}, [])

	return {
		analyzingId,
		status,
		currentStep,
		currentIndex,
		batchSize,
		backlinks,
		isRunning,
		startAnalysis,
		stop,
		reset,
		reload,
		analyzeOne,
		addUrl,
		batchHistory,
		activeBatchId,
		selectBatch,
		dismissBatch,
		logs,
		clearLogs,
	}
}
