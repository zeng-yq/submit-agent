/**
 * FormFillEngine — unified form filling engine.
 * Runs in the sidepanel context.
 * Analyzes form → 1 LLM call → batch fill.
 */

import type { LLMSettings } from '@/lib/types'
import type { ProductProfile, SiteData } from '@/lib/types'
import type { FormAnalysisResult } from './FormAnalyzer'
import type { PageContent } from './PageContentExtractor'
import { VERIFIED_SUCCESS, type FillEngineStatus, type FillResult, type SiteType, type FieldValueMap, type LogEntry, type LogLevel, type LLMFieldData, type LLMFieldValue, type VerifyResult } from './types'
import { verifyAfterNavigation, applyNavigationVerdict, type ModerationVerdict } from './verify-after-navigation'
import type { SubmitResponse } from './comment-submit'
import { callLLM, parseLLMJson, injectHrefNewline } from './llm-utils'
import { buildProductContext, pickAnchorText, pickFounderName } from './prompts/product-context'
import { buildBlogCommentPrompt } from './prompts/blog-comment-prompt'
import { buildDirectorySubmitPrompt } from './prompts/directory-submit-prompt'
import { sendToTab, sendProgress } from '@/messaging/router'
import type { AnalyzeResponse, FillResponse, VerifyModerationResponse } from '@/messaging/messages'

const ANALYZE_TIMEOUT_MS = 10_000
const FILL_TIMEOUT_MS = 10_000

/** Normalize a string for comparison: lowercase, split on non-alphanumeric. */
function tokenize(s: string): Set<string> {
	return new Set(
		s.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim().split(/\s+/).filter(Boolean)
	)
}

/** Compute Jaccard token similarity between two strings. Returns 0–1. */
function tokenSimilarity(a: string, b: string): number {
	const ta = tokenize(a)
	const tb = tokenize(b)
	if (ta.size === 0 && tb.size === 0) return 0
	const intersection = new Set([...ta].filter(t => tb.has(t)))
	const union = new Set([...ta, ...tb])
	return intersection.size / union.size
}

/**
 * Check if an LLM key matches a form field.
 * Uses exact normalized match first, then token similarity with > 0.5 threshold.
 */
