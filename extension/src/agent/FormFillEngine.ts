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

function normalizeKey(key: string): string {
	return key.toLowerCase().replace(/[-_\s]/g, '')
}

function matchesField(
	key: string,
	field: FormAnalysisResult['fields'][number],
): boolean {
	const identifiers = [
		field.canonical_id,
		field.name,
		field.id,
		field.label,
		field.placeholder,
		field.inferred_purpose,
	]

	for (const id of identifiers) {
		if (!id) continue
		const norm = normalizeKey(id)
		if (norm === key || norm.includes(key) || key.includes(norm)) {
			return true
		}
	}
	return false
}

/**
 * Try to fuzzy-match an LLM key to a form field.
 * Prefers fields within the same form (formIndex) when provided,
 * falls back to global match if no same-form match found.
 */
export function fuzzyMatchField(
	llmKey: string,
	fields: FormAnalysisResult['fields'],
	usedCanonicalIds: Set<string>,
	formIndex?: number,
): FormAnalysisResult['fields'][number] | null {
	const key = normalizeKey(llmKey)

	// Phase 1: Try same-form match first
	if (formIndex !== undefined) {
		for (const field of fields) {
			if (usedCanonicalIds.has(field.canonical_id)) continue
			if (field.form_index !== formIndex) continue
			if (matchesField(key, field)) return field
		}
	}

	// Phase 2: Fall back to global match
	for (const field of fields) {
		if (usedCanonicalIds.has(field.canonical_id)) continue
		if (matchesField(key, field)) return field
	}

	return null
}

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
				type: f.effective_type || f.type,
				label: f.label || f.inferred_purpose || '(unknown)',
				placeholder: f.placeholder || undefined,
				required: f.required,
			})),
			pageInfo: {
				title: analysis.page_info.title,
				description: analysis.page_info.description?.slice(0, 200),
			},
		})

		if (analysis.fields.length === 0) {
			log('warning', 'analyze', '页面未发现可填写的表单字段')
			onStatusChange('done')
			return { filled: 0, skipped: 0, failed: 0, notes: 'No form fields found on this page.' }
		}

		// Notify progress
		chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'progress' }).catch(() => {})

		// Annotate detected fields on the page
		const annotateMsg = {
			type: 'FLOAT_FILL',
			action: 'annotate',
			payload: { fields: analysis.fields.map(f => ({ selector: f.selector })) },
		}
		await sendToTab(tabId, annotateMsg, 5000).catch(() => {})

		// Step 2: Build prompt and call LLM
		const productContext = buildProductContext(product)
		let systemPrompt: string

		if (siteType === 'blog_comment' && pageContent) {
			systemPrompt = buildBlogCommentPrompt({ productContext, pageContent, fields: analysis.fields, forms: analysis.forms })
		} else {
			systemPrompt = buildDirectorySubmitPrompt({ productContext, pageInfo: analysis.page_info, fields: analysis.fields, forms: analysis.forms })
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
		let fieldsToFill = analysis.fields
			.filter((f) => fieldValues[f.canonical_id] !== undefined && fieldValues[f.canonical_id] !== '')
			.map((f) => ({
				canonical_id: f.canonical_id,
				value: fieldValues[f.canonical_id] as string,
				selector: f.selector,
			}))

		// Fallback: fuzzy match LLM keys to field identifiers when exact match fails
		if (fieldsToFill.length === 0 && valueCount > 0) {
			const usedCanonicalIds = new Set<string>()
			fieldsToFill = []

			for (const [llmKey, llmValue] of Object.entries(fieldValues)) {
				if (typeof llmValue !== 'string' || llmValue === '') continue
				const matched = fuzzyMatchField(llmKey, analysis.fields, usedCanonicalIds)
				if (matched) {
					usedCanonicalIds.add(matched.canonical_id)
					fieldsToFill.push({
						canonical_id: matched.canonical_id,
						value: llmValue,
						selector: matched.selector,
					})
				}
			}

			if (fieldsToFill.length > 0) {
				log('info', 'llm', `模糊匹配成功: ${fieldsToFill.length} 个字段`, {
					matchedFields: fieldsToFill.map(f => f.canonical_id),
				})
			}
		}

		if (fieldsToFill.length === 0) {
			if (valueCount > 0) {
				// LLM returned values but none matched any field — treat as error
				log('error', 'llm', `LLM 返回了 ${valueCount} 个值但无法匹配任何字段`, {
					llmKeys: Object.keys(fieldValues),
					expectedIds: analysis.fields.map(f => f.canonical_id),
				})
				onStatusChange('error')
				onError(new Error(`LLM 返回的 ${valueCount} 个字段值无法匹配页面表单字段`))
				return { filled: 0, skipped: analysis.fields.length, failed: 0, notes: 'LLM field key mismatch — no fields matched.' }
			}
			log('warning', 'llm', 'LLM 未返回任何字段值')
			onStatusChange('done')
			return { filled: 0, skipped: analysis.fields.length, failed: 0, notes: 'LLM returned no field values.' }
		}

		// Step 4: Fill form — sequential with annotation
		onStatusChange('filling')
		log('info', 'fill', `正在填写 ${fieldsToFill.length} 个字段...`, {
			fields: fieldsToFill.map(f => ({ id: f.canonical_id, value: f.value.slice(0, 50) })),
		})

		let filledCount = 0
		let failedCount = 0

		for (let i = 0; i < fieldsToFill.length; i++) {
			const field = fieldsToFill[i]

			// Highlight current field
			await sendToTab(tabId, {
				type: 'FLOAT_FILL',
				action: 'annotate-active',
				payload: { index: i },
			}, 3000).catch(() => {})

			// Small delay so user can see the highlight
			await new Promise(r => setTimeout(r, 150))

			// Fill this single field
			const fillMsg = { type: 'FLOAT_FILL', action: 'fill', payload: { fields: [field] } }
			const fillResponse = await sendToTab<{ ok: boolean; filled: number; failed: number }>(
				tabId, fillMsg, FILL_TIMEOUT_MS
			)

			filledCount += fillResponse?.filled ?? 0
			failedCount += fillResponse?.failed ?? 0

			log('info', 'fill', `字段 ${field.canonical_id}: ${fillResponse?.filled ? '成功' : '失败'}`, {
				canonicalId: field.canonical_id,
				value: field.value.slice(0, 50),
			})
		}
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

		// Clear annotations only on successful completion
		await sendToTab(tabId, {
			type: 'FLOAT_FILL',
			action: 'annotate-clear',
		}, 3000).catch(() => {})

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
