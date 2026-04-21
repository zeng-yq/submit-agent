import type { FormField } from './types'

/**
 * Infer field purpose from placeholder, name attribute, and type.
 */
export function inferFieldPurpose(field: {
  label: string;
  placeholder: string;
  name: string;
  type: string;
}): string {
  if (field.label) return '';

  const ph = field.placeholder.toLowerCase();
  const name = field.name.toLowerCase();

  if (field.type === 'url') return 'website URL';
  if (field.type === 'email') return 'email address';
  if (field.type === 'tel') return 'phone number';

  if (ph.includes('email') || ph.includes('@')) return 'email address';
  if (ph.includes('http') || ph.includes('https') || ph.includes('url')) return 'website URL';
  if (ph.includes('name')) return 'full name';

  if (name.includes('email') || name.includes('mail')) return 'email address';
  if (name.includes('url') || name.includes('website') || name.includes('link')) return 'website URL';
  if (name.includes('name') || name.includes('author')) return 'name';
  if (name.includes('desc') || name.includes('description')) return 'description';
  if (name.includes('title')) return 'title';
  if (name.includes('category') || name.includes('tag')) return 'category';

  return '';
}

/**
 * Infer a more precise field type from context signals.
 */
export function inferEffectiveType(field: {
  label: string;
  placeholder: string;
  name: string;
  type: string;
}): string {
  if (field.type !== 'text') return '';

  const combined = `${field.label} ${field.placeholder} ${field.name}`.toLowerCase();

  if (combined.includes('email') || combined.includes('@')) return 'email';
  if (/https?:\/\//.test(field.placeholder)) return 'url';
  if (combined.includes('url') || combined.includes('website') || combined.includes('link')) return 'url';
  if (combined.includes('phone') || combined.includes('tel')) return 'tel';

  return '';
}

/**
 * Shared field classification used by both FormAnalyzer and backlink-analyzer.
 */
export function classifyFields(fields: FormField[]): {
  commentFields: FormField[]
  textareaFields: FormField[]
  urlFields: FormField[]
  emailFields: FormField[]
  authorFields: FormField[]
} {
  const commentFields = fields.filter(f => {
    const p = (f.inferred_purpose || f.label || f.name || '').toLowerCase()
    return p.includes('comment') || p.includes('message') || p.includes('reply')
  })

  const textareaFields = fields.filter(f =>
    f.tagName === 'textarea' || f.effective_type === 'textarea'
  )

  const urlFields = fields.filter(f => {
    const p = (f.inferred_purpose || f.label || f.name || '').toLowerCase()
    return p.includes('url') || p.includes('website') || p.includes('site')
  })

  const emailFields = fields.filter(f => {
    const t = (f.type || f.effective_type || '').toLowerCase()
    const p = (f.inferred_purpose || f.label || f.name || '').toLowerCase()
    return t === 'email' || p.includes('email')
  })

  const authorFields = fields.filter(f => {
    const p = (f.inferred_purpose || f.label || f.name || '').toLowerCase()
    return p.includes('author') || p.includes('nickname') || (p === 'name')
  })

  return { commentFields, textareaFields, urlFields, emailFields, authorFields }
}
