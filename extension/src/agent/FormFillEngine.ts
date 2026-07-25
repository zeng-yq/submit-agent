/**
 * FormFillEngine — unified form filling engine.
 * Runs in the sidepanel context.
 * Analyzes form → 1 LLM call → batch fill.
 */

import type { LLMSettings } from '@/lib/types'
import type { ProductProfile, SiteData } from '@/lib/types'
import { VERIFIED_SUCCESS, verifyResultLabel, type FillEngineStatus, type FillResult, type SiteType, type LogEntry, type LogLevel, type LLMFieldData, type VerifyResult } from './types'
import { verifyAfterNavigation, applyNavigationVerdict, type ModerationVerdict } from './verify-after-navigation'
import type { SubmitResponse } from './comment-submit'
import { pickCommentField } from './form-analyzer'
import { callLLM } from './llm-utils'
import { sendToTab, sendProgress } from '@/messaging/router'
import type { VerifyModerationResponse, ExtensionMessage } from '@/messaging/messages'
import { matchFields } from './pipeline/match'
import { analyzePhase } from './pipeline/analyze'
import { llmPhase } from './pipeline/llm'
import { fillPhase } from './pipeline/fill'
import { SITE_TYPE_STRATEGIES } from './pipeline/site-type'
import type { FormFillDeps } from './pipeline/types'

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
	verifyNavigation: (commentText?: string) => Promise<ModerationVerdict>
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
export async function runSubmitAndVerify(deps: SubmitFlowDeps, commentText?: string): Promise<SubmitFlowOutcome> {
	const { sendSubmit, verifyNavigation, log } = deps

	let submitResponse: SubmitResponse | undefined
	try {
		submitResponse = await sendSubmit()
	} catch (err) {
		log?.('info', '提交响应丢失（疑似整页跳转销毁上下文），转入跨页面验证...')
		return resolveLostSignal(await verifyNavigation(commentText), err)
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
		const verdict = await verifyNavigation(commentText)
		verifyResult = applyNavigationVerdict(verifyResult, verdict)
		if (verdict === 'moderation') submitError = '评论待审核，未发布'
		else if (verdict === 'cloudflare') submitError = '需要 Cloudflare 人机验证，未发布'
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
	if (verdict === 'cloudflare') {
		return { submitted: true, verifyResult: 'blocked_cloudflare', submitError: '需要 Cloudflare 人机验证，未发布' }
	}
	const msg = err instanceof Error ? err.message : String(err)
	return { submitted: undefined, verifyResult: 'not_attempted', submitError: `提交响应丢失且跳转后无法确认: ${msg}` }
}

/**
 * 从 config 构造真实 FormFillDeps（生产路径；测试可注入 mock）。
 * logId 为 per-call 计数（每次 executeFormFill 调用都从 0 开始，与原闭包一致）。
 */
function buildRealDeps(config: FormFillEngineConfig): FormFillDeps {
	const { tabId, llmConfig, callbacks } = config
	let logId = 0
	return {
		// 泛型透传：箭头函数声明 <R> 并直接转调 sendToTab<R>，签名与 FormFillDeps['sendToTabMessage'] 自洽
		sendToTabMessage: <R>(msg: ExtensionMessage, timeoutMs: number) => sendToTab<R>(tabId, msg, timeoutMs),
		sendProgress,
		callLLM: (opts) => callLLM({ config: llmConfig, ...opts }),
		verifyNavigation: (commentText?: string) => verifyAfterNavigation(tabId, {
			getTabUrl: async (id) => {
				try { const tab = await chrome.tabs.get(id); return tab.url ?? '' } catch { return '' }
			},
			sendVerify: (id, txt) => sendToTab<VerifyModerationResponse>(id, { type: 'TAB_COMMAND', action: 'verify-moderation', payload: { commentText: txt } }, 2000),
			sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
		}, commentText),
		log: (level, phase, message, data, url) => {
			if (callbacks.onLog) callbacks.onLog({ id: ++logId, timestamp: Date.now(), level, phase, message, data, url })
		},
		onLLMFields: callbacks.onLLMFields,
	}
}

export async function executeFormFill(config: FormFillEngineConfig, deps?: FormFillDeps): Promise<FillResult> {
	const { product, site, siteType, tabId, callbacks, signal } = config
	const { onStatusChange, onError } = callbacks

	const d = deps ?? buildRealDeps(config)
	// Step 2-5 区段仍用本地 log 别名（最小改动；runSubmitAndVerify 的 log 适配也依赖它）
	// buildRealDeps.log 是无 this 的箭头函数，直接取引用即可，无需 .bind(d)
	const log = d.log

	try {
		// Step 1: Analyze form
		onStatusChange('analyzing')
		d.log('info', 'system', `开始填写: ${site.name} (tab ${tabId})`, undefined, site.submit_url ?? undefined)
		d.log('info', 'analyze', '正在发送表单分析请求...')

		const { analysis, pageContent } = await analyzePhase(d, { siteType })

		if (analysis.fields.length === 0) {
			const msg = '页面未发现可填写的表单字段'
			d.log('error', 'analyze', msg)
			onStatusChange('error')
			onError(new Error(msg))
			return { filled: 0, skipped: 0, failed: 0, notes: 'No form fields found on this page.' }
		}

		// Step 2+3: build prompt + callLLM + parse（搬运至 pipeline/llm.ts）
		const fieldValues = await llmPhase(d, { analysis, pageContent, product, site, siteType, signal })
		const valueCount = Object.keys(fieldValues).length

		// Map LLM field values → form fields (exact match → fuzzy fallback). Pure.
		const { fieldsToFill, matchedViaFuzzy } = matchFields(analysis, fieldValues)
		if (matchedViaFuzzy && fieldsToFill.length > 0) {
			log('info', 'llm', `模糊匹配成功: ${fieldsToFill.length} 个字段`, {
				matchedFields: fieldsToFill.map(f => f.canonical_id),
			})
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

		// Step 4b: Fill form — sequential with annotation
		onStatusChange('filling')
		const { filled: filledCount, failed: failedCount } = await fillPhase(d, { fieldsToFill })

		// Step 5: 自动提交 + 弱验证（strategy.autoSubmit 且填写无失败时）
		let submitted: boolean | undefined
		let verifyResult: VerifyResult | undefined
		let submitError: string | undefined
		if (SITE_TYPE_STRATEGIES[siteType].autoSubmit && failedCount === 0 && filledCount > 0) {
			log('info', 'fill', '正在自动提交评论并验证...')
			// 提取评论文本：跳转后在新页面搜索它作为「评论已发布」的正面证据。
			// 用 pickCommentField 识别评论框（textarea / comment|reply|message 语义）——
			// effective_type==='comment' 是死分支（inferEffectiveType 永不返回 'comment'），勿用。
			const commentField = pickCommentField(analysis.fields)
			const commentText = commentField ? fieldValues[commentField.canonical_id] : undefined
			const outcome = await runSubmitAndVerify({
				sendSubmit: () => d.sendToTabMessage<SubmitResponse>(
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
				verifyNavigation: d.verifyNavigation,
				log: (level, message) => d.log(level, 'fill', message),
			}, commentText)
			submitted = outcome.submitted
			verifyResult = outcome.verifyResult
			submitError = outcome.submitError

			const verified = VERIFIED_SUCCESS.includes(verifyResult)
			log(
				verified ? 'success' : 'warning',
				'fill',
				`提交结果: ${verifyResultLabel(verifyResult)}`,
				submitError,
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
		d.sendProgress('done')
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

		d.sendProgress('error')
		onStatusChange('error')
		onError(err)

		return { filled: 0, skipped: 0, failed: 0, notes: err.message }
	}
}
