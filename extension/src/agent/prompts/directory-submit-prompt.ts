/**
 * Directory submission prompt builder.
 * Generates a prompt that instructs the LLM to fill a directory/listing form
 * with product information.
 */

import type { FormField } from '../FormAnalyzer'
import type { PageInfo } from '../FormAnalyzer'
import { buildProductContext } from './product-context'

export interface DirectorySubmitPromptInput {
	productContext: string
	pageInfo: PageInfo
	fields: FormField[]
}

export function buildDirectorySubmitPrompt(input: DirectorySubmitPromptInput): string {
	const { productContext, pageInfo, fields } = input

	const fieldList = fields
		.map((f) => {
			const parts = [`${f.canonical_id}: type=${f.effective_type || f.type}`];
			if (f.label) parts.push(`label="${f.label}"`);
			if (f.placeholder) parts.push(`placeholder="${f.placeholder}"`);
			if (f.inferred_purpose) parts.push(`inferred_purpose="${f.inferred_purpose}"`);
			parts.push(f.required ? 'required' : 'optional');
			if (f.maxlength) parts.push(`maxlength=${f.maxlength}`);
			return `- ${parts.join(', ')}`;
		})
		.join('\n')

	const example = JSON.stringify({
		field_0: 'My Product',
		field_1: 'https://myproduct.com',
		field_2: 'A great tool for X',
		field_3: 'Detailed description here...',
	}, null, 2)

	return [
		'You are filling a product submission form on a directory/listing website. Fill each field with appropriate product information.',
		'',
		productContext,
		'',
		'## Page Context',
		'',
		`**Title:** ${pageInfo.title}`,
		`**Description:** ${pageInfo.description}`,
		pageInfo.headings.length > 0 ? `**Headings:**\n${pageInfo.headings.join('\n')}` : '',
		'',
		'## Form Fields',
		'',
		fieldList,
		'',
		'## Rules',
		'',
		'1. Map product information to the appropriate form fields based on labels and field types.',
		'2. Use the product name for name/title fields, short description for summary fields, long description for description fields.',
		'3. For URL fields, use the product URL. For category fields, pick the best match from product categories.',
		'4. Respect maxlength constraints — truncate if needed.',
		'5. Fill all required fields. For optional fields, only fill if product data is relevant.',
		'6. Use English unless the page content indicates another language.',
		'7. Do NOT make up information. Only use data from the product context.',
		'8. If a field asks for information not available in the product data, use an empty string.',
		'',
		'## Output',
		'',
		'Return a JSON object mapping canonical_id to the value for each field. Example:',
		example,
	].join('\n')
}
