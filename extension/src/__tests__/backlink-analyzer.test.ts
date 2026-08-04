import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { FormField, FormGroup } from '@/agent/FormAnalyzer'
import { calculateConfidence, analyzeBacklink } from '@/lib/backlink-analyzer'
import type { FormAnalysisResult } from '@/agent/FormAnalyzer'

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

  describe('评论外链信号', () => {
    it('hasCommentExternalLinks 为 true 时 confidence 加 0.25', () => {
      const without = calculateConfidence({
        forms: [],
        fields: [],
        cmsType: 'unknown',
      })
      const withLinks = calculateConfidence({
        forms: [],
        fields: [],
        cmsType: 'unknown',
        hasCommentExternalLinks: true,
      })
      expect(withLinks - without).toBeCloseTo(0.25, 1)
    })

    it('hasCommentExternalLinks 为 false 时不影响 confidence', () => {
      const without = calculateConfidence({
        forms: [],
        fields: [],
        cmsType: 'unknown',
      })
      const withFalse = calculateConfidence({
        forms: [],
        fields: [],
        cmsType: 'unknown',
        hasCommentExternalLinks: false,
      })
      expect(withFalse).toBe(without)
    })

    it('hasCommentExternalLinks 与表单信号叠加', () => {
      const result = calculateConfidence({
        forms: [makeForm({ form_index: 0, filtered: false })],
        fields: [makeField({ name: 'comment', tagName: 'textarea', label: 'Comment' })],
        cmsType: 'unknown',
        hasCommentExternalLinks: true,
      })
      // 0.2 (form) + 0.15 (textarea) + 0.2 (comment) + 0.25 (commentLinks) = 0.8
      expect(result).toBeCloseTo(0.8, 1)
    })
  })
})

describe('评论系统信号', () => {
  it('commentSystem 为 disqus 时 confidence 加 0.20', () => {
    const without = calculateConfidence({
      forms: [],
      fields: [],
      cmsType: 'unknown',
    })
    const withSystem = calculateConfidence({
      forms: [],
      fields: [],
      cmsType: 'unknown',
      commentSystem: 'disqus',
    })
    expect(withSystem - without).toBeCloseTo(0.20, 1)
  })

  it('commentSystem 为 unknown 时不影响 confidence', () => {
    const without = calculateConfidence({
      forms: [],
      fields: [],
      cmsType: 'unknown',
    })
    const withUnknown = calculateConfidence({
      forms: [],
      fields: [],
      cmsType: 'unknown',
      commentSystem: 'unknown',
    })
    expect(withUnknown).toBe(without)
  })

  it('commentSystem 与其他信号叠加', () => {
    const result = calculateConfidence({
      forms: [makeForm({ form_index: 0, filtered: false })],
      fields: [makeField({ name: 'comment', tagName: 'textarea', label: 'Comment' })],
      cmsType: 'wordpress',
      commentSystem: 'disqus',
    })
    // 0.2(form) + 0.15(textarea) + 0.2(comment) + 0.15(cms) + 0.2(commentSystem) = 0.9
    expect(result).toBeCloseTo(0.9, 1)
  })
})

// analyzeBacklink 的 chrome.runtime.sendMessage mock
function mockFetchPageContent(analysis: FormAnalysisResult) {
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: vi.fn().mockResolvedValue({ ok: true, analysis }),
    },
  })
}

describe('analyzeBacklink - 联系表单页面过滤', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('纯联系表单页面（web3forms action + phone/subject，无评论信号）→ canComment=false', async () => {
    // 该字段组合原本会被判 canComment=true（有未过滤表单 + textarea），
    // 但因命中 isContactOnlyPage 应被过滤为不可发布。
    const analysis: FormAnalysisResult = {
      fields: [
        makeField({ name: 'name' }),
        makeField({ name: 'email', type: 'email' }),
        makeField({ name: 'subject' }),
        makeField({ name: 'phone', type: 'tel' }),
        makeField({ name: 'message', tagName: 'textarea', placeholder: 'Your message' }),
      ],
      forms: [makeForm({
        form_index: 0,
        filtered: false,
        form_action: 'https://api.web3forms.com/submit',
      })],
      page_info: { title: 'Contact Us', description: '', headings: [], content_preview: '' },
      commentLinks: { hasExternalLinks: false, uniqueDomains: 0, totalLinks: 0 },
    }
    mockFetchPageContent(analysis)

    const result = await analyzeBacklink({ url: 'https://example.com/contact' })
    expect(result.canComment).toBe(false)
    expect(result.formType).toBe('none')
    expect(result.summary).toContain('联系表单')
  })

  it('页面同时有评论系统 → 不当联系页过滤（仍可发布）', async () => {
    // web3forms action 但页面挂了 wordpress 评论系统 → isContactOnlyPage=false
    const analysis: FormAnalysisResult = {
      fields: [
        makeField({ name: 'comment', tagName: 'textarea', label: 'Comment' }),
      ],
      forms: [makeForm({
        form_index: 0,
        filtered: false,
        form_action: 'https://api.web3forms.com/submit',
      })],
      page_info: { title: 'Post', description: '', headings: [], content_preview: '' },
      commentLinks: { hasExternalLinks: false, uniqueDomains: 0, totalLinks: 0 },
      commentSystem: { name: 'wordpress', boost: 1 },
    }
    mockFetchPageContent(analysis)

    const result = await analyzeBacklink({ url: 'https://example.com/post' })
    expect(result.canComment).toBe(true)
  })

  it('普通博客评论页（wp-comments-post.php）→ 不被误过滤', async () => {
    const analysis: FormAnalysisResult = {
      fields: [
        makeField({ name: 'comment', tagName: 'textarea', label: 'Comment' }),
        makeField({ name: 'author' }),
      ],
      forms: [makeForm({
        form_index: 0,
        filtered: false,
        form_action: 'https://example.com/wp-comments-post.php',
      })],
      page_info: { title: 'Blog Post', description: '', headings: [], content_preview: '' },
      commentLinks: { hasExternalLinks: false, uniqueDomains: 0, totalLinks: 0 },
    }
    mockFetchPageContent(analysis)

    const result = await analyzeBacklink({ url: 'https://example.com/post' })
    expect(result.canComment).toBe(true)
    expect(result.cmsType).toBe('wordpress')
  })
})