function matchesField(
	key: string,
	field: FormAnalysisResult['fields'][number],
): boolean {
	// Exact match fast path (normalized string equality)
	const normalizedKey = key.toLowerCase().replace(/[-_\s]/g, '')

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
		const norm = id.toLowerCase().replace(/[-_\s]/g, '')
		if (norm === normalizedKey) return true
	}

	// Token similarity match (threshold > 0.5)
	for (const id of identifiers) {
		if (!id) continue
		if (tokenSimilarity(key, id) > 0.5) return true
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
	const key = llmKey

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
	onLLMFields?: (data: LLMFieldData) => void
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

/** runSubmitAndVerify 的依赖：sendSubmit 发 submit 消息；verifyNavigation 跨页面复核 */
export interface SubmitFlowDeps {
	/** 发 submit 消息并等待回复；reject 表示 content script 上下文随整页跳转销毁 */
	sendSubmit: () => Promise<SubmitResponse>
	/** 跨页面验证（整页跳转落定后复核审核状态），返回 confirmed/moderation/unverified */
	verifyNavigation: () => Promise<ModerationVerdict>
	/** 日志回调（可选） */
	log?: (level: LogLevel, message: string) => void
}

export interface SubmitFlowOutcome {
	submitted: boolean | undefined
	verifyResult: VerifyResult
	submitError?: string
}

/**
 * 执行评论提交并判定结果（blog_comment 自动提交）。
 *
 * submit 响应正常时按 verifyResult 走原逻辑：ajax/cleared 直接成立；
 * navigating/pagehide 经 verifyNavigation 跨页面复核。
 *
 * submit 响应丢失（sendSubmit reject）时，远程评论 iframe（Blogger/Jetpack）提交触发顶层导航会
 * 销毁 content script 上下文使 sendToTab reject——此时主动跨页面验证，用跳转后页面状态反推是否成功，
 * 而非直接判 not_attempted 失败，否则既有 verifyAfterNavigation 救场机制会被完全绕过。
 */
export async function runSubmitAndVerify(deps: SubmitFlowDeps): Promise<SubmitFlowOutcome> {
	const { sendSubmit, verifyNavigation, log } = deps

	let submitResponse: SubmitResponse | undefined
	try {
		submitResponse = await sendSubmit()
	} catch (err) {
		log?.('info', '提交响应丢失（疑似整页跳转销毁上下文），转入跨页面验证...')
		return resolveLostSignal(await verifyNavigation(), err)
	}

	if (!submitResponse?.ok) {
		const submitError = submitResponse?.error || '提交消息无响应'
		log?.('error', `自动提交失败: ${submitError}`)
		return { submitted: submitResponse?.clicked, verifyResult: 'not_attempted', submitError }
	}

	let verifyResult: VerifyResult = submitResponse.verifyResult
	let submitError = submitResponse.error
	const submitted = submitResponse.clicked

	if (verifyResult === 'navigating' || verifyResult === 'pagehide') {
		log?.('info', '提交触发整页跳转，等待页面落定后复核审核状态...')
		const verdict = await verifyNavigation()
		verifyResult = applyNavigationVerdict(verifyResult, verdict)
		if (verdict === 'moderation') submitError = '评论待审核，未发布'
		else if (verdict === 'unverified') submitError = '提交后未能确认发布状态'
	}

	return { submitted, verifyResult, submitError }
}

/** submit 响应丢失时，按跨页面验证结论映射最终结果 */
function resolveLostSignal(verdict: ModerationVerdict, err: unknown): SubmitFlowOutcome {
	if (verdict === 'confirmed') {
		// 跳转后确认评论已发布（非待审核）→ 视同成功导航
		return { submitted: true, verifyResult: 'navigating' }
	}
	if (verdict === 'moderation') {
		return { submitted: true, verifyResult: 'pending_moderation', submitError: '评论待审核，未发布' }
	}
	const msg = err instanceof Error ? err.message : String(err)
	return { submitted: undefined, verifyResult: 'not_attempted', submitError: `提交响应丢失且跳转后无法确认: ${msg}` }
}

export async function executeFormFill(config: FormFillEngineConfig): Promise<FillResult> {
	const { llmConfig, product, site, siteType, tabId, callbacks, signal } = config
	const { onStatusChange, onError, onLog, onLLMFields } = callbacks

	let logId = 0
	const log = (level: LogLevel, phase: LogEntry['phase'], message: string, data?: unknown, url?: string) => {
		if (onLog) {
			onLog({ id: ++logId, timestamp: Date.now(), level, phase, message, data, url })
		}
	}

	try {
		// Step 1: Analyze form
		onStatusChange('analyzing')
		log('info', 'system', `开始填写: ${site.name} (tab ${tabId})`, undefined, site.submit_url ?? undefined)
		log('info', 'analyze', '正在发送表单分析请求...')
		const analyzePayload = { siteType }

		const analyzeResponse = await sendToTab<AnalyzeResponse>(
			tabId,
			{ type: 'TAB_COMMAND', action: 'analyze', payload: analyzePayload },
			ANALYZE_TIMEOUT_MS
		)

		if (!analyzeResponse?.ok || !analyzeResponse.analysis) {
			throw new Error('Form analysis failed')
		}

		const analysis = analyzeResponse.analysis
		const pageContent = analyzeResponse.pageContent as PageContent | undefined

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
				const msg = '页面未发现可填写的表单字段'
				log('error', 'analyze', msg)
				onStatusChange('error')
				onError(new Error(msg))
				return { filled: 0, skipped: 0, failed: 0, notes: 'No form fields found on this page.' }
			}

		// Notify progress
		sendProgress('progress')

		// Annotate detected fields on the page
		await sendToTab(
			tabId,
			{
				type: 'TAB_COMMAND',
				action: 'annotate',
				payload: { fields: analysis.fields.map(f => ({ selector: f.selector })) },
			},
			5000,
		).catch(() => {})

		// Scroll to the first annotated field so the user can see the form
		await sendToTab(tabId, {
			type: 'TAB_COMMAND',
			action: 'scroll-to-first',
			payload: { fields: analysis.fields.map(f => ({ selector: f.selector })) },
		}, 5000).catch(() => {})

		// Step 2: Build prompt and call LLM
		const selectedAnchor = pickAnchorText(product)
		const selectedFounderName = pickFounderName(product)
		const productContext = buildProductContext(product, selectedAnchor, selectedFounderName)
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
			temperature: siteType === 'blog_comment' ? 0.7 : 0.3,
			maxTokens: 2048,
			signal,
			jsonMode: true,
		})

		// Step 3: Parse LLM response
		const fieldValues = parseLLMJson(rawResponse) as FieldValueMap
		// 在评论正文的 href 闭合引号前插入真实换行符，规避评论系统对评论内链接的简单正则剥离
		for (const key of Object.keys(fieldValues)) {
			fieldValues[key] = injectHrefNewline(fieldValues[key])
		}
		const valueCount = Object.keys(fieldValues).length
		log('success', 'llm', `LLM 响应已解析: ${valueCount} 个字段值`, {
			fieldValues,
			rawResponse,
			responseLength: rawResponse.length,
		})

		// 构建 LLM 字段值展示数据
		if (onLLMFields && valueCount > 0) {
			const fieldLabelMap = new Map(analysis.fields.map(f => [f.canonical_id, f.label || f.inferred_purpose || f.name || f.canonical_id]))
			const llmFields: LLMFieldValue[] = Object.entries(fieldValues).map(([key, value]) => ({
				label: fieldLabelMap.get(key) || key,
				value: typeof value === 'string' ? value : String(value),
			}))
			if (llmFields.length > 0) {
				onLLMFields({ fields: llmFields })
			}
		}

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
				// When only one unfiltered form exists, pass its index for same-form priority.
					// Otherwise skip formIndex since we can't determine which form the LLM key targets.
					const targetFormIndex = analysis.forms.filter(f => !f.filtered).length === 1
						? analysis.forms.find(f => !f.filtered)!.form_index
						: undefined
					const matched = fuzzyMatchField(llmKey, analysis.fields, usedCanonicalIds, targetFormIndex)
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
				const noValMsg = 'LLM 未返回任何字段值'
				log('error', 'llm', noValMsg)
				onStatusChange('error')
				onError(new Error(noValMsg))
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
				type: 'TAB_COMMAND',
				action: 'annotate-active',
				payload: { index: i },
			}, 3000).catch(() => {})

			// Small delay so user can see the highlight
			await new Promise(r => setTimeout(r, 150))

			// Fill this single field
			const fillResponse = await sendToTab<FillResponse>(
				tabId,
				{ type: 'TAB_COMMAND', action: 'fill', payload: { fields: [field] } },
				FILL_TIMEOUT_MS,
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

		// Step 5: 自动提交 + 弱验证（仅 blog_comment 且填写无失败时）
		let submitted: boolean | undefined
		let verifyResult: VerifyResult | undefined
		let submitError: string | undefined
		if (siteType === 'blog_comment' && failedCount === 0 && filledCount > 0) {
			log('info', 'fill', '正在自动提交评论并验证...')
			const outcome = await runSubmitAndVerify({
				sendSubmit: () => sendToTab<SubmitResponse>(
					tabId,
					{
						type: 'TAB_COMMAND',
						action: 'submit',
						payload: {
							fields: analysis.fields.map((f) => ({
								selector: f.selector,
								type: f.type,
								effective_type: f.effective_type,
								name: f.name,
								id: f.id,
								canonical_id: f.canonical_id,
							})),
						},
					},
					20_000,
				),
				verifyNavigation: () => verifyAfterNavigation(tabId, {
					getTabUrl: async (id) => {
						try {
							const tab = await chrome.tabs.get(id)
							return tab.url ?? ''
						} catch {
							return ''
						}
					},
					sendVerify: (id) => sendToTab<VerifyModerationResponse>(
						id,
						{ type: 'TAB_COMMAND', action: 'verify-moderation' },
						2000,
					),
					sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
				}),
				log: (level, message) => log(level, 'fill', message),
			})
			submitted = outcome.submitted
			verifyResult = outcome.verifyResult
			submitError = outcome.submitError

			const verified = VERIFIED_SUCCESS.includes(verifyResult)
			log(
				verified ? 'success' : 'warning',
				'fill',
				// pending_moderation：submitError 已是「评论待审核，未发布」，省略冗余 verifyResult 码以缩短日志
				verifyResult === 'pending_moderation'
					? `提交结果: ${submitError}`
					: `提交结果: ${verifyResult}${submitError ? ' - ' + submitError : ''}`,
			)
		}

		const result: FillResult = {
			filled: filledCount,
			skipped: analysis.fields.length - fieldsToFill.length,
			failed: failedCount,
			notes: `Filled ${filledCount} of ${analysis.fields.length} fields.`,
			submitted,
			verifyResult,
			submitError,
		}

		// Notify done
		sendProgress('done')
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

		sendProgress('error')
		onStatusChange('error')
		onError(err)

		return { filled: 0, skipped: 0, failed: 0, notes: err.message }
	}
}
