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
		lines.push(`**Founder:** ${product.founderName}`)
	}
	if (product.founderEmail) {
		lines.push(`**Email:** ${product.founderEmail}`)
	}

	const socialEntries = Object.entries(product.socialLinks).filter(([_, v]) => v)
	if (socialEntries.length > 0) {
		lines.push('', '**Social Links:**')
		for (const [platform, url] of socialEntries) {
			lines.push(`- ${platform}: ${url}`)
		}
	}

	return lines.join('\n')
}
