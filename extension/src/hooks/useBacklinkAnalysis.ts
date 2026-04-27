import { useCallback, useRef, useState } from 'react'
import type { BacklinkRecord, BacklinkStatus, SiteRecord } from '@/lib/types'
import { updateBacklink, listBacklinksByStatus, listBacklinks, addSite, getSiteByDomain, getExistingDomains } from '@/lib/db'
import { extractDomain } from '@/lib/backlinks'
import { analyzeBacklink, type AnalysisStep } from '@/lib/backlink-analyzer'
import type { LogEntry, LogLevel } from '@/agent/types'
import type { useBacklinkState } from './useBacklinkState'

export function useBacklinkAnalysis(state: ReturnType<typeof useBacklinkState>) {
	const stopRequestedRef = useRef(false)
	const abortRef = useRef<AbortController | null>(null)

	const [currentStep, setCurrentStep] = useState<AnalysisStep | null>(null)
	const [currentIndex, setCurrentIndex] = useState(0)
	const [batchSize, setBatchSize] = useState(0)
	const [isRunning, setIsRunning] = useState(false)
	const [analyzingId, setAnalyzingId] = useState<string | null>(null)

	const analyzeOne = useCallback(
		async (backlink: BacklinkRecord, progress?: string): Promise<void> => {
			abortRef.current?.abort()
			const ac = new AbortController()
			abortRef.current = ac
			setAnalyzingId(backlink.id)

			try {
				const domain = extractDomain(backlink.sourceUrl)
				const existingSite = await getSiteByDomain(domain)
				if (existingSite) {
					const updated = await updateBacklink({
						...backlink,
						status: 'skipped',
						analysisLog: ['跳过: 该域名已在外链资源库中'],
					})
					state.setBacklinks(prev => prev.map(b => b.id === backlink.id ? updated : b))
					state.updateBatchStats(backlink.id, 'skipped')
					return
				}

				const prefix = progress ? `[${progress}] ` : ''
				state.handleLog({ id: ++state.logIdRef.current, timestamp: Date.now(), level: 'info', phase: 'system', message: `${prefix}开始分析: ${backlink.sourceUrl}` })

				const result = await analyzeBacklink({
					url: backlink.sourceUrl,
					signal: ac.signal,
					onProgress: (step) => setCurrentStep(step),
					onLog: state.handleLog,
				})

				const publishable = !!result?.canComment
				const newStatus: BacklinkStatus = publishable ? 'publishable' : 'not_publishable'

				const analysisLog = [
					result.summary,
					`表单类型: ${result.formType}`,
					`CMS: ${result.cmsType}`,
					...(result.commentSystem ? [`评论系统: ${result.commentSystem}`] : []),
					`信心度: ${(result.confidence * 100).toFixed(0)}%`,
				]

				const updated = await updateBacklink({
					...backlink,
					status: newStatus,
					analysisLog,
				})

				if (publishable) {
					const siteRecord: SiteRecord = {
						name: backlink.sourceTitle || extractDomain(backlink.sourceUrl),
						submit_url: backlink.sourceUrl,
						domain: extractDomain(backlink.sourceUrl),
						category: 'blog_comment',
						dr: null,
						status: 'alive',
						createdAt: Date.now(),
						updatedAt: Date.now(),
					}
					await addSite(siteRecord)
				}

				state.setBacklinks(prev => prev.map(b => b.id === backlink.id ? updated : b))
				state.updateBatchStats(backlink.id, newStatus)
				state.handleLog({ id: ++state.logIdRef.current, timestamp: Date.now(), level: publishable ? 'success' : 'warning', phase: 'system', message: `分析完成: ${publishable ? '可发布' : '不可发布'}` })
			} catch (error) {
				if (ac.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return
				const errorMsg = error instanceof Error ? error.message : String(error)
				state.handleLog({ id: ++state.logIdRef.current, timestamp: Date.now(), level: 'error', phase: 'system', message: `分析出错: ${errorMsg}` })
				try {
					const updated = await updateBacklink({
						...backlink,
						status: 'error',
						analysisLog: [...backlink.analysisLog, `错误: ${errorMsg}`],
					})
					state.setBacklinks(prev => prev.map(b => b.id === backlink.id ? updated : b))
					state.updateBatchStats(backlink.id, 'error')
				} catch {
					console.error('Failed to update backlink error status:', errorMsg)
				}
			} finally {
				setAnalyzingId(null)
			}
		},
		[state]
	)

	const startAnalysis = useCallback(
		async (count: number = 20) => {
			if (isRunning) return
			stopRequestedRef.current = false
			setIsRunning(true)

			const batchId = crypto.randomUUID()
			const newBatch = {
				id: batchId,
				startTime: Date.now(),
				status: 'running' as const,
				itemIds: [] as string[],
				stats: { publishable: 0, not_publishable: 0, skipped: 0, error: 0, total: 0 },
			}
			state.setBatchHistory(prev => [newBatch, ...prev])
			state.setActiveBatchId(batchId)
			state.currentBatchIdRef.current = batchId

			try {
				state.logIdRef.current = 0
				state.clearLogs()

				state.setBacklinks(await listBacklinks())
				const pending = await listBacklinksByStatus('pending')
				// 只截取本次批次，避免预过滤全部 pending 导致数字飙升
				const batchPool = pending.slice(0, count)

				// 预过滤：排除资源库中已有域名的 backlink
				const existingDomains = await getExistingDomains()
				const filtered: BacklinkRecord[] = []
				const toSkip: BacklinkRecord[] = []
				for (const bl of batchPool) {
					const domain = extractDomain(bl.sourceUrl)
					if (existingDomains.has(domain)) {
						toSkip.push(bl)
					} else {
						filtered.push(bl)
					}
				}
				for (const bl of toSkip) {
					const updated = await updateBacklink({
						...bl,
						status: 'skipped',
						analysisLog: ['跳过: 该域名已在外链资源库中'],
					})
					state.setBacklinks(prev => prev.map(b => b.id === bl.id ? updated : b))
					state.updateBatchStats(bl.id, 'skipped')
				}

				const batch = filtered
				setBatchSize(batch.length)

				for (let i = 0; i < batch.length; i++) {
					if (stopRequestedRef.current) break
					setCurrentIndex(i)
					await analyzeOne(batch[i], `${i + 1}/${batch.length}`)
				}

				state.setBacklinks(await listBacklinks())
			} finally {
				const stopped = stopRequestedRef.current
				const bid = state.currentBatchIdRef.current
				state.setBatchHistory(prev => prev.map(b =>
					b.id === bid
						? { ...b, status: stopped ? 'stopped' : 'completed', endTime: Date.now() }
						: b
				))
				setIsRunning(false)
				setCurrentStep(null)
				state.currentBatchIdRef.current = null
			}
		},
		[analyzeOne, isRunning, state]
	)

	const stop = useCallback(() => {
		stopRequestedRef.current = true
		abortRef.current?.abort()
	}, [])

	return {
		analyzingId,
		currentStep,
		currentIndex,
		batchSize,
		isRunning,
		startAnalysis,
		stop,
		analyzeOne,
	}
}
