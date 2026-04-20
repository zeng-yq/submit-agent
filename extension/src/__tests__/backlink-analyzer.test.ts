import { describe, it, expect } from 'vitest'
import type { FormField, FormGroup } from '@/agent/FormAnalyzer'
import { calculateConfidence } from '@/lib/backlink-analyzer'

function makeField(overrides: Partial<FormField> & { name: string }): FormField {
  const { name, id, type, label, placeholder, tagName, ...rest } = overrides
  return {
    canonical_id: `field_${Math.random()}`,
    name,
    id: id || name,
    type: type || 'text',
    label: label || '',
    placeholder: placeholder || '',
    required: false,
    maxlength: null,
    selector: `input[name="${name}"]`,
    tagName: tagName || 'input',
    ...rest,
  }
}

function makeForm(overrides: Partial<FormGroup>): FormGroup {
  return {
    form_index: 0,
    role: 'unknown',
    confidence: 'low',
    field_count: 1,
    filtered: false,
    ...overrides,
  }
}

describe('calculateConfidence', () => {
  it('无表单时信心度为 0.0', () => {
    const result = calculateConfidence({
      forms: [],
      fields: [],
      cmsType: 'unknown',
    })
    expect(result).toBe(0)
  })

  it('有未过滤表单但无关键字段时信心度为 0.2', () => {
    const result = calculateConfidence({
      forms: [makeForm({ form_index: 0, filtered: false })],
      fields: [],
      cmsType: 'unknown',
    })
    expect(result).toBe(0.2)
  })

  it('联系表单（action 含 /contact，有 textarea）信心度应低于 0.3', () => {
    const result = calculateConfidence({
      forms: [makeForm({
        form_index: 0,
        filtered: false,
        form_action: 'https://example.com/contact',
      })],
      fields: [makeField({
        name: 'body',
        tagName: 'textarea',
        label: 'Your enquiry',
      })],
      cmsType: 'unknown',
    })
    // 0.2 (form) + 0.15 (textarea) - 0.2 (contact) = 0.15
    expect(result).toBeLessThan(0.3)
  })

  it('联系表单仅有 textarea 无 comment 字段时信心度接近 0.05', () => {
    const result = calculateConfidence({
      forms: [makeForm({
        form_index: 0,
        filtered: false,
        form_action: 'https://example.com/contact',
      })],
      fields: [makeField({
        name: 'body',
        tagName: 'textarea',
        label: '',
      })],
      cmsType: 'unknown',
    })
    // 0.2 (form) + 0.15 (textarea) - 0.2 (contact) - 0.1 (onlyMessageNoComment) = 0.05
    expect(result).toBeCloseTo(0.05, 1)
  })

  it('WordPress 完整评论页信心度应 >= 0.9', () => {
    const result = calculateConfidence({
      forms: [makeForm({
        form_index: 0,
        filtered: false,
        form_action: 'https://example.com/wp-comments-post.php',
      })],
      fields: [
        makeField({ name: 'comment', tagName: 'textarea', label: 'Comment' }),
        makeField({ name: 'url', type: 'url', label: 'Website' }),
        makeField({ name: 'email', type: 'email', label: 'Email' }),
        makeField({ name: 'author', label: 'Author' }),
      ],
      cmsType: 'wordpress',
    })
    expect(result).toBeGreaterThanOrEqual(0.9)
  })

  it('简单博客评论（textarea + comment 字段）信心度约 0.55', () => {
    const result = calculateConfidence({
      forms: [makeForm({
        form_index: 0,
        filtered: false,
        form_action: 'https://example.com/post-comment',
      })],
      fields: [
        makeField({ name: 'comment', tagName: 'textarea', label: 'Comment' }),
      ],
      cmsType: 'unknown',
    })
    // 0.2 (form) + 0.15 (textarea) + 0.2 (comment field) = 0.55
    expect(result).toBeCloseTo(0.55, 1)
  })

  it('有 author 字段额外加 0.1', () => {
    const without = calculateConfidence({
      forms: [makeForm({ form_index: 0, filtered: false })],
      fields: [makeField({ name: 'comment', tagName: 'textarea', label: 'Comment' })],
      cmsType: 'unknown',
    })
    const withAuthor = calculateConfidence({
      forms: [makeForm({ form_index: 0, filtered: false })],
      fields: [
        makeField({ name: 'comment', tagName: 'textarea', label: 'Comment' }),
        makeField({ name: 'author', label: 'Author' }),
      ],
      cmsType: 'unknown',
    })
    expect(withAuthor - without).toBeCloseTo(0.1, 1)
  })

  it('信心度不低于 0', () => {
    const result = calculateConfidence({
      forms: [makeForm({
        form_index: 0,
        filtered: false,
        form_action: 'https://example.com/contact/support/help',
      })],
      fields: [],
      cmsType: 'unknown',
    })
    // 0.2 (form) - 0.2 (contact signal) = 0.0
    expect(result).toBeGreaterThanOrEqual(0)
  })

  it('信心度不超过 1', () => {
    const result = calculateConfidence({
      forms: [makeForm({
        form_index: 0,
        filtered: false,
        form_action: 'https://example.com/wp-comments-post.php',
      })],
      fields: [
        makeField({ name: 'comment', tagName: 'textarea', label: 'Comment' }),
        makeField({ name: 'url', type: 'url', label: 'Website' }),
        makeField({ name: 'email', type: 'email', label: 'Email' }),
        makeField({ name: 'author', label: 'Author' }),
        makeField({ name: 'website', type: 'url', label: 'Site' }),
      ],
      cmsType: 'wordpress',
    })
    expect(result).toBeLessThanOrEqual(1)
  })
})
