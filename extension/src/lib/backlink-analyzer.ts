import type { LLMSettings } from './types'
import { getLLMConfig } from './storage'

export interface AnalysisResult {
	publishable: boolean
	category: string
	summary: string
}

export type AnalysisStep = 'opening' | 'loading' | 'analyzing' | 'done'

const SYSTEM_PROMPT = `You are a Backlink Analyzer. Analyze the webpage content below and determine if the page allows placing new external backlinks.

Look for:
1. Blog comment sections with URL/Website fields
2. Directory sites with submission forms or "Submit" / "Add listing" buttons
3. Forum/community threads with reply forms that allow links
4. Other link placement opportunities (guestbook, profile page, resource page)

Return ONLY valid JSON with these exact fields:
{
  "publishable": true/false,
  "category": "blog_comment" | "directory" | "forum" | "guestbook" | "profile" | "resource_page" | "other",
  "summary": "brief explanation of what you found (1-2 sentences)"
}

Rules:
- publishable: true if the page has ANY viable method for placing an external backlink
- category: the most relevant category for how the backlink would be placed
- summary: concise description of the opportunity found, or why the page is not suitable
- Return ONLY the JSON object, no markdown fences, no explanation`

function parseJsonResponse(text: string): AnalysisResult {
	let cleaned = text.trim()
	const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/)
	if (fenceMatch) {
		cleaned = fenceMatch[1].trim()
	}

	try {
		return JSON.parse(cleaned)
	} catch {
		const objectMatch = cleaned.match(/\{[\s\S]*\}/)
		if (objectMatch) {
			return JSON.parse(objectMatch[0])
		}
		throw new Error('Failed to parse analysis result from LLM response')
	}
}

function waitForTabLoaded(tabId: number, timeout = 10_000): Promise<void> {
	const start = Date.now()
	return new Promise((resolve, reject) => {
		function poll() {
			if (Date.now() - start > timeout) {
				reject(new Error(`Tab ${tabId} did not load within ${timeout / 1000}s`))
				return
			}
			chrome.runtime.sendMessage({
				type: 'TAB_CONTROL',
				action: 'get_tab_info',
				payload: { tabId },
			}).then((tab: any) => {
				if (tab?.status === 'complete') {
					resolve()
				} else {
					setTimeout(poll, 500)
				}
			}).catch(() => {
				setTimeout(poll, 500)
			})
		}
		poll()
	})
}

export async function analyzeBacklink(
	url: string,
	signal?: AbortSignal,
	onProgress?: (step: AnalysisStep) => void,
): Promise<AnalysisResult> {
	const config: LLMSettings = await getLLMConfig()
	if (!config.baseUrl) throw new Error('LLM not configured. Please set the Base URL in Settings.')
	if (!config.model) throw new Error('Model not configured. Please set the model name in Settings.')

	// Step 1: Open tab
	onProgress?.('opening')
	const tabResponse = await chrome.runtime.sendMessage({
		type: 'TAB_CONTROL',
		action: 'open_new_tab',
		payload: { url },
	})
	if (!tabResponse?.success || !tabResponse.tabId) {
		throw new Error(`Failed to open tab for ${url}`)
	}
	const tabId: number = tabResponse.tabId

	try {
		// Step 2: Wait for tab to load
		onProgress?.('loading')
		await waitForTabLoaded(tabId)

		// Step 3: Get page content from content script
		const browserState = await chrome.runtime.sendMessage({
			type: 'PAGE_CONTROL',
			action: 'get_browser_state',
			targetTabId: tabId,
		})

		// Step 4: Close tab (we have the content now)
		chrome.runtime.sendMessage({
			type: 'TAB_CONTROL',
			action: 'close_tab',
			payload: { tabId },
		}).catch(() => {}) // best-effort close

		// Step 5: Build page content for LLM
		const pageContent = [
			`URL: ${url}`,
			browserState?.title ? `Title: ${browserState.title}` : '',
			browserState?.header || '',
			browserState?.content || '',
			browserState?.footer || '',
		].filter(Boolean).join('\n\n')

		if (!pageContent.trim() || pageContent.length < 50) {
			return { publishable: false, category: 'other', summary: 'Page content is empty or too short to analyze.' }
		}

		// Truncate if too long to save tokens
		const truncated = pageContent.length > 8000 ? pageContent.slice(0, 8000) + '\n...[truncated]' : pageContent

		// Step 6: Single LLM call
		onProgress?.('analyzing')
		const baseUrl = config.baseUrl.replace(/\/+$/, '')
		const endpoint = `${baseUrl}/chat/completions`

		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
			},
			body: JSON.stringify({
				model: config.model,
				messages: [
					{ role: 'system', content: SYSTEM_PROMPT },
					{ role: 'user', content: `Analyze this webpage for backlink opportunities:\n\n${truncated}` },
				],
				temperature: 0.3,
				max_tokens: 512,
			}),
			signal,
		})

		if (!response.ok) {
			const errorText = await response.text().catch(() => '')
			if (response.status === 401 || response.status === 403) {
				throw new Error('Authentication failed — please check your API Key in Settings.')
			}
			if (response.status === 429) {
				throw new Error('Rate limited by the API provider. Please wait and try again.')
			}
			throw new Error(`API error (${response.status}): ${errorText || 'Unknown error'}`)
		}

		const data = await response.json()
		const content = data.choices?.[0]?.message?.content
		if (!content) {
			throw new Error('LLM returned an empty response.')
		}

		onProgress?.('done')
		return parseJsonResponse(content)
	} catch (error) {
		// Ensure tab is closed on error
		chrome.runtime.sendMessage({
			type: 'TAB_CONTROL',
			action: 'close_tab',
			payload: { tabId },
		}).catch(() => {})
		throw error
	}
}
