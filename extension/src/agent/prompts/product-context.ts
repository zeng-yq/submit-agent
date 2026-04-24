import type { ProductProfile } from '@/lib/types'

export function buildProductContext(product: ProductProfile, selectedAnchor?: string): string {
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
	}

	if (product.founderName) {
		lines.push('', `**创始人姓名:** ${product.founderName}`)
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
