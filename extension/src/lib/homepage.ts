/** 从首页 HTML 解析基本信息：网站名、logo、og 封面图、供 LLM 分析的正文文本。 */
export interface HomepageBasics {
	siteName?: string
	logoUrl?: string
	ogImageUrl?: string
	/** 压缩空白并截断的正文文本 */
	textContent: string
}

const HOMEPAGE_TEXT_MAX_CHARS = 6000

export function parseHomepageBasics(html: string, baseUrl: string): HomepageBasics {
	const doc = new DOMParser().parseFromString(html, 'text/html')

	const metaContent = (selector: string) =>
		doc.querySelector(selector)?.getAttribute('content')?.trim() || undefined

	const siteName =
		metaContent('meta[property="og:site_name"]') ||
		doc.querySelector('title')?.textContent?.trim() ||
		undefined

	const ogImageUrl = toAbsoluteUrl(metaContent('meta[property="og:image"]'), baseUrl)

	const iconHref =
		doc.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href') ||
		doc.querySelector('link[rel~="icon"]')?.getAttribute('href') ||
		'/favicon.ico'
	const logoUrl = toAbsoluteUrl(iconHref, baseUrl)

	const textContent = (doc.body?.textContent ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, HOMEPAGE_TEXT_MAX_CHARS)

	return { siteName, logoUrl, ogImageUrl, textContent }
}

function toAbsoluteUrl(href: string | null | undefined, baseUrl: string): string | undefined {
	if (!href) return undefined
	try {
		return new URL(href, baseUrl).href
	} catch {
		// href 无法解析为绝对 URL（如空串或非法值）按缺失处理
		return undefined
	}
}
