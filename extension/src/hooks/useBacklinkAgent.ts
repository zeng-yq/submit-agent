import type {
	AgentActivity,
	AgentStatus,
	HistoricalEvent,
} from '@page-agent/core'
import { useCallback, useRef, useState } from 'react'
import { SubmitAgent } from '@/agent/SubmitAgent'
import { getLanguage, getLLMConfig } from '@/lib/storage'
import type { BacklinkRecord, BacklinkStatus, ProductProfile, SiteRecord } from '@/lib/types'
import { updateBacklink, listBacklinksByStatus, addSite, listBacklinks } from '@/lib/db'
import { extractDomain } from '@/lib/backlinks'

async function buildAnalysisAgent(): Promise<SubmitAgent> {
	const [llmConfig, lang] = await Promise.all([getLLMConfig(), getLanguage()])
	if (!llmConfig.baseUrl) throw new Error('LLM not configured. Please set the Base URL in Settings.')
	if (!llmConfig.model) throw new Error('Model not configured. Please set the model name in Settings.')

	const baseURL = llmConfig.baseUrl.replace(/\/+$/, '')
	const language = lang === 'zh' ? 'zh-CN' : 'en-US'

	// Create a minimal dummy product — analysis mode doesn't use it but agent requires it
	const dummyProduct: ProductProfile = {
		id: '', name: '', url: '', tagline: '', shortDesc: '', longDesc: '',
		categories: [], screenshots: [], founderName: '', founderEmail: '',
		socialLinks: {}, createdAt: 0, updatedAt: 0,
	}

	return new SubmitAgent({
		baseURL,
		model: llmConfig.model,
		apiKey: llmConfig.apiKey || undefined,
		product: dummyProduct,
		siteName: 'backlink-analysis',
		includeInitialTab: false,
		mode: 'analysis',
		language,
	})
}

export function useBacklinkAgent() {
	const agentRef = useRef<SubmitAgent | null>(null)
	const stopRequestedRef = useRef(false)

	const [status, setStatus] = useState<AgentStatus>('idle')
	const [history, setHistory] = useState<HistoricalEvent[]>([])
	const [activity, setActivity] = useState<AgentActivity | null>(null)
	const [currentIndex, setCurrentIndex] = useState(0)
	const [batchSize, setBatchSize] = useState(0)
	const [backlinks, setBacklinks] = useState<BacklinkRecord[]>([])
	const [isRunning, setIsRunning] = useState(false)

	function wireEvents(agent: SubmitAgent) {
		agent.addEventListener('statuschange', () => setStatus(agent.status as AgentStatus))
		agent.addEventListener('historychange', () => setHistory([...agent.history]))
		agent.addEventListener('activity', (e) => setActivity((e as CustomEvent).detail))
	}

	/** Analyze a single backlink */
	const analyzeOne = useCallback(
		async (backlink: BacklinkRecord): Promise<void> => {
			// Update status to analyzing
			await updateBacklink({ ...backlink, status: 'analyzing', analysisLog: [] })
			setBacklinks(prev => prev.map(b => b.id === backlink.id ? { ...b, status: 'analyzing' as const, analysisLog: [] } : b))

			agentRef.current?.dispose()
			const agent = await buildAnalysisAgent()
			agentRef.current = agent
			wireEvents(agent)

			const task = [
				`Analyze this page for backlink opportunities: ${backlink.sourceUrl}`,
				`The page title is: "${backlink.sourceTitle || '(unknown)'}"`,
				`Page Authority Score: ${backlink.pageAscore}`,
				`Current link is ${backlink.nofollow ? 'nofollow' : 'dofollow'}.`,
				'',
				'Determine if this page allows placing new external backlinks. Report your findings using the report_analysis_result tool.',
			].join('\n')

			try {
				await agent.execute(task)

				const result = agent.analysisResult
				const newStatus: BacklinkStatus = result?.publishable ? 'publishable' : 'not_publishable'
				const logEntries = agent.history
					.filter((e: HistoricalEvent) => e.type === 'step')
					.map((e: any) => e.reflection?.next_goal ?? e.action ?? 'Step completed')

				const updated = await updateBacklink({
					...backlink,
					status: newStatus,
					analysisLog: logEntries,
					category: result?.category,
				})

				// If publishable, add to sites table
				if (result?.publishable) {
					const siteRecord: SiteRecord = {
						name: backlink.sourceTitle || extractDomain(backlink.sourceUrl),
						submit_url: backlink.sourceUrl,
						category: result.category || 'Other',
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
				const errorMsg = error instanceof Error ? error.message : String(error)
				const updated = await updateBacklink({
					...backlink,
					status: 'error',
					analysisLog: [...backlink.analysisLog, `Error: ${errorMsg}`],
				})
				setBacklinks(prev => prev.map(b => b.id === backlink.id ? updated : b))
			}
		},
		[]
	)

	/** Start batch analysis of pending backlinks */
	const startAnalysis = useCallback(
		async (count: number = 20) => {
			stopRequestedRef.current = false
			setIsRunning(true)
			setStatus('running')

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
			setIsRunning(false)
			setStatus('idle')
		},
		[analyzeOne]
	)

	/** Request stop after current item finishes */
	const stop = useCallback(() => {
		stopRequestedRef.current = true
		agentRef.current?.stop()
	}, [])

	/** Reset agent state */
	const reset = useCallback(() => {
		agentRef.current?.dispose()
		agentRef.current = null
		stopRequestedRef.current = false
		setStatus('idle')
		setHistory([])
		setActivity(null)
		setCurrentIndex(0)
		setBatchSize(0)
		setIsRunning(false)
	}, [])

	/** Reload backlinks from DB */
	const reload = useCallback(async () => {
		setBacklinks(await listBacklinks())
	}, [])

	return {
		status,
		history,
		activity,
		currentIndex,
		batchSize,
		backlinks,
		isRunning,
		startAnalysis,
		stop,
		reset,
		reload,
		analyzeOne,
	}
}
