/** 提示词构造：内置在插件内（产品分析与文案生成）。 */

export function buildProductAnalysisPrompt(input: {
	domain: string
	siteName?: string
	homepageText: string
}): { systemPrompt: string; userPrompt: string } {
	const systemPrompt = [
		'You are a concise product analyst.',
		'Read the website homepage content and write a compact English product brief under 1200 characters, covering:',
		'what the product is, the core value it delivers, 2-4 standout features, and the target audience.',
		'Use plain sentences. No markdown. No em dashes.',
	].join(' ')

	const userPrompt = [
		`Website: ${input.siteName ?? input.domain} (${input.domain})`,
		'',
		'Homepage content:',
		input.homepageText,
	].join('\n')

	return { systemPrompt, userPrompt }
}

export function buildCopyGenerationPrompt(input: {
	productName: string
	domain: string
	url: string
	analysis: string
	seed: string
}): { systemPrompt: string; userPrompt: string } {
	const systemPrompt = [
		'You write listing copy for a web directory submission.',
		'Follow every rule exactly:',
		'- Write in English only.',
		'- Use short sentences. Sound like a human talking, not a brochure.',
		'- Never use em dashes or en dashes, and no long compound sentences.',
		'- "intro" is at most 300 characters, plain text, no markdown.',
		'- "description" is at most 1000 characters, written in markdown.',
		'- Inside "description", include 1 to 3 markdown links pointing ONLY to this product site,',
		`  e.g. [natural anchor text](${input.url}). Anchor text must be natural and varied, never "click here".`,
		'- Do not mention directories, submissions, or SEO.',
		'Return ONLY a JSON object with exactly two string fields: {"intro": "...", "description": "..."}',
	].join('\n')

	const userPrompt = [
		`Session seed: ${input.seed}`,
		'(Random run identifier. Ignore it. It only makes each run different.)',
		'',
		`Product name: ${input.productName}`,
		`Domain: ${input.domain}`,
		`URL: ${input.url}`,
		'',
		'Product analysis:',
		input.analysis,
	].join('\n')

	return { systemPrompt, userPrompt }
}
