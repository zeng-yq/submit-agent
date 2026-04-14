/**
 * Blog comment prompt builder.
 * Generates a prompt that instructs the LLM to produce a relevant comment
 * with a backlink to the product, following a link placement priority.
 */

import type { PageContent } from '../PageContentExtractor'
import type { FormField } from '../FormAnalyzer'

export interface BlogCommentPromptInput {
  productContext: string
  pageContent: PageContent
  fields: FormField[]
}

export function buildBlogCommentPrompt(input: BlogCommentPromptInput): string {
  const { productContext, pageContent, fields } = input

  const fieldList = fields
    .map((f) => {
      const parts = [`${f.canonical_id}: type=${f.effective_type || f.type}`];
      if (f.label) parts.push(`label="${f.label}"`);
      if (f.placeholder) parts.push(`placeholder="${f.placeholder}"`);
      if (f.inferred_purpose) parts.push(`inferred_purpose="${f.inferred_purpose}"`);
      parts.push(f.required ? 'required' : 'optional');
      return `- ${parts.join(', ')}`;
    })
    .join('\n')

  const exampleWithUrl = JSON.stringify({
    field_0: 'ProductAI',
    field_1: 'founder@example.com',
    field_2: 'https://productai.com',
    field_3: 'Great insights on AI adoption! The section about latency reduction really resonated with our experience — we\'ve seen similar improvements when deploying edge inference.',
  }, null, 2)

  const exampleFallback = JSON.stringify({
    field_0: 'Alex',
    field_1: 'founder@example.com',
    field_2: 'Really appreciate the breakdown of inference optimization strategies. We\'ve been tackling similar challenges at <a href="https://productai.com" rel="dofollow">ProductAI</a> and found that model distillation works even better than quantization for our use case.',
  }, null, 2)

  return [
    'You are filling a blog comment form to build a backlink. Generate values for each field based on the page content and product information. Your comment must be genuinely valuable and likely to be approved by the blog owner.',
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
    '2. Comment structure: ~30 chars of genuine value affirmation + ~50 chars of supplementary insight. Naturally weave in the product name or a relevant keyword as part of the comment.',
    '3. Link placement priority (follow this order):',
    '   - FIRST: "URL" / "website" / "homepage" field → fill with the product URL directly.',
    '   - SECOND: "name" / "author" field → use the product name (or a keyword from the product tagline) as the display name. This is the preferred anchor text strategy.',
    '   - FALLBACK: If neither a URL/website field nor a name/author field exists, place the link in the comment body using HTML: `<a href="{product_url}" rel="dofollow">{keyword}</a>`. The link text must be semantically coherent with the comment content.',
    '4. If placing a link in the comment body (fallback only):',
    '   - Use HTML format: `<a href="{product_url}" rel="dofollow">{keyword}</a>`',
    '   - The keyword must naturally relate to the surrounding comment text',
    '   - Do NOT use promotional phrases like "best tool", "must try", "highly recommend", etc.',
    '5. For the "email" field: use the founder email from product data if available, otherwise leave empty.',
    '6. Fill all required fields. For optional fields, only fill if the product data has relevant information.',
    '7. All text should be in the same language as the page content.',
    '8. The comment must feel like a genuine contribution — no spam, no generic praise, no overt promotion. The goal is for the comment to be approved by the blog owner.',
    '',
    '## Output',
    '',
    'Return a JSON object mapping canonical_id to the value for each field.',
    '',
    'Example (URL field available — comment body has NO link):',
    exampleWithUrl,
    '',
    'Example (no URL field — fallback link in comment body):',
    exampleFallback,
  ].join('\n')
}
