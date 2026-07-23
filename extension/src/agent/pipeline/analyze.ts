// src/agent/pipeline/analyze.ts
import type { ExtensionMessage } from '@/messaging/messages'
import type { AnalyzeResponse } from '@/messaging/messages'
import type { FormFillDeps, AnalyzePhaseInput, AnalyzePhaseOutput } from './types'

const ANALYZE_TIMEOUT_MS = 10_000

/**
 * 分析表单：发 analyze → 取 analysis+pageContent；字段非空时广播 progress + annotate + scroll-to-first。
 * 搬运自原 executeFormFill Step 1（FormFillEngine.ts:206-266）。
 * fields.length===0 时不触发 progress/annotate/scroll（与现状一致——现状这些在空字段早退之后）。
 */
export async function analyzePhase(deps: FormFillDeps, input: AnalyzePhaseInput): Promise<AnalyzePhaseOutput> {
  const analyzeMsg: ExtensionMessage = { type: 'TAB_COMMAND', action: 'analyze', payload: { siteType: input.siteType } }
  const analyzeResponse = await deps.sendToTabMessage<AnalyzeResponse>(analyzeMsg, ANALYZE_TIMEOUT_MS)

  if (!analyzeResponse?.ok || !analyzeResponse.analysis) {
    throw new Error('Form analysis failed')
  }

  const { analysis, pageContent } = analyzeResponse

  deps.log('success', 'analyze', `表单分析完成: 发现 ${analysis.fields.length} 个字段`, {
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

  // 字段非空才触发后续 UX 副作用（与现状空字段早退一致）
  if (analysis.fields.length > 0) {
    deps.sendProgress('progress')
    await deps.sendToTabMessage(
      { type: 'TAB_COMMAND', action: 'annotate', payload: { fields: analysis.fields.map(f => ({ selector: f.selector })) } },
      5000,
    ).catch(() => {})
    await deps.sendToTabMessage(
      { type: 'TAB_COMMAND', action: 'scroll-to-first', payload: { fields: analysis.fields.map(f => ({ selector: f.selector })) } },
      5000,
    ).catch(() => {})
  }

  return { analysis, pageContent }
}
