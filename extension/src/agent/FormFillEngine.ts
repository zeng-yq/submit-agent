/**
 * FormFillEngine — unified form filling engine.
 * Runs in the sidepanel context.
 * Analyzes form → 1 LLM call → batch fill.
 */

import type { LLMSettings } from '@/lib/types'
import type { ProductProfile, SiteData } from '@/lib/types'
import type { FormAnalysisResult } from './FormAnalyzer'
import type { PageContent } from './PageContentExtractor'
import type { FillEngineStatus, FillResult, SiteType, FieldValueMap, LogEntry, LogLevel } from './types'
import { callLLM, parseLLMJson } from './llm-utils'
import { buildProductContext } from './prompts/product-context'
import { buildBlogCommentPrompt } from './prompts/blog-comment-prompt'
import { buildDirectorySubmitPrompt } from './prompts/directory-submit-prompt'

const ANALYZE_TIMEOUT_MS = 10_000
const FILL_TIMEOUT_MS = 10_000

export interface FormFillEngineCallbacks {
	onStatusChange: (status: FillEngineStatus) => void
	onError: (error: Error) => void
	onLog?: (entry: LogEntry) => void
}

export interface FormFillEngineConfig {
	llmConfig: LLMSettings
	product: ProductProfile
	site: SiteData
	siteType: SiteType
	tabId: number
	callbacks: FormFillEngineCallbacks
	signal?: AbortSignal
}

/**
 * Send a message to the content script on a specific tab and wait for response.
 */
function sendToTab<T>(tabId: number, message: unknown, timeoutMs: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`Content script did not respond within ${timeoutMs}ms`))
		}, timeoutMs)

		chrome.tabs.sendMessage(tabId, message, (response) => {
			clearTimeout(timer)
			if (chrome.runtime.lastError) {
				reject(new Error(chrome.runtime.lastError.message))
				return
			}
			resolve(response as T)
		})
	})
}

