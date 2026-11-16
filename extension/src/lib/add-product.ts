import { normalizeDomain } from './domain'
import { parseHomepageBasics } from './homepage'
import { buildProductAnalysisPrompt } from './prompts'
import { getProductByDomain, saveProduct } from './db'
import { toErrorMessage } from './to-error-message'
import { readBlobAsDataUrl } from './data-url'
import type { LLMSettings, Product } from './types'

/** 添加产品的管线阶段事件，UI 据此渲染实时进度日志 */
export type AddProductStage =
	| { type: 'domain-normalized'; domain: string }
	| { type: 'homepage-fetching'; url: string }
	| { type: 'homepage-fetched'; htmlLength: number }
	| { type: 'basics-parsed'; siteName?: string; logoFound: boolean; ogFound: boolean }
	| { type: 'images-fetched'; logoSaved: boolean; ogSaved: boolean }
	| { type: 'analysis-starting' }
	| { type: 'analysis-done'; analysisLength: number }
	| { type: 'saved'; productId: string }

export interface AddProductDeps {
	llmConfig: LLMSettings
	fetchHomepageHtml: (url: string) => Promise<string>
	fetchImageAsDataUrl: (url: string) => Promise<string | undefined>
	callLLM: (options: { systemPrompt: string; userPrompt: string }) => Promise<string>
	onProgress?: (stage: AddProductStage) => void
	generateId?: () => string
	now?: () => number
}

/**
 * 添加产品管线（测试接缝，见 GLOSSARY 与规格 Testing Decisions）：
 * 域名规范化 → 抓首页 → 解析基本信息（图片缺失留空） → LLM 生成产品分析 → 入库。
 */
export async function addProduct(domainInput: string, deps: AddProductDeps): Promise<Product> {
	if (!deps.llmConfig.apiKey) {
		throw new Error(`未配置 LLM API Key（${deps.llmConfig.baseUrl}），请先在设置中配置后再添加产品`)
	}
	const report = deps.onProgress ?? (() => {})

	const domain = normalizeDomain(domainInput)
	const url = `https://${domain}`
	report({ type: 'domain-normalized', domain })

	const existing = await getProductByDomain(domain)
	if (existing) {
		throw new Error(`该域名已存在产品记录: ${domain}`)
	}

	report({ type: 'homepage-fetching', url })
	let html: string
	try {
		html = await deps.fetchHomepageHtml(url)
	} catch (err) {
		throw new Error(`抓取首页失败 (域名 ${domain}): ${toErrorMessage(err)}`)
	}
	report({ type: 'homepage-fetched', htmlLength: html.length })

	const basics = parseHomepageBasics(html, url)
	report({
		type: 'basics-parsed',
		siteName: basics.siteName,
		logoFound: Boolean(basics.logoUrl),
		ogFound: Boolean(basics.ogImageUrl),
	})

	const [logoDataUrl, ogDataUrl] = await Promise.all([
		basics.logoUrl ? deps.fetchImageAsDataUrl(basics.logoUrl) : undefined,
		basics.ogImageUrl ? deps.fetchImageAsDataUrl(basics.ogImageUrl) : undefined,
	])
	report({ type: 'images-fetched', logoSaved: Boolean(logoDataUrl), ogSaved: Boolean(ogDataUrl) })

	report({ type: 'analysis-starting' })
	const analysis = await deps
		.callLLM(
			buildProductAnalysisPrompt({ domain, siteName: basics.siteName, homepageText: basics.textContent }),
		)
		.catch((err: unknown) => {
			throw new Error(`生成产品分析失败 (域名 ${domain}): ${toErrorMessage(err)}`)
		})
	report({ type: 'analysis-done', analysisLength: analysis.length })

	const timestamp = (deps.now ?? Date.now)()
	const product: Product = {
		// 必须以方法形式调用 crypto.randomUUID：取出引用裸调会抛 Illegal invocation
		id: deps.generateId?.() ?? crypto.randomUUID(),
		domain,
		name: basics.siteName ?? domain,
		url,
		logoDataUrl: logoDataUrl ?? undefined,
		ogDataUrl: ogDataUrl ?? undefined,
		email: `support@${domain}`,
		analysis,
		createdAt: timestamp,
		updatedAt: timestamp,
	}

	await saveProduct(product)
	report({ type: 'saved', productId: product.id })
	return product
}

/** 默认实现：sidepanel 上下文直接 fetch（扩展页享有 host 权限，可跨域） */
export async function fetchHomepageHtml(url: string): Promise<string> {
	const response = await fetch(url)
	if (!response.ok) {
		throw new Error(`抓取首页失败 (HTTP ${response.status}): ${url}`)
	}
	return response.text()
}

/** 默认实现：图片转 dataURL；抓取失败按规格留空，不阻断添加 */
export async function fetchImageAsDataUrl(url: string): Promise<string | undefined> {
	try {
		const response = await fetch(url)
		if (!response.ok) return undefined
		return await readBlobAsDataUrl(await response.blob())
	} catch (err: unknown) {
		// 按规格图片缺失留空不阻断添加，但记录原因便于排查
		console.warn(`[Submit Agent] 抓取图片失败，留空: ${url}`, err)
		return undefined
	}
}
