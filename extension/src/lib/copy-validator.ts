/** 生成文案的规格校验：长度上限与产品域名链接数。 */

export const COPY_LIMITS = {
	maxIntroChars: 300,
	maxDescriptionChars: 1000,
	minProductLinks: 1,
	maxProductLinks: 3,
} as const

/** 返回越界清单（空数组 = 通过）。 */
export function validateCopy(intro: string, description: string, domain: string): string[] {
	const violations: string[] = []

	if (intro.length > COPY_LIMITS.maxIntroChars) {
		violations.push(`简介 ${intro.length} 字符，超过上限 ${COPY_LIMITS.maxIntroChars}`)
	}
	if (description.length > COPY_LIMITS.maxDescriptionChars) {
		violations.push(`详述 ${description.length} 字符，超过上限 ${COPY_LIMITS.maxDescriptionChars}`)
	}

	const productLinkCount = countProductDomainLinks(description, domain)
	if (productLinkCount < COPY_LIMITS.minProductLinks) {
		violations.push(`详述缺少指向 ${domain} 的链接（找到 ${productLinkCount} 个，需要 ${COPY_LIMITS.minProductLinks}~${COPY_LIMITS.maxProductLinks} 个）`)
	}
	if (productLinkCount > COPY_LIMITS.maxProductLinks) {
		violations.push(`详述指向 ${domain} 的链接过多（找到 ${productLinkCount} 个，上限 ${COPY_LIMITS.maxProductLinks} 个）`)
	}

	return violations
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
