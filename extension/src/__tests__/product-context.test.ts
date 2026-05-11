import { describe, it, expect } from 'vitest'
import { buildProductContext, pickAnchorText, pickFounderName } from '@/agent/prompts/product-context'
import type { ProductProfile } from '@/lib/types'

const mockProduct: ProductProfile = {
  id: 'test-1',
  name: 'ProductAI',
  url: 'https://productai.com',
  description: 'AI-powered optimization platform.',
  anchorTexts: 'AI optimization tools, model compression workflows',
  founderName: 'John Smith',
  founderEmail: 'john@productai.com',
  createdAt: Date.now(),
  updatedAt: Date.now(),
}

describe('buildProductContext', () => {
  it('contains anchor text language requirement when anchor is selected', () => {
    const result = buildProductContext(mockProduct, 'AI optimization tools')
    expect(result).toContain('锚文本语种要求')
    expect(result).toContain('翻译为页面语种')
  })

  it('does not contain language requirement when no anchor is selected', () => {
    const result = buildProductContext(mockProduct)
    expect(result).not.toContain('锚文本语种要求')
  })

  it('injects selected founder name when provided', () => {
    const product = { ...mockProduct, founderName: '张三, 李四' }
    const result = buildProductContext(product, 'AI optimization tools', '张三')
    expect(result).toContain('**创始人姓名:** 张三')
    expect(result).not.toContain('张三, 李四')
  })

  it('omits founder name when selectedFounderName is empty', () => {
    const product = { ...mockProduct, founderName: '张三' }
    const result = buildProductContext(product, undefined, '')
    expect(result).not.toContain('创始人姓名')
  })
})

describe('pickAnchorText', () => {
  it('returns product name when anchorTexts is empty', () => {
    const product = { ...mockProduct, anchorTexts: '' }
    expect(pickAnchorText(product)).toBe('ProductAI')
  })

  it('returns one of the anchor texts', () => {
    const result = pickAnchorText(mockProduct)
    expect(['AI optimization tools', 'model compression workflows']).toContain(result)
  })
})

describe('pickFounderName', () => {
  it('returns empty string when founderName is empty', () => {
    const product = { ...mockProduct, founderName: '' }
    expect(pickFounderName(product)).toBe('')
  })

  it('returns the single name when only one is provided', () => {
    const product = { ...mockProduct, founderName: '张三' }
    expect(pickFounderName(product)).toBe('张三')
  })

  it('returns one of the names from comma-separated list', () => {
    const product = { ...mockProduct, founderName: '张三, John Doe, 李四' }
    const result = pickFounderName(product)
    expect(['张三', 'John Doe', '李四']).toContain(result)
  })

  it('trims whitespace around names', () => {
    const product = { ...mockProduct, founderName: '  Alice  ,  Bob  ,  Charlie  ' }
    const result = pickFounderName(product)
    expect(['Alice', 'Bob', 'Charlie']).toContain(result)
  })
})
