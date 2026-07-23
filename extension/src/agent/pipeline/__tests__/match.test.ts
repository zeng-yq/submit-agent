// src/agent/pipeline/__tests__/match.test.ts
import { describe, it, expect } from 'vitest'
import { matchFields } from '@/agent/pipeline/match'
import type { FormAnalysisResult } from '@/agent/FormAnalyzer'

const field = (over: Partial<FormAnalysisResult['fields'][number]> = {}): FormAnalysisResult['fields'][number] => ({
  canonical_id: 'f1', name: 'name', id: 'name', label: 'Name', placeholder: '',
  type: 'input', effective_type: 'author', inferred_purpose: 'author',
  required: false, form_index: 0, selector: '#name', ...over,
} as FormAnalysisResult['fields'][number])

const analysis = (fields: FormAnalysisResult['fields'], forms: any[] = [{ form_index: 0, filtered: false }]): FormAnalysisResult =>
  ({ fields, forms, page_info: { title: '', description: '' } }) as FormAnalysisResult

describe('matchFields', () => {
  it('精确匹配：fieldValues 命中 canonical_id', () => {
    const a = analysis([field({ canonical_id: 'f1' })])
    const r = matchFields(a, { f1: 'Alice' })
    expect(r.fieldsToFill).toHaveLength(1)
    expect(r.fieldsToFill[0]).toMatchObject({ canonical_id: 'f1', value: 'Alice', selector: '#name' })
    expect(r.matchedViaFuzzy).toBe(false)
    expect(r.skipped).toBe(0)
  })

  it('精确匹配忽略空字符串值', () => {
    const a = analysis([field({ canonical_id: 'f1' })])
    const r = matchFields(a, { f1: '' })
    expect(r.fieldsToFill).toHaveLength(0)
  })

  it('精确为空 + 有值 → 回退 fuzzy 命中', () => {
    // label 'User Email Address' tokens {user,email,address} vs key 'user_email' tokens {user,email} = 2/3 > 0.5
    // exact-norm 'useremailaddress' ≠ 'useremail' → 走 similarity 路径命中
    const a = analysis([field({ canonical_id: 'f1', label: 'User Email Address' })])
    const r = matchFields(a, { user_email: 'a@b.c' })
    expect(r.fieldsToFill).toHaveLength(1)
    expect(r.matchedViaFuzzy).toBe(true)
  })

  it('精确为空 + 有值 + fuzzy 也不命中 → 空，matchedViaFuzzy 仍 true（进了 fuzzy 分支）', () => {
    const a = analysis([field({ canonical_id: 'f1', label: 'Name' })])
    const r = matchFields(a, { xyz_unrelated: 'v' })
    expect(r.fieldsToFill).toHaveLength(0)
    expect(r.matchedViaFuzzy).toBe(true)
  })

  it('无任何值（valueCount===0）→ 不进 fuzzy，空结果', () => {
    const a = analysis([field({ canonical_id: 'f1' })])
    const r = matchFields(a, {})
    expect(r.fieldsToFill).toHaveLength(0)
    expect(r.matchedViaFuzzy).toBe(false)
  })

  it('skipped = 总字段 - 命中数', () => {
    const a = analysis([field({ canonical_id: 'f1' }), field({ canonical_id: 'f2', selector: '#f2' })])
    const r = matchFields(a, { f1: 'v' })
    expect(r.skipped).toBe(1)
  })
})
