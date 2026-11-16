import 'fake-indexeddb/auto'
import { describe, it, expect, vi } from 'vitest'
import { addProduct, type AddProductDeps } from '@/lib/add-product'
import { getProductByDomain } from '@/lib/db'
import type { LLMSettings } from '@/lib/types'

const validConfig: LLMSettings = {
	apiKey: 'sk-test',
	baseUrl: 'https://api.deepseek.com/v1',
	model: 'deepseek-v4-flash',
}

function makeHomepageHtml(opts: {
	siteName?: string
	title?: string
	ogImage?: string
	icon?: string
	bodyText?: string
}): string {
	return `<!doctype html>
<html>
<head>
	${opts.siteName ? `<meta property="og:site_name" content="${opts.siteName}">` : ''}
	${opts.ogImage ? `<meta property="og:image" content="${opts.ogImage}">` : ''}
	${opts.title ? `<title>${opts.title}</title>` : ''}
	${opts.icon ? `<link rel="icon" href="${opts.icon}">` : ''}
</head>
<body>
	<main>${opts.bodyText ?? 'A tool that helps teams ship faster with automation and clean analytics.'}</main>
</body>
</html>`
}

function makeDeps(html: string, overrides: Partial<AddProductDeps> = {}): AddProductDeps {
	return {
		llmConfig: validConfig,
		fetchHomepageHtml: vi.fn().mockResolvedValue(html),
		fetchImageAsDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,AAA'),
		callLLM: vi.fn().mockResolvedValue('ExampleFlow is a workflow automation tool for small teams.'),
		generateId: () => 'product-id-1',
		now: () => 1_700_000_000_000,
		...overrides,
	}
}

describe('addProduct · happy path', () => {
	it('规范化域名、解析基本信息、生成产品分析并按规格入库', async () => {
		const html = makeHomepageHtml({
			siteName: 'ExampleFlow',
			ogImage: 'https://example.com/og-cover.png',
			icon: '/favicon-96.png',
		})
		const deps = makeDeps(html)

		const product = await addProduct('https://www.Example.com/pricing?ref=x', deps)

		// 域名规范化：去协议/路径/www、小写
		expect(product.domain).toBe('example.com')
		expect(product.url).toBe('https://example.com')
		expect(product.name).toBe('ExampleFlow')
		expect(product.email).toBe('support@example.com')
		expect(product.logoDataUrl).toBe('data:image/png;base64,AAA')
		expect(product.ogDataUrl).toBe('data:image/png;base64,AAA')
		expect(product.analysis).toBe('ExampleFlow is a workflow automation tool for small teams.')
		expect(product.id).toBe('product-id-1')
		expect(product.createdAt).toBe(1_700_000_000_000)
		expect(product.updatedAt).toBe(1_700_000_000_000)

		// 首页抓取使用规范化后的 URL
		expect(deps.fetchHomepageHtml).toHaveBeenCalledWith('https://example.com')

		// 相对路径图标被解析为绝对 URL 后再抓取
		expect(deps.fetchImageAsDataUrl).toHaveBeenCalledWith('https://example.com/favicon-96.png')
		expect(deps.fetchImageAsDataUrl).toHaveBeenCalledWith('https://example.com/og-cover.png')

		// 真实入库（fake-indexeddb）
		const stored = await getProductByDomain('example.com')
		expect(stored?.id).toBe('product-id-1')
	})
})

describe('addProduct · Fail Fast 守卫', () => {
	it('未配置 API Key：抛出引导设置的错误，且不发起任何抓取', async () => {
		const deps = makeDeps(makeHomepageHtml({}), {
			llmConfig: { ...validConfig, apiKey: '' },
		})

		await expect(addProduct('example.com', deps)).rejects.toThrow('未配置 DeepSeek API Key')
		expect(deps.fetchHomepageHtml).not.toHaveBeenCalled()
		expect(deps.callLLM).not.toHaveBeenCalled()
	})

	it('非法域名：抛出含原始输入的错误', async () => {
		const deps = makeDeps(makeHomepageHtml({}))
		await expect(addProduct('not a domain', deps)).rejects.toThrow('无法从输入解析出域名: "not a domain"')
	})

	it('域名已存在：抛出含域名的错误，不覆盖既有记录', async () => {
		const deps = makeDeps(makeHomepageHtml({ siteName: 'First' }), {
			generateId: () => 'product-dup-1',
		})
		await addProduct('dup-check.com', deps)

		const deps2 = makeDeps(makeHomepageHtml({ siteName: 'Second' }), {
			generateId: () => 'product-dup-2',
		})
		await expect(addProduct('https://www.dup-check.com/', deps2)).rejects.toThrow(
			'该域名已存在产品记录: dup-check.com',
		)

		const stored = await getProductByDomain('dup-check.com')
		expect(stored?.name).toBe('First')
	})
})

describe('addProduct · 缺失回退', () => {
	it('首页无 og:image、图片抓取失败：对应字段留空，网站名回退域名，流程不被阻断', async () => {
		const html = makeHomepageHtml({ title: undefined, siteName: undefined, ogImage: undefined, icon: undefined })
		const deps = makeDeps(html, {
			fetchImageAsDataUrl: vi.fn().mockResolvedValue(undefined),
		})

		const product = await addProduct('fallback.dev', deps)

		expect(product.name).toBe('fallback.dev')
		expect(product.logoDataUrl).toBeUndefined()
		expect(product.ogDataUrl).toBeUndefined()
		// 仅 logo（默认 /favicon.ico 绝对化）被尝试抓取，og 不存在则不调用
		expect(deps.fetchImageAsDataUrl).toHaveBeenCalledTimes(1)
		expect(deps.fetchImageAsDataUrl).toHaveBeenCalledWith('https://fallback.dev/favicon.ico')
	})

	it('产品分析提示词包含域名与首页正文', async () => {
		const html = makeHomepageHtml({ bodyText: 'Ship landing pages 10x faster with AI copy variants.' })
		const deps = makeDeps(html)

		await addProduct('promptcheck.io', deps)

		const { systemPrompt, userPrompt } = (deps.callLLM as ReturnType<typeof vi.fn>).mock.calls[0][0]
		expect(systemPrompt).toContain('product analyst')
		expect(userPrompt).toContain('promptcheck.io')
		expect(userPrompt).toContain('AI copy variants')
	})

	it('首页抓取失败：抛出含域名与原因的错误', async () => {
		const deps = makeDeps(makeHomepageHtml({}), {
			fetchHomepageHtml: vi.fn().mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED')),
		})

		await expect(addProduct('unreachable.net', deps)).rejects.toThrow(
			'抓取首页失败 (域名 unreachable.net): net::ERR_CONNECTION_REFUSED',
		)
	})

	it('产品分析失败：抛出含域名与原因的错误，不入库', async () => {
		const deps = makeDeps(makeHomepageHtml({}), {
			callLLM: vi.fn().mockRejectedValue(new Error('API 认证失败，请检查设置中的 API Key')),
		})

		await expect(addProduct('analyse-fail.com', deps)).rejects.toThrow(
			'生成产品分析失败 (域名 analyse-fail.com): API 认证失败，请检查设置中的 API Key',
		)
		expect(await getProductByDomain('analyse-fail.com')).toBeUndefined()
	})
})
