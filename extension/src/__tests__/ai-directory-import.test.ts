import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { importAiDirectoryFromCsv } from '@/lib/sites'
import { bulkPutSites, clearSites, getSiteByDomain } from '@/lib/db'
import type { SiteRecord } from '@/lib/types'

describe('importAiDirectoryFromCsv', () => {
	beforeEach(async () => {
		await clearSites()
	})

	it('新建：domain 不存在 → 插入 ai_directory 站点（dr=null、默认未提交、字段正确）', async () => {
		const csv = '名称,url,价格,需要登录\nProduct Hunt,https://producthunt.com/,免费,是\n'
		const result = await importAiDirectoryFromCsv(csv)
		expect(result.imported).toBe(1)
		expect(result.updated).toBe(0)

		const site = await getSiteByDomain('producthunt.com')
		expect(site).toBeDefined()
		expect(site!.category).toBe('ai_directory')
		expect(site!.dr).toBeNull()
		expect(site!.pricing_type).toBe('free')
		expect(site!.requires_login).toBe(true)
		expect(site!.submit_url).toBe('https://producthunt.com/')
	})

	it('价格/登录中文映射：混合→mixed、否→false', async () => {
		const csv = '名称,url,价格,需要登录\nGoodFirms,https://goodfirms.co/,混合,否\n'
		await importAiDirectoryFromCsv(csv)
		const site = await getSiteByDomain('goodfirms.co')
		expect(site!.pricing_type).toBe('mixed')
		expect(site!.requires_login).toBe(false)
	})

	it('更新去重：domain 已存在 → 仅补两字段，保留原分类/dr/pricing/notes', async () => {
		const existing: SiteRecord = {
			name: 'Product Hunt',
			submit_url: 'https://producthunt.com/old',
			domain: 'producthunt.com',
			category: 'blog_comment',
			dr: 90,
			pricing: 'Free',
			notes: 'keep me',
			createdAt: 1000,
			updatedAt: 1000,
		}
		await bulkPutSites([existing])

		const csv = '名称,url,价格,需要登录\nProduct Hunt,https://producthunt.com/,付费,是\n'
		const result = await importAiDirectoryFromCsv(csv)
		expect(result.updated).toBe(1)
		expect(result.imported).toBe(0)

		const site = await getSiteByDomain('producthunt.com')
		expect(site!.category).toBe('blog_comment')   // 原分类保留
		expect(site!.dr).toBe(90)                       // 原 dr 保留
		expect(site!.pricing).toBe('Free')              // 原 pricing 文本保留
		expect(site!.notes).toBe('keep me')             // 原 notes 保留
		expect(site!.pricing_type).toBe('paid')         // 新字段补充
		expect(site!.requires_login).toBe(true)         // 新字段补充
	})

	it('同 domain 多行：首行新建，后续行更新（按 domain 去重）', async () => {
		const csv = [
			'名称,url,价格,需要登录',
			'Site One,https://example.com/a,免费,是',
			'Site Two,https://example.com/b,付费,否',
		].join('\n')
		const result = await importAiDirectoryFromCsv(csv)
		expect(result.imported).toBe(1)
		expect(result.updated).toBe(1)
		const site = await getSiteByDomain('example.com')
		expect(site!.pricing_type).toBe('paid')        // 被第二行更新
		expect(site!.requires_login).toBe(false)
	})

	it('空 url 行被跳过', async () => {
		const csv = '名称,url,价格,需要登录\n,,免费,是\nReal,https://realsite.com/,免费,否\n'
		const result = await importAiDirectoryFromCsv(csv)
		expect(result.imported).toBe(1)
		expect(result.skipped).toBe(1)
	})

	it('非标准价格/登录值 → 对应字段 undefined', async () => {
		const csv = '名称,url,价格,需要登录\nWeird,https://weird.com/,unknown,maybe\n'
		await importAiDirectoryFromCsv(csv)
		const site = await getSiteByDomain('weird.com')
		expect(site!.pricing_type).toBeUndefined()
		expect(site!.requires_login).toBeUndefined()
	})
})
