// src/agent/pipeline/llm.ts
import type { FieldValueMap } from '@/agent/types'
import { parseLLMJson, injectHrefNewline } from '@/agent/llm-utils'
import { buildProductContext, pickAnchorText, pickFounderName } from '@/agent/prompts/product-context'
import { buildBlogCommentPrompt } from '@/agent/prompts/blog-comment-prompt'
import { buildDirectorySubmitPrompt } from '@/agent/prompts/directory-submit-prompt'
import type { LLMFieldValue } from '@/agent/types'
import type { FormFillDeps, LlmPhaseInput } from './types'

/**
 * 建 prompt → callLLM → parse → injectHrefNewline → 触发 onLLMFields。返回 fieldValues。
 * 搬运自原 executeFormFill Step 2+3（FormFillEngine.ts:268-327）。
 */
export async function llmPhase(deps: FormFillDeps, input: LlmPhaseInput): Promise<FieldValueMap> {
  const { analysis, pageContent, product, site, siteType, signal } = input

  // Step 2: build prompt
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
  deps.log('info', 'llm', `正在调用 LLM (${promptType})...`, {
    systemPromptLength: systemPrompt.length,
    userPromptLength: userPrompt.length,
    systemPrompt,
    userPrompt,
    fieldCount: analysis.fields.length,
  })

  const rawResponse = await deps.callLLM({
    systemPrompt,
    userPrompt,
    temperature: siteType === 'blog_comment' ? 0.7 : 0.3,
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
