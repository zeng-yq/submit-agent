import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import {
	saveProduct,
	saveSubmission,
	listSubmissionsByProduct,
	listSubmissionsByProductGroup,
	bulkPutProducts,
	bulkPutSubmissions,
} from '@/lib/db'
import { mergeSubmissionsBySite, groupProductsByDomain } from '@/lib/submissions'
import type { ProductProfile, SubmissionRecord } from '@/lib/types'

const now = () => Date.now()

/** 构造一个产品（仅填分组用到的字段，其余置默认值） */
function productOf(id: string, url: string, updatedAt: number, name = id): ProductProfile {
	return {
		id,
		name,
		url,
		description: '',
		anchorTexts: '',
		founderName: '',
		founderEmail: '',
		createdAt: updatedAt,
		updatedAt,
	}
}

async function makeProduct(name: string, url: string): Promise<ProductProfile> {
	return saveProduct({
		name,
		url,
		description: 'desc',
		anchorTexts: 'a,b',
		founderName: 'Tom',
		founderEmail: 'tom@example.com',
	})
}

function subOf(
	productId: string,
	siteName: string,
	status: SubmissionRecord['status'],
	extra: Partial<SubmissionRecord> = {}
): Omit<SubmissionRecord, 'id' | 'createdAt' | 'updatedAt'> {
	return { siteName, productId, status, ...extra }
}

describe('listSubmissionsByProductGroup', () => {
	beforeEach(async () => {
		// fake-indexeddb 在 auto 模式下跨用例复用同一个内存库，
		// 显式清空两个 store，保证用例隔离。
		await bulkPutProducts([])
		await bulkPutSubmissions([])
	})

	it('聚合同域名所有产品的提交记录，排除异域名产品', async () => {
		const a1 = await makeProduct('A1', 'https://a.com/blog')
		const a2 = await makeProduct('A2', 'https://a.com/product')
		const b1 = await makeProduct('B1', 'https://b.com/landing')

		await saveSubmission(subOf(a1.id, 'SiteX', 'submitted'))
		await saveSubmission(subOf(a2.id, 'SiteY', 'failed'))
		await saveSubmission(subOf(b1.id, 'SiteZ', 'submitted'))

		const groupFromA1 = await listSubmissionsByProductGroup(a1.id)
		const groupFromA2 = await listSubmissionsByProductGroup(a2.id)
		const groupFromB1 = await listSubmissionsByProductGroup(b1.id)

		const namesFromA1 = groupFromA1.map((s) => s.siteName).sort()
		const namesFromA2 = groupFromA2.map((s) => s.siteName).sort()

		// A 组（a1、a2）相互可见对方的提交，但不可见 b 组
		expect(namesFromA1).toEqual(['SiteX', 'SiteY'])
		expect(namesFromA2).toEqual(['SiteX', 'SiteY'])
		expect(groupFromB1.map((s) => s.siteName)).toEqual(['SiteZ'])
	})

	it('www 子域与裸域名视为同一组（extractDomain 已去除 www 前缀）', async () => {
		const w = await makeProduct('W', 'https://www.a.com/page')
		const bare = await makeProduct('Bare', 'https://a.com/other')

		await saveSubmission(subOf(w.id, 'SiteX', 'submitted'))

		const group = await listSubmissionsByProductGroup(bare.id)
		expect(group.map((s) => s.siteName)).toEqual(['SiteX'])
	})

	it('单产品（无同域名伙伴）退化为等价于 listSubmissionsByProduct', async () => {
		const solo = await makeProduct('Solo', 'https://solo.com/')

		await saveSubmission(subOf(solo.id, 'SiteA', 'submitted'))
		await saveSubmission(subOf(solo.id, 'SiteB', 'failed'))

		const byGroup = await listSubmissionsByProductGroup(solo.id)
		const byProduct = await listSubmissionsByProduct(solo.id)

		expect(byGroup.length).toBe(byProduct.length)
		expect(byGroup.map((s) => s.siteName).sort()).toEqual(
			byProduct.map((s) => s.siteName).sort()
		)
	})

	it('产品无 url / url 无效 → 返回空数组', async () => {
		const noUrl = await saveProduct({
			name: 'NoUrl',
			url: '',
			description: '',
			anchorTexts: '',
			founderName: '',
			founderEmail: '',
		})
		const badUrl = await saveProduct({
			name: 'BadUrl',
			url: 'not-a-url',
			description: '',
			anchorTexts: '',
			founderName: '',
			founderEmail: '',
		})

		expect(await listSubmissionsByProductGroup(noUrl.id)).toEqual([])
		expect(await listSubmissionsByProductGroup(badUrl.id)).toEqual([])
	})

	it('productId 不存在 → 返回空数组', async () => {
		expect(await listSubmissionsByProductGroup('non-existent-id')).toEqual([])
	})

	it('端到端去重场景：A 已提交站点 X，B（同域名）查询应看到 X', async () => {
		// 模拟用户诉求的核心场景：同一网站的两个页面分别建了产品
		const productA = await makeProduct('Page A', 'https://example.com/blog')
		const productB = await makeProduct('Page B', 'https://example.com/product')

		// 用产品 A 提交站点 X 成功
		await saveSubmission(subOf(productA.id, 'BacklinkSiteX', 'submitted'))

		// 切到产品 B 查询：应能感知到站点 X 已被本网站提交过
		const groupForB = await listSubmissionsByProductGroup(productB.id)
		const siteNames = groupForB.map((s) => s.siteName)
		expect(siteNames).toContain('BacklinkSiteX')
	})
})

