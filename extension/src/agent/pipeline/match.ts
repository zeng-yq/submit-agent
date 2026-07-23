// src/agent/pipeline/match.ts
import type { FormAnalysisResult } from '@/agent/FormAnalyzer'
import type { FieldValueMap } from '@/agent/types'
import { fuzzyMatchField } from '@/agent/FormFillEngine'
import type { FieldsToFill, MatchResult } from './types'

/**
 * 把 LLM 返回的 fieldValues 映射到表单字段（精确 canonical_id → 失败回退 fuzzy）。
 * 纯函数，无副作用。搬运自原 executeFormFill Step 4a（FormFillEngine.ts:329-366）。
 */
export function matchFields(analysis: FormAnalysisResult, fieldValues: FieldValueMap): MatchResult {
  // 1. 精确匹配
  let fieldsToFill: FieldsToFill = analysis.fields
    .filter((f) => fieldValues[f.canonical_id] !== undefined && fieldValues[f.canonical_id] !== '')
    .map((f) => ({
      canonical_id: f.canonical_id,
      value: fieldValues[f.canonical_id] as string,
      selector: f.selector,
    }))

  const valueCount = Object.keys(fieldValues).length

  // 2. 精确为空且有值 → 回退 fuzzy
  let matchedViaFuzzy = false
  if (fieldsToFill.length === 0 && valueCount > 0) {
    matchedViaFuzzy = true
    const usedCanonicalIds = new Set<string>()
    fieldsToFill = []
    for (const [llmKey, llmValue] of Object.entries(fieldValues)) {
      if (typeof llmValue !== 'string' || llmValue === '') continue
      // 仅一个未过滤表单时传其 index 做同表单优先；否则跳过 formIndex
      const targetFormIndex = analysis.forms.filter(f => !f.filtered).length === 1
        ? analysis.forms.find(f => !f.filtered)!.form_index
        : undefined
      const matched = fuzzyMatchField(llmKey, analysis.fields, usedCanonicalIds, targetFormIndex)
      if (matched) {
        usedCanonicalIds.add(matched.canonical_id)
        fieldsToFill.push({ canonical_id: matched.canonical_id, value: llmValue, selector: matched.selector })
      }
    }
  }

  return {
    fieldsToFill,
    skipped: analysis.fields.length - fieldsToFill.length,
    matchedViaFuzzy,
  }
}
