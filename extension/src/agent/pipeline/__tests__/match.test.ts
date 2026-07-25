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

  describe('单字段表单 + LLM 多值 → 取最长值填入', () => {
    // 典型 Blogger c-wiz 评论：表单只识别到 1 个评论框，但 LLM 模仿 prompt 示例
    // 返回 name/email/website/comment 多字段。取最长值（评论正文）填给唯一字段，
    // 避免把姓名/邮箱/网址填进评论框。
    const multiValues = {
      f0: 'John Smith',
      f1: 'founder@example.com',
      f2: 'https://productai.com',
      f3: '这是一条很长的评论正文，引用了文章里的具体观点并自然植入锚文本链接，长度远远超过姓名邮箱网址等短字段，所以最长值就是评论内容。',
    }

    it('单字段 textarea + LLM 4 值 → 取最长值（评论正文）填入', () => {
      const a = analysis([field({ canonical_id: 'f0', type: 'textarea', selector: '#comment' })])
      const r = matchFields(a, multiValues)
      expect(r.fieldsToFill).toHaveLength(1)
      expect(r.fieldsToFill[0]).toMatchObject({ canonical_id: 'f0', value: multiValues.f3, selector: '#comment' })
      expect(r.singleFieldLongestPick).toBe(true)
      expect(r.matchedViaFuzzy).toBe(false)
      expect(r.skipped).toBe(0)
    })

    it('单字段 input + LLM 多值 → 同样触发（不限定 textarea）', () => {
      const a = analysis([field({ canonical_id: 'f0', type: 'input', selector: '#only' })])
      const r = matchFields(a, multiValues)
      expect(r.fieldsToFill).toHaveLength(1)
      expect(r.fieldsToFill[0].value).toBe(multiValues.f3)
      expect(r.singleFieldLongestPick).toBe(true)
    })

    it('单字段 + LLM 仅 1 值 → 不触发，走原精确匹配', () => {
      const a = analysis([field({ canonical_id: 'f0', type: 'textarea', selector: '#comment' })])
      const r = matchFields(a, { f0: 'only value' })
      expect(r.singleFieldLongestPick).toBeUndefined()
      expect(r.fieldsToFill).toHaveLength(1)
      expect(r.fieldsToFill[0].value).toBe('only value')
    })

    it('多字段 + LLM 多值 → 不触发，走原逻辑', () => {
      const a = analysis([
        field({ canonical_id: 'f0', selector: '#a' }),
        field({ canonical_id: 'f1', selector: '#b' }),
      ])
      const r = matchFields(a, multiValues)
      expect(r.singleFieldLongestPick).toBeUndefined()
    })

    it('单字段 + LLM 多值但全为空 → pickLongestValue 返回 null，落原逻辑', () => {
      const a = analysis([field({ canonical_id: 'f0', type: 'textarea', selector: '#comment' })])
      const r = matchFields(a, { f0: '', f1: '' })
      expect(r.singleFieldLongestPick).toBeUndefined()
      // 原逻辑：精确匹配（空）→ 进 fuzzy 分支
      expect(r.matchedViaFuzzy).toBe(true)
    })
  })
})
