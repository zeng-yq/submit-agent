import { useCallback, useRef, useState } from 'react'
import type { BacklinkRecord } from '@/lib/types'
import { listBacklinks, saveBacklink, getBacklinkByUrl, clearBacklinks } from '@/lib/db'
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

export function useBacklinkState() {
	const [backlinks, setBacklinks] = useState<BacklinkRecord[]>([])
	const [batchHistory, setBatchHistory] = useState<BatchRecord[]>([])
	const [activeBatchId, setActiveBatchId] = useState<string | null>(null)
	const [logs, setLogs] = useState<LogEntry[]>([])
	const [totalLogCount, setTotalLogCount] = useState(0)
	const logIdRef = useRef(0)
	const currentBatchIdRef = useRef<string | null>(null)

	const handleLog = useCallback((entry: LogEntry) => {
		const id = ++logIdRef.current
		setLogs(prev => {
			const next = [...prev, { ...entry, id }]
			return next.length > 200 ? next.slice(-200) : next
		})
		setTotalLogCount(prev => prev + 1)
	}, [])

	const clearLogs = useCallback(() => {
		setLogs([])
		setTotalLogCount(0)
		logIdRef.current = 0
	}, [])

	const reload = useCallback(async () => {
		setBacklinks(await listBacklinks())
	}, [])

	const addUrl = useCallback(
		async (url: string): Promise<{ success: boolean; error?: string }> => {
			try {
				new URL(url)
			} catch {
				return { success: false, error: 'Invalid URL' }
			}

			const existing = await getBacklinkByUrl(url)
			if (existing) {
				return { success: false, error: 'Duplicate URL' }
			}

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

	const updateBatchStats = useCallback((backlinkId: string, newStatus: string) => {
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

	const selectBatch = useCallback((id: string | null) => {
		setActiveBatchId(id)
	}, [])

	const dismissBatch = useCallback((id: string) => {
		setBatchHistory(prev => prev.filter(b => b.id !== id))
		setActiveBatchId(prev => prev === id ? null : prev)
	}, [])

	const clearAll = useCallback(async () => {
		try {
			await clearBacklinks()
		} catch (err) {
			console.error("Failed to clear backlinks from DB:", err)
		}
		setBacklinks([])
		setBatchHistory([])
		setActiveBatchId(null)
		currentBatchIdRef.current = null
		setLogs([])
		setTotalLogCount(0)
		logIdRef.current = 0
	}, [])

	return {
		backlinks,
		setBacklinks,
		reload,
		addUrl,
		batchHistory,
		setBatchHistory,
		activeBatchId,
		setActiveBatchId,
		selectBatch,
		dismissBatch,
		clearAll,
		logs,
		totalLogCount,
		handleLog,
		clearLogs,
		logIdRef,
		currentBatchIdRef,
		updateBatchStats,
	}
}
