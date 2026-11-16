/** 提示词构造：内置在插件内，工单 05 的文案生成提示词也放这里。 */

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