export async function executeFormFill(config: FormFillEngineConfig): Promise<FillResult> {
	const { llmConfig, product, site, siteType, tabId, callbacks, signal } = config
	const { onStatusChange, onError, onLog } = callbacks

	let logId = 0
	const log = (level: LogLevel, phase: LogEntry['phase'], message: string, data?: unknown) => {
		if (onLog) {
			onLog({ id: ++logId, timestamp: Date.now(), level, phase, message, data })
		}
	}

	try {
		// Step 1: Analyze form
		onStatusChange('analyzing')
		log('info', 'system', `开始填写: ${site.name} (tab ${tabId})`)
		log('info', 'analyze', '正在发送表单分析请求...')
		const analyzePayload = { siteType }
		const analyzeMsg = { type: 'FLOAT_FILL', action: 'analyze', payload: analyzePayload }

		const analyzeResponse = await sendToTab<{ ok: boolean; analysis: FormAnalysisResult; pageContent?: PageContent }>(
			tabId,
			analyzeMsg,
			ANALYZE_TIMEOUT_MS
		)

		if (!analyzeResponse?.ok || !analyzeResponse.analysis) {
			throw new Error('Form analysis failed')
		}

		const analysis = analyzeResponse.analysis
		const pageContent = analyzeResponse.pageContent

		log('success', 'analyze', `表单分析完成: 发现 ${analysis.fields.length} 个字段`, {
			fields: analysis.fields.map(f => ({
				id: f.canonical_id,
				type: f.type,
				label: f.label || f.placeholder || f.name,
				required: f.required,
			})),
			pageInfo: {
				title: analysis.page_info.title,
				description: analysis.page_info.description?.slice(0, 100),
			},
		})

		if (analysis.fields.length === 0) {
			log('warning', 'analyze', '页面未发现可填写的表单字段')
			onStatusChange('done')
			return { filled: 0, skipped: 0, failed: 0, notes: 'No form fields found on this page.' }
		}

		// Notify progress
		chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'progress' }).catch(() => {})

		// Step 2: Build prompt and call LLM
		const productContext = buildProductContext(product)
		let systemPrompt: string

		if (siteType === 'blog_comment' && pageContent) {
			systemPrompt = buildBlogCommentPrompt({ productContext, pageContent, fields: analysis.fields })
		} else {
			systemPrompt = buildDirectorySubmitPrompt({ productContext, pageInfo: analysis.page_info, fields: analysis.fields })
		}

		const userPrompt = siteType === 'blog_comment'
			? `Fill the comment form on ${site.name}. Page URL: ${site.submit_url || 'current page'}.`
			: `Fill the submission form on ${site.name}. Submit URL: ${site.submit_url || 'current page'}.`

		const promptType = siteType === 'blog_comment' ? '博客评论' : '目录提交'
		log('info', 'llm', `正在调用 LLM (${promptType})...`, {
			systemPromptLength: systemPrompt.length,
			userPromptLength: userPrompt.length,
			systemPrompt,
			userPrompt,
			model: llmConfig.model,
			fieldCount: analysis.fields.length,
		})

		const rawResponse = await callLLM({
			config: llmConfig,
			systemPrompt,
			userPrompt,
			temperature: 0.3,
			maxTokens: 2048,
			signal,
			jsonMode: true,
		})

		// Step 3: Parse LLM response
		const fieldValues = parseLLMJson(rawResponse) as FieldValueMap
		const valueCount = Object.keys(fieldValues).length
		log('success', 'llm', `LLM 响应已解析: ${valueCount} 个字段值`, {
			fieldValues,
			rawResponse,
			responseLength: rawResponse.length,
		})

		// Map canonical_ids to selectors for content script
		const fieldsToFill = analysis.fields
			.filter((f) => fieldValues[f.canonical_id] !== undefined && fieldValues[f.canonical_id] !== '')
			.map((f) => ({
				canonical_id: f.canonical_id,
				value: fieldValues[f.canonical_id] as string,
				selector: f.selector,
			}))

		if (fieldsToFill.length === 0) {
			log('warning', 'llm', 'LLM 未返回任何字段值')
			onStatusChange('done')
			return { filled: 0, skipped: analysis.fields.length, failed: 0, notes: 'LLM returned no field values.' }
		}

		// Step 4: Fill form
		onStatusChange('filling')
		log('info', 'fill', `正在填写 ${fieldsToFill.length} 个字段...`, {
			fields: fieldsToFill.map(f => ({ id: f.canonical_id, value: f.value.slice(0, 50) })),
		})
		const fillMsg = { type: 'FLOAT_FILL', action: 'fill', payload: { fields: fieldsToFill } }

		const fillResponse = await sendToTab<{ ok: boolean; filled: number; failed: number }>(
			tabId,
			fillMsg,
			FILL_TIMEOUT_MS
		)

		const filledCount = fillResponse?.filled ?? 0
		const failedCount = fillResponse?.failed ?? 0
		if (failedCount > 0) {
			log('warning', 'fill', `填写完成: ${filledCount} 成功, ${failedCount} 失败`)
		} else {
			log('success', 'fill', `填写完成: ${filledCount} 个字段已成功填写`)
		}

		const result: FillResult = {
			filled: filledCount,
			skipped: analysis.fields.length - fieldsToFill.length,
			failed: failedCount,
			notes: `Filled ${filledCount} of ${analysis.fields.length} fields.`,
		}

		// Notify done
		chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'done' }).catch(() => {})
		log('success', 'system', `提交完成: ${result.filled} 填写, ${result.skipped} 跳过, ${result.failed} 失败`)
		onStatusChange('done')

		return result
	} catch (error) {
		const err = error instanceof Error ? error : new Error(String(error))

		log('error', 'system', err.message, {
			error: err.message,
			stack: err.stack?.split('\n').slice(0, 3),
		})

		// Check if aborted
		if (err.name === 'AbortError') {
			onStatusChange('idle')
			return { filled: 0, skipped: 0, failed: 0, notes: 'Cancelled.' }
		}

		chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'error' }).catch(() => {})
		onStatusChange('error')
		onError(err)

		return { filled: 0, skipped: 0, failed: 0, notes: err.message }
	}
}
