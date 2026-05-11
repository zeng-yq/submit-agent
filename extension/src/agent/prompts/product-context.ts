import type { ProductProfile } from '@/lib/types'

export function buildProductContext(product: ProductProfile, selectedAnchor?: string, selectedFounderName?: string): string {
	const lines = [
		'## 产品信息',
		'',
		`**名称:** ${product.name}`,
		`**URL:** ${product.url}`,
		'',
		'### 产品描述',
		product.description,
		'',
		`**锚文本列表:** ${product.anchorTexts}`,
	]

	if (selectedAnchor) {
		lines.push(`**本次使用的锚文本:** ${selectedAnchor}`)
		lines.push('**锚文本语种要求:** 如果页面语种与锚文本语种不同，必须将锚文本翻译为页面语种后再使用。翻译时应保持关键词的 SEO 价值，选择该语种中对应的常用搜索词。')
	}

	if (selectedFounderName) {
		lines.push('', `**创始人姓名:** ${selectedFounderName}`)
	}
	if (product.founderEmail) {
		lines.push(`**创始人邮箱:** ${product.founderEmail}`)
	}

	return lines.join('\n')
}

/** Randomly select one anchor text from the comma-separated list. Falls back to product name. */
export function pickAnchorText(product: ProductProfile): string {
	const list = product.anchorTexts.split(',').map(s => s.trim()).filter(Boolean)
	return list.length > 0
		? list[Math.floor(Math.random() * list.length)]
		: product.name
}

/** Randomly select one founder name from the comma-separated list. Falls back to empty string. */
export function pickFounderName(product: ProductProfile): string {
	const list = product.founderName.split(',').map(s => s.trim()).filter(Boolean)
	return list.length > 0
		? list[Math.floor(Math.random() * list.length)]
		: ''
}
