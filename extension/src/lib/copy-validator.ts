/** 生成文案的硬校验：仅产品域名链接数（外链提交的功能性底线）。字数为软约束，不在此校验。 */

export const PRODUCT_LINK_RANGE = { min: 1, max: 3 } as const

/** 返回违规清单（空数组 = 通过）。 */
export function validateProductLinks(description: string, domain: string): string[] {
	const productLinkCount = countProductDomainLinks(description, domain)
	if (productLinkCount < PRODUCT_LINK_RANGE.min) {
		return [
			`详述缺少指向 ${domain} 的链接（找到 ${productLinkCount} 个，需要 ${PRODUCT_LINK_RANGE.min}~${PRODUCT_LINK_RANGE.max} 个）`,
		]
	}
	if (productLinkCount > PRODUCT_LINK_RANGE.max) {
		return [`详述指向 ${domain} 的链接过多（找到 ${productLinkCount} 个，上限 ${PRODUCT_LINK_RANGE.max} 个）`]
	}
	return []
}

/** 统计 markdown 链接中指向产品域名（含子域名）的数量；无法解析的链接不计入。 */
function countProductDomainLinks(markdown: string, domain: string): number {
	const urls = Array.from(markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g), (match) => match[1])
	return urls.filter((url) => {
		try {
			const hostname = new URL(url).hostname.toLowerCase()
			return hostname === domain || hostname.endsWith(`.${domain}`)
		} catch {
			return false
		}
	}).length
}
