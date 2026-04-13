/**
 * Blog comment prompt builder.
 * Generates a prompt that instructs the LLM to produce a relevant comment
 * plus a name field with anchor text linking to the product.
 */

import type { PageContent } from '../PageContentExtractor'
import type { FormField } from '../FormAnalyzer'
import { buildProductContext } from './product-context'

export interface BlogCommentPromptInput {
	productContext: string
	pageContent: PageContent
	fields: FormField[]
}

export function buildBlogCommentPrompt(input: BlogCommentPromptInput): string {
	const { productContext, pageContent, fields } = input

	const fieldList = fields
		.map((f) => `- ${f.canonical_id}: type=${f.type}, label="${f.label || f.placeholder || f.name}", ${f.required ? 'required' : 'optional'}`)
		.join('\n')

	const example = JSON.stringify({
		field_0: 'John',
		field_1: 'john@example.com',
		field_2: 'https://example.com',
		field_3: 'Great article! I especially liked your point about X. In my experience, Y also helps a lot.',
	}, null, 2)

	return [
		'You are filling a blog comment form. Generate values for each field based on the page content and product information.',
		'',
		productContext,
		'',
		'## Page Content',
		'',
		`**Title:** ${pageContent.title}`,
		`**Description:** ${pageContent.description}`,
		pageContent.headings.length > 0 ? `**Headings:**\n${pageContent.headings.join('\n')}` : '',
		'**Content Preview:**',
		pageContent.content_preview,
		'',
		'## Form Fields',
		'',
		fieldList,
		'',
		'## Rules',
		'',
		'1. Read the page content carefully and write a relevant, authentic-sounding comment (not generic praise).',
		'2. The comment should feel natural and add value — like a real person who read the post.',
		'3. Comment body: ~30 characters of genuine value affirmation + ~50 characters of supplementary insight. Do NOT include any links or URLs in the comment body.',
		'4. For the "name" or "author" field: use the product name as anchor text. This is the ONLY place a product link may appear.',
		'5. For the "url" or "website" field: use the product URL.',
		'6. For the "email" field: use the founder email from product data if available, otherwise leave empty.',
		'7. Fill all required fields. For optional fields, only fill if the product data has relevant information.',
		'8. All text should be in the same language as the page content.',
		'',
		'## Output',
		'',
		'Return a JSON object mapping canonical_id to the value for each field. Example:',
		example,
	].join('\n')
}
