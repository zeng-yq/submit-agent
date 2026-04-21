import { describe, it, expect } from 'vitest'
import { getCategoryLabel, SITE_CATEGORIES } from '@/lib/types'

describe('getCategoryLabel', () => {
  it('returns label for known categories', () => {
    expect(getCategoryLabel('blog_comment')).toBe('博客评论')
    expect(getCategoryLabel('ai_directory')).toBe('AI 目录')
    expect(getCategoryLabel('others')).toBe('其他')
  })

  it('returns raw value for unknown categories', () => {
    expect(getCategoryLabel('Non-Blog Comment')).toBe('Non-Blog Comment')
  })

  it('SITE_CATEGORIES has exactly 3 entries', () => {
    expect(SITE_CATEGORIES).toHaveLength(3)
  })
})
