/**
 * Build product context string for LLM prompts.
 * Migrated from SubmitAgent.ts buildProductContext().
 */

import type { ProductProfile } from '@/lib/types'

export function buildProductContext(product: ProductProfile): string {
	const lines = [
		'## Product Data',
		'',
		`**Name:** ${product.name}`,
		`**URL:** ${product.url}`,
		`**Tagline:** ${product.tagline}`,
		'',
		'**Short Description:**',
		product.shortDesc,
		'',
		'**Long Description:**',
		product.longDesc,
		'',
		`**Categories:** ${product.categories.join(', ')}`,
	]

	if (product.founderName) {
		lines.push('', `**Founder Name:** ${product.founderName}`)
	}
	if (product.founderEmail) {
		lines.push(`**Founder Email:** ${product.founderEmail}`)
	}

	return lines.join('\n')
}
