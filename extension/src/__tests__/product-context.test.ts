import { describe, it, expect } from 'vitest'
import { buildProductContext, pickAnchorText } from '@/agent/prompts/product-context'
import type { ProductProfile } from '@/lib/types'

const mockProduct: ProductProfile = {
  id: 'test-1',
  name: 'ProductAI',
  url: 'https://productai.com',
  description: 'AI-powered optimization platform.',
  anchorTexts: 'AI optimization tools, model compression workflows',
  founderName: 'John Smith',
  founderEmail: 'john@productai.com',
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
