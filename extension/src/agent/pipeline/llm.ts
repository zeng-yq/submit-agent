// src/agent/pipeline/llm.ts
import type { FieldValueMap, LLMFieldValue } from '@/agent/types'
import { parseLLMJson, injectHrefNewline } from '@/agent/llm-utils'
import { buildProductContext, pickAnchorText, pickFounderName } from '@/agent/prompts/product-context'
import { SITE_TYPE_STRATEGIES } from './site-type'
import type { FormFillDeps, LlmPhaseInput } from './types'

/**
 * 建 prompt → callLLM → parse → injectHrefNewline → 触发 onLLMFields。返回 fieldValues。
 * prompt 选择/temperature/label 走 SITE_TYPE_STRATEGIES（消除 siteType 分支）。
 */
export async function llmPhase(deps: FormFillDeps, input: LlmPhaseInput): Promise<FieldValueMap> {
  const { analysis, pageContent, product, site, siteType, signal } = input
  const strategy = SITE_TYPE_STRATEGIES[siteType]

  // Step 2: build prompt
  const selectedAnchor = pickAnchorText(product)
  const selectedFounderName = pickFounderName(product)
  const productContext = buildProductContext(product, selectedAnchor, selectedFounderName)
  const systemPrompt = strategy.buildSystemPrompt({
    productContext,
    pageContent,
    pageInfo: analysis.page_info,
    fields: analysis.fields,
    forms: analysis.forms,
  })
  const userPrompt = strategy.buildUserPrompt(site)

  deps.log('info', 'llm', `正在调用 LLM (${strategy.label})...`, {
    systemPromptLength: systemPrompt.length,
    userPromptLength: userPrompt.length,
    systemPrompt,
    userPrompt,
    fieldCount: analysis.fields.length,
  })

  const rawResponse = await deps.callLLM({
    systemPrompt,
    userPrompt,
    temperature: strategy.temperature,
    maxTokens: 2048,
    signal,
    jsonMode: true,
  })

  // Step 3: parse
  const fieldValues = parseLLMJson(rawResponse) as FieldValueMap
  for (const key of Object.keys(fieldValues)) {
    fieldValues[key] = injectHrefNewline(fieldValues[key])
  }
  const valueCount = Object.keys(fieldValues).length
  deps.log('success', 'llm', `LLM 响应已解析: ${valueCount} 个字段值`, { fieldValues, rawResponse, responseLength: rawResponse.length })

  if (deps.onLLMFields && valueCount > 0) {
    const fieldLabelMap = new Map(analysis.fields.map(f => [f.canonical_id, f.label || f.inferred_purpose || f.name || f.canonical_id]))
    const llmFields: LLMFieldValue[] = Object.entries(fieldValues).map(([key, value]) => ({
      label: fieldLabelMap.get(key) || key,
      value: typeof value === 'string' ? value : String(value),
    }))
    if (llmFields.length > 0) deps.onLLMFields({ fields: llmFields })
  }

  return fieldValues
}
