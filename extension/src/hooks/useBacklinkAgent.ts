import { useCallback, useRef, useState } from 'react'
import type { BacklinkRecord, BacklinkStatus, SiteRecord } from '@/lib/types'
import { updateBacklink, listBacklinksByStatus, addSite, listBacklinks, saveBacklink, getBacklinkByUrl } from '@/lib/db'
import { extractDomain } from '@/lib/backlinks'
import { analyzeBacklink, type AnalysisStep } from '@/lib/backlink-analyzer'

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

	/** Analyze a single backlink */
	const analyzeOne = useCallback(
		async (backlink: BacklinkRecord): Promise<void> => {
			abortRef.current?.abort()
			const ac = new AbortController()
			abortRef.current = ac
			setAnalyzingId(backlink.id)

			try {
				const result = await analyzeBacklink(
					backlink.sourceUrl,
					ac.signal,
					(step) => setCurrentStep(step),
				)

				const publishable = result?.isBlog && result?.canComment
				const newStatus: BacklinkStatus = publishable ? 'publishable' : 'not_publishable'

				const updated = await updateBacklink({
					...backlink,
					status: newStatus,
					analysisLog: [result.summary || 'Analysis complete'],
				})

				// If publishable, add to sites table
				if (publishable) {
					const siteRecord: SiteRecord = {
						name: backlink.sourceTitle || extractDomain(backlink.sourceUrl),
						submit_url: backlink.sourceUrl,
						category: 'Blog Comment',
						lang: '',
						dr: null,
						monthly_traffic: '',
						pricing: 'Free',
						status: 'alive',
						notes: result.summary || '',
						source: 'crawled',
						createdAt: Date.now(),
						updatedAt: Date.now(),
					}
					await addSite(siteRecord)
				}

				setBacklinks(prev => prev.map(b => b.id === backlink.id ? updated : b))
			} catch (error) {
				if (ac.signal.aborted) return
				const errorMsg = error instanceof Error ? error.message : String(error)
				try {
					const updated = await updateBacklink({
						...backlink,
						status: 'error',
						analysisLog: [...backlink.analysisLog, `错误: ${errorMsg}`],
					})
					setBacklinks(prev => prev.map(b => b.id === backlink.id ? updated : b))
				} catch {
					console.error('Failed to update backlink error status:', errorMsg)
				}
			} finally {
				setAnalyzingId(null)
			}
		},
		[]
	)

	/** Start batch analysis of pending backlinks */
	const startAnalysis = useCallback(
		async (count: number = 20) => {
			if (isRunning) return
			stopRequestedRef.current = false
			setIsRunning(true)
			setStatus('running')

			try {
				// Load all backlinks for display
				setBacklinks(await listBacklinks())
				const pending = await listBacklinksByStatus('pending')
				const batch = pending.slice(0, count)
				setBatchSize(batch.length)

				for (let i = 0; i < batch.length; i++) {
					if (stopRequestedRef.current) break
					setCurrentIndex(i)
					await analyzeOne(batch[i])
				}

				// Refresh full list after batch
				setBacklinks(await listBacklinks())
			} finally {
				setIsRunning(false)
				setStatus('idle')
				setCurrentStep(null)
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

	/** Add a URL manually and immediately analyze it */
	const addAndAnalyzeUrl = useCallback(
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
				targetUrl: '',
				status: 'pending',
				analysisLog: [],
			})

			setBacklinks(prev => [...prev, record])

			// Trigger analysis
			await analyzeOne(record)

			return { success: true }
		},
		[analyzeOne]
	)

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
		addAndAnalyzeUrl,
	}
}
