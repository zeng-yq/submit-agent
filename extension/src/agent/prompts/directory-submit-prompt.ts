/**
 * Directory submission prompt builder.
 * Generates a prompt that instructs the LLM to fill a directory/listing form
 * with product information.
 */

import type { FormField, PageInfo, FormGroup } from '../FormAnalyzer'
import { buildFieldList } from '../FormAnalyzer'

export interface DirectorySubmitPromptInput {
  productContext: string
  pageInfo: PageInfo
  fields: FormField[]
  forms: FormGroup[]
}

export function buildDirectorySubmitPrompt(input: DirectorySubmitPromptInput): string {
  const { productContext, pageInfo, fields, forms } = input

  const fieldList = buildFieldList(fields, forms)

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
    '1. The page may contain multiple forms. Only fill fields from the target submission form (marked with [Form N] above). Ignore any forms marked as "filtered" — these are search bars, login forms, or newsletter subscriptions and should NOT receive any values.',
    '2. Map product information to the appropriate form fields based on labels and field types.',
    '3. Use the product name for name/title fields, short description for summary fields, long description for description fields.',
    '4. For URL fields, use the product URL. For category fields, pick the best match from product categories.',
    '5. Respect maxlength constraints — truncate if needed.',
    '6. Fill all required fields. For optional fields, only fill if product data is relevant.',
    '7. Use English unless the page content indicates another language.',
    '8. Do NOT make up information. Only use data from the product context.',
    '9. If a field asks for information not available in the product data, use an empty string.',
    '',
    '## Output',
    '',
    'Return a JSON object mapping canonical_id to the value for each field. Example:',
    example,
  ].join('\n')
}
