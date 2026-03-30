import type {
	AgentActivity,
	AgentStatus,
	ExecutionResult,
	HistoricalEvent,
} from '@page-agent/core'
import { useCallback, useRef, useState } from 'react'

import { SubmitAgent } from '@/agent/SubmitAgent'
import { getLLMConfig } from '@/lib/storage'
import type { ProductProfile, SiteData } from '@/lib/types'

export interface UseSubmitAgentResult {
	status: AgentStatus
	history: HistoricalEvent[]
	activity: AgentActivity | null
	startSubmission: (site: SiteData, product: ProductProfile) => Promise<ExecutionResult>
	startSubmissionOnCurrentTab: (product: ProductProfile, tabUrl: string) => Promise<ExecutionResult>
	stop: () => void
}

async function buildAgent(product: ProductProfile, siteName: string): Promise<SubmitAgent> {
	const llmConfig = await getLLMConfig()
	if (!llmConfig.baseUrl) throw new Error('LLM not configured. Please set the Base URL in Settings.')
	if (!llmConfig.model) throw new Error('Model not configured. Please set the model name in Settings.')
	const baseURL = llmConfig.baseUrl.replace(/\/+$/, '')
	return new SubmitAgent({
		baseURL,
		model: llmConfig.model,
		apiKey: llmConfig.apiKey || undefined,
		product,
		siteName,
		includeInitialTab: true,
	})
}

export function useSubmitAgent(): UseSubmitAgentResult {
	const agentRef = useRef<SubmitAgent | null>(null)
	const [status, setStatus] = useState<AgentStatus>('idle')
	const [history, setHistory] = useState<HistoricalEvent[]>([])
	const [activity, setActivity] = useState<AgentActivity | null>(null)

	function wireEvents(agent: SubmitAgent) {
		agent.addEventListener('statuschange', () => setStatus(agent.status as AgentStatus))
		agent.addEventListener('historychange', () => setHistory([...agent.history]))
		agent.addEventListener('activity', (e) => setActivity((e as CustomEvent).detail))
	}

	const startSubmission = useCallback(
		async (site: SiteData, product: ProductProfile): Promise<ExecutionResult> => {
			if (!site.submit_url) throw new Error(`No submit URL for site: ${site.name}`)

			agentRef.current?.dispose()
			const agent = await buildAgent(product, site.name)
			agentRef.current = agent
			wireEvents(agent)

			console.log('[SubmitAgent] Starting submission', { site: site.name })

			await chrome.runtime.sendMessage({
				type: 'SUBMIT_CONTROL',
				action: 'open_submit_page',
				payload: site.submit_url,
			})

			const task = [
				`You are on a product submission form.`,
				`Site: ${site.name}`,
				`Product: ${product.name} (${product.url})`,
				'Fill all form fields with the product data from your context.',
				'Rewrite descriptions to be unique for this site.',
				'Do NOT click the final submit button. Stop after filling and report the form status.',
			].join('\n')

			try {
				const result = await agent.execute(task)
				console.log('[SubmitAgent] Execution completed', { success: result.success })
				return result
			} catch (error) {
				console.error('[SubmitAgent] Execution failed', error)
				throw error
			}
		},
		[]
	)

	const startSubmissionOnCurrentTab = useCallback(
		async (product: ProductProfile, tabUrl: string): Promise<ExecutionResult> => {
			agentRef.current?.dispose()

			const siteName = (() => { try { return new URL(tabUrl).hostname } catch { return tabUrl } })()
			const agent = await buildAgent(product, siteName)
			agentRef.current = agent
			wireEvents(agent)

			console.log('[SubmitAgent] Starting float-fill on current tab', { siteName, tabUrl })

			const task = [
				`You are on a product submission form on ${siteName}.`,
				`Product: ${product.name} (${product.url})`,
				'Fill all form fields with the product data from your context.',
				'Rewrite descriptions to be unique for this site.',
				'Do NOT click the final submit button. Stop after filling and report the form status.',
			].join('\n')

			try {
				const result = await agent.execute(task)
				chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'done' }).catch(() => {})
				return result
			} catch (error) {
				console.error('[SubmitAgent] Float-fill failed', error)
				chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'error' }).catch(() => {})
				throw error
			}
		},
		[]
	)

	const stop = useCallback(() => {
		agentRef.current?.stop()
	}, [])

	return {
		status,
		history,
		activity,
		startSubmission,
		startSubmissionOnCurrentTab,
		stop,
	}
}
