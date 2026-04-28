import { describe, it, expect } from 'vitest'
import { buildBlogCommentPrompt } from '@/agent/prompts/blog-comment-prompt'
import type { PageContent } from '@/agent/PageContentExtractor'
import type { FormField, FormGroup } from '@/agent/FormAnalyzer'

const mockPageContent: PageContent = {
  title: 'How to Scale AI Inference',
  description: 'A deep dive into scaling strategies.',
  headings: ['# Introduction', '## Latency Benchmarks'],
  content_preview: 'When deploying AI models at scale, latency becomes the bottleneck...',
}

const mockFields: FormField[] = [
  {
    canonical_id: 'field_0',
    id: 'author',
    tagName: 'input',
    type: 'text',
    effective_type: 'text',
    label: 'Name',
    name: 'author',
    placeholder: 'Your name',
    inferred_purpose: 'name',
    required: true,
    maxlength: null,
    form_index: 0,
    selector: '#author',
  },
  {
    canonical_id: 'field_1',
    id: 'email',
    tagName: 'input',
    type: 'email',
    effective_type: 'email',
    label: 'Email',
    name: 'email',
    placeholder: '',
    inferred_purpose: 'email',
    required: true,
    maxlength: null,
    form_index: 0,
    selector: '#email',
  },
  {
    canonical_id: 'field_2',
    id: 'url',
    tagName: 'input',
    type: 'text',
    effective_type: 'text',
    label: 'Website',
    name: 'url',
    placeholder: '',
    inferred_purpose: 'url',
    required: false,
    maxlength: null,
    form_index: 0,
    selector: '#url',
  },
  {
    canonical_id: 'field_3',
    id: 'comment',
    tagName: 'textarea',
    type: 'textarea',
    effective_type: 'textarea',
    label: 'Comment',
    name: 'comment',
    placeholder: 'Write your comment...',
    inferred_purpose: 'comment',
    required: true,
    maxlength: null,
    form_index: 0,
    selector: '#comment',
  },
]

const mockForms: FormGroup[] = [
  {
    form_index: 0,
    form_id: 'commentform',
    form_action: '/wp-comments-post.php',
    role: 'unknown',
    confidence: 'high',
    field_count: 4,
    filtered: false,
  },
]

const productContext = `## 产品信息

**名称:** ProductAI
**URL:** https://productai.com

### 产品描述
AI-powered optimization platform.

**锚文本列表:** AI optimization tools, model compression workflows
**本次使用的锚文本:** AI optimization tools`

describe('buildBlogCommentPrompt', () => {
  it('returns a non-empty string', () => {
    const prompt = buildBlogCommentPrompt({
      productContext,
      pageContent: mockPageContent,
      fields: mockFields,
      forms: mockForms,
    })
    expect(typeof prompt).toBe('string')
    expect(prompt.length).toBeGreaterThan(100)
  })

  it('contains product context', () => {
    const prompt = buildBlogCommentPrompt({
      productContext,
      pageContent: mockPageContent,
      fields: mockFields,
      forms: mockForms,
    })
    expect(prompt).toContain('ProductAI')
    expect(prompt).toContain('https://productai.com')
    expect(prompt).toContain('AI optimization tools')
  })

  it('contains page content', () => {
    const prompt = buildBlogCommentPrompt({
      productContext,
      pageContent: mockPageContent,
      fields: mockFields,
      forms: mockForms,
    })
    expect(prompt).toContain('How to Scale AI Inference')
    expect(prompt).toContain('When deploying AI models at scale')
  })

  it('contains form fields', () => {
    const prompt = buildBlogCommentPrompt({
      productContext,
      pageContent: mockPageContent,
      fields: mockFields,
      forms: mockForms,
    })
    expect(prompt).toContain('field_0')
    expect(prompt).toContain('field_3')
    expect(prompt).toContain('Name')
    expect(prompt).toContain('Comment')
  })

  it('includes the new rule about always embedding HTML link in comment body', () => {
    const prompt = buildBlogCommentPrompt({
      productContext,
      pageContent: mockPageContent,
      fields: mockFields,
      forms: mockForms,
    })
    expect(prompt).toContain('HTML 链接')
    expect(prompt).not.toContain('dofollow')
  })

  it('includes the rule about random English name for name field', () => {
    const prompt = buildBlogCommentPrompt({
      productContext,
      pageContent: mockPageContent,
      fields: mockFields,
      forms: mockForms,
    })
    expect(prompt).toContain('英文姓名')
    expect(prompt).toContain('name/author')
  })

  it('does NOT contain the old link placement priority text', () => {
    const prompt = buildBlogCommentPrompt({
      productContext,
      pageContent: mockPageContent,
      fields: mockFields,
      forms: mockForms,
    })
    expect(prompt).not.toContain('链接放置优先级')
    expect(prompt).not.toContain('首选')
    expect(prompt).not.toContain('次选')
  })

  it('includes example with HTML link in comment body', () => {
    const prompt = buildBlogCommentPrompt({
      productContext,
      pageContent: mockPageContent,
      fields: mockFields,
      forms: mockForms,
    })
    expect(prompt).toMatch(/<a href=.*>.*<\/a>/)
  })

  it('includes example with English name (not product name) in name field', () => {
    const prompt = buildBlogCommentPrompt({
      productContext,
      pageContent: mockPageContent,
      fields: mockFields,
      forms: mockForms,
    })
    expect(prompt).not.toMatch(/"field_0":\s*"ProductAI"/)
  })

  it('contains mandatory HTML link requirements section', () => {
    const prompt = buildBlogCommentPrompt({
      productContext,
      pageContent: mockPageContent,
      fields: mockFields,
      forms: mockForms,
    })
    expect(prompt).toContain('硬性要求')
    expect(prompt).toContain('必须包含一个 HTML 锚标签')
    expect(prompt).toContain('绝对不能将锚文本作为纯文本输出')
  })

  it('contains wrong example showing plain text without link', () => {
    const prompt = buildBlogCommentPrompt({
      productContext,
      pageContent: mockPageContent,
      fields: mockFields,
      forms: mockForms,
    })
    expect(prompt).toContain('错误示范')
    expect(prompt).toContain('纯文本，无链接')
  })

  it('contains correct example showing HTML anchor tag', () => {
    const prompt = buildBlogCommentPrompt({
      productContext,
      pageContent: mockPageContent,
      fields: mockFields,
      forms: mockForms,
    })
    expect(prompt).toContain('正确示范')
    expect(prompt).toMatch(/正确示范.*<a href=/)
  })
})
