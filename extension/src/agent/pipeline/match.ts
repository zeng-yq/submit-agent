// src/agent/pipeline/match.ts
import type { FormAnalysisResult } from '@/agent/FormAnalyzer'
import type { FieldValueMap } from '@/agent/types'
import { fuzzyMatchField } from './fuzzy'
import type { FieldsToFill, MatchResult } from './types'

/**
 * 从 LLM 返回的值里挑出最长的非空字符串。
 * 用于单字段表单（如 Blogger c-wiz 评论框）取评论正文：评论天然最长，短字段
 * （name/email/url）不会被选中。无任何非空值时返回 null。
 */
function pickLongestValue(fieldValues: FieldValueMap): string | null {
  let best: string | null = null
  for (const v of Object.values(fieldValues)) {
    if (typeof v !== 'string' || v === '') continue
    if (best === null || v.length > best.length) best = v
  }
  return best
}

/**
 * 把 LLM 返回的 fieldValues 映射到表单字段（精确 canonical_id → 失败回退 fuzzy）。
 * 纯函数，无副作用。搬运自原 executeFormFill Step 4a（FormFillEngine.ts:329-366）。
 */
export function matchFields(analysis: FormAnalysisResult, fieldValues: FieldValueMap): MatchResult {
  // 0. 单字段表单 + LLM 多值 → 取最长值填给唯一字段。
  // 典型 Blogger c-wiz 评论：表单只识别到 1 个评论框，但 LLM 模仿 prompt 示例返回
  // name/email/website/comment 多字段，精确匹配会把短字段（如姓名）填进评论框。
  // 取最长值（评论正文）兜底，绕过精确/fuzzy 匹配。
  if (analysis.fields.length === 1 && Object.keys(fieldValues).length > 1) {
    const longest = pickLongestValue(fieldValues)
    if (longest !== null) {
      const sole = analysis.fields[0]
      return {
        fieldsToFill: [{ canonical_id: sole.canonical_id, value: longest, selector: sole.selector }],
        skipped: 0,
        matchedViaFuzzy: false,
        singleFieldLongestPick: true,
      }
    }
  }

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
