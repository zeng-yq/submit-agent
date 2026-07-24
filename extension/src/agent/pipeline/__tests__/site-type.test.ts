// src/agent/pipeline/__tests__/site-type.test.ts
import { describe, it, expect } from 'vitest'
import { SITE_TYPE_STRATEGIES, siteTypeFromCategory } from '@/agent/pipeline/site-type'

const mkCtx = (over: any = {}) => ({
	productContext: 'pc',
	pageInfo: { title: 't', description: 'd', headings: [], content_preview: '' },
	fields: [],
	forms: [],
	...over,
})

describe('SITE_TYPE_STRATEGIES', () => {
	it('blog_comment: label/temperature/autoSubmit 正确', () => {
		const s = SITE_TYPE_STRATEGIES.blog_comment
		expect(s.label).toBe('博客评论')
		expect(s.temperature).toBe(0.7)
		expect(s.autoSubmit).toBe(true)
	})

	it('directory_submit: label/temperature/autoSubmit 正确', () => {
		const s = SITE_TYPE_STRATEGIES.directory_submit
		expect(s.label).toBe('目录提交')
		expect(s.temperature).toBe(0.3)
		expect(s.autoSubmit).toBe(false)
	})

	it('blog buildUserPrompt 含 "comment form"', () => {
		const s = SITE_TYPE_STRATEGIES.blog_comment
		expect(s.buildUserPrompt({ name: 'S', submit_url: 'https://x' } as any)).toContain('comment form')
	})

	it('directory buildUserPrompt 含 "submission form"', () => {
		const s = SITE_TYPE_STRATEGIES.directory_submit
		expect(s.buildUserPrompt({ name: 'S', submit_url: 'https://x' } as any)).toContain('submission form')
	})

	it('blog buildSystemPrompt 有 pageContent → 返回非空（走 buildBlogCommentPrompt）', () => {
		const s = SITE_TYPE_STRATEGIES.blog_comment
		const prompt = s.buildSystemPrompt(mkCtx({ pageContent: { title: 'pc', description: 'd', headings: [], content_preview: '' } }))
		expect(typeof prompt).toBe('string')
		expect(prompt.length).toBeGreaterThan(0)
	})

	it('blog buildSystemPrompt 无 pageContent → 仍返回非空（回退 directory prompt）', () => {
		const s = SITE_TYPE_STRATEGIES.blog_comment
		const prompt = s.buildSystemPrompt(mkCtx())  // 无 pageContent
		expect(typeof prompt).toBe('string')
		expect(prompt.length).toBeGreaterThan(0)
	})

	it('directory buildSystemPrompt → 返回非空', () => {
		const s = SITE_TYPE_STRATEGIES.directory_submit
		const prompt = s.buildSystemPrompt(mkCtx())
		expect(prompt.length).toBeGreaterThan(0)
	})

	it('Record 完备性：每个 SiteType 都有策略', () => {
		const types: import('@/agent/types').SiteType[] = ['blog_comment', 'directory_submit']
		for (const t of types) {
			expect(SITE_TYPE_STRATEGIES[t]).toBeDefined()
		}
	})
})

describe('siteTypeFromCategory', () => {
	it('blog_comment category → blog_comment siteType', () => {
		expect(siteTypeFromCategory('blog_comment')).toBe('blog_comment')
	})
	it('其它 category（ai_directory/others）→ directory_submit', () => {
		expect(siteTypeFromCategory('ai_directory')).toBe('directory_submit')
		expect(siteTypeFromCategory('others')).toBe('directory_submit')
	})
})