describe('mergeSubmissionsBySite', () => {
	const base = (over: Partial<SubmissionRecord>): SubmissionRecord => ({
		id: 'rid-' + Math.random(),
		siteName: 'SiteX',
		productId: 'p1',
		status: 'not_started',
		createdAt: now(),
		updatedAt: now(),
		...over,
	})

	it('同 siteName 多条记录只保留最强状态（submitted > failed）', () => {
		const records = [
			base({ productId: 'p1', status: 'failed', error: 'timeout' }),
			base({ productId: 'p2', status: 'submitted' }),
		]
		const merged = mergeSubmissionsBySite(records)
		expect(merged.size).toBe(1)
		expect(merged.get('SiteX')?.status).toBe('submitted')
	})

	it('not_started 与 failed 合并 → 保留 failed（更强状态）', () => {
		const records = [
			base({ productId: 'p1', status: 'not_started' }),
			base({ productId: 'p2', status: 'failed' }),
		]
		const merged = mergeSubmissionsBySite(records)
		expect(merged.get('SiteX')?.status).toBe('failed')
	})

	it('不同 siteName 各自独立保留', () => {
		const records = [
			base({ siteName: 'X', status: 'submitted' }),
			base({ siteName: 'Y', status: 'failed' }),
		]
		const merged = mergeSubmissionsBySite(records)
		expect(merged.size).toBe(2)
		expect(merged.get('X')?.status).toBe('submitted')
		expect(merged.get('Y')?.status).toBe('failed')
	})

	it('approved 优先级最高（approved > submitted）', () => {
		const records = [
			base({ status: 'submitted' }),
			base({ status: 'approved' }),
		]
		const merged = mergeSubmissionsBySite(records)
		expect(merged.get('SiteX')?.status).toBe('approved')
	})

	it('空数组 → 空 Map', () => {
		expect(mergeSubmissionsBySite([]).size).toBe(0)
	})
})

describe('groupProductsByDomain', () => {
	it('同域名产品归为一组，不同域名各自成组', () => {
		// 入参按 updatedAt 倒序（listProducts 的真实返回顺序）
		const products = [
			productOf('a1', 'https://a.com/blog', 300),
			productOf('b1', 'https://b.com/', 200),
			productOf('a2', 'https://a.com/product', 100),
		]
		const groups = groupProductsByDomain(products)

		expect(groups.length).toBe(2)
		// 组顺序按组内最新 updatedAt 倒序：a 组(300) 在前，b 组(200) 在后
		expect(groups[0].domain).toBe('a.com')
		expect(groups[0].products.map((p) => p.id)).toEqual(['a1', 'a2'])
		expect(groups[1].domain).toBe('b.com')
		expect(groups[1].products.map((p) => p.id)).toEqual(['b1'])
	})

	it('www 子域与裸域名归为同一组', () => {
		const products = [
			productOf('w', 'https://www.a.com/x', 200),
			productOf('bare', 'https://a.com/y', 100),
		]
		const groups = groupProductsByDomain(products)

		expect(groups.length).toBe(1)
		expect(groups[0].domain).toBe('a.com')
		expect(groups[0].products.map((p) => p.id)).toEqual(['w', 'bare'])
	})

	it('组内顺序按 updatedAt 倒序', () => {
		const products = [
			productOf('old', 'https://a.com/old', 100),
			productOf('new', 'https://a.com/new', 500),
			productOf('mid', 'https://a.com/mid', 300),
		]
		const groups = groupProductsByDomain(products)

		expect(groups.length).toBe(1)
		expect(groups[0].products.map((p) => p.id)).toEqual(['new', 'mid', 'old'])
	})

	it('无 url / url 无效的产品各自独立成组（不互相聚合），排在最后', () => {
		const products = [
			productOf('noUrl', '', 100),
			productOf('badUrl', 'not-a-url', 50),
			productOf('ok', 'https://a.com/', 80),
		]
		const groups = groupProductsByDomain(products)

		// 有效域名组排第一，两个无 url 产品各自独立成组
		expect(groups.length).toBe(3)
		expect(groups[0].domain).toBe('a.com')
		// 后两组 domain 为空、各自单独
		expect(groups[1].domain).toBe('')
		expect(groups[1].products.length).toBe(1)
		expect(groups[2].domain).toBe('')
		expect(groups[2].products.length).toBe(1)
		expect(groups[1].key).not.toBe(groups[2].key)
	})

	it('空数组 → 空数组', () => {
		expect(groupProductsByDomain([])).toEqual([])
	})

	it('单个产品 → 单组', () => {
		const groups = groupProductsByDomain([productOf('solo', 'https://solo.com/', 100)])
		expect(groups.length).toBe(1)
		expect(groups[0].domain).toBe('solo.com')
		expect(groups[0].products.length).toBe(1)
	})
})
