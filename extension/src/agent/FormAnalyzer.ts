/**
 * FormAnalyzer — scans page forms and extracts structured field metadata.
 * Runs in the content script. No LLM dependency.
 */

import { isFormField } from './dom-utils';

export interface FormField {
  canonical_id: string;
  name: string;
  id: string;
  type: string;
  label: string;
  placeholder: string;
  required: boolean;
  maxlength: number | null;
  inferred_purpose?: string;  // heuristic purpose when label is empty
  effective_type?: string;    // enhanced type for LLM context
  selector: string;
  tagName: string;
  form_index?: number;        // which form this field belongs to
}

export interface PageInfo {
  title: string;
  description: string;
  headings: string[];
  content_preview: string;
}

export interface FormAnalysisResult {
  fields: FormField[];
  forms: FormGroup[];   // all form metadata (including filtered)
  page_info: PageInfo;
}

export type FormRole = 'search' | 'login' | 'newsletter' | 'unknown'
export type FormConfidence = 'high' | 'medium' | 'low'

export interface FormGroup {
  form_index: number
  role: FormRole
  confidence: FormConfidence
  form_id?: string
  form_action?: string
  field_count: number
  filtered: boolean
}

/**
 * Escape a string for use in a CSS selector.
 */
function cssEscape(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/#/g, '\\#')
    .replace(/\./g, '\\.')
    .replace(/:/g, '\\:');
}

/**
 * Generate a stable CSS selector for a form element.
 */
function buildSelector(el: HTMLElement): string {
  // Try id first
  if (el.id) {
    return `#${cssEscape(el.id)}`;
  }

  // Try name attribute with tag
  const name = el.getAttribute('name');
  if (name) {
    return `${el.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
  }

  // Fallback: nth-of-type within parent
  const parent = el.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children).filter(
      (c) => c.tagName === el.tagName,
    );
    const index = siblings.indexOf(el);
    if (index >= 0) {
      return `${el.tagName.toLowerCase()}:nth-of-type(${index + 1})`;
    }
  }

  // Last resort: class-based
  if (el.className && typeof el.className === 'string') {
    const classes = el.className.split(/\s+/).filter(Boolean).slice(0, 2);
    if (classes.length) {
      return `${el.tagName.toLowerCase()}.${classes.join('.')}`;
    }
  }

  return el.tagName.toLowerCase();
}

/**
 * Find the associated label text for a form element.
 * Uses a 7-step cascade from most specific to most general.
 */
function findLabel(doc: Document, el: HTMLElement): string {
  // 1. <label for="id">
  if (el.id) {
    const label = doc.querySelector(`label[for="${cssEscape(el.id)}"]`);
    if (label) {
      const text = label.textContent?.trim();
      if (text) return text;
    }
  }

  // 2. Wrapping <label>
  const parentLabel = el.closest('label');
  if (parentLabel) {
    const clone = parentLabel.cloneNode(true) as HTMLElement;
    const inputs = clone.querySelectorAll('input, textarea, select');
    inputs.forEach((input) => input.remove());
    const text = clone.textContent?.trim();
    if (text) return text;
  }

  // 3. aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // 4. aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const refEl = doc.getElementById(labelledBy);
    if (refEl) {
      const text = refEl.textContent?.trim();
      if (text) return text;
    }
  }

  // 5. title attribute
  const title = el.getAttribute('title');
  if (title) return title;

  // 6. Adjacent sibling <label> (previous sibling, without for attribute)
  let prev = el.previousElementSibling;
  while (prev) {
    if (prev.tagName === 'LABEL') {
      // Skip labels that have a for attribute pointing to a different element
      const labelFor = prev.getAttribute('for');
      if (!labelFor || labelFor === el.id) {
        const text = prev.textContent?.trim();
        if (text) return text;
      }
    }
    prev = prev.previousElementSibling;
  }

  // 7. Parent container text — last text-bearing child element before this input
  const parent = el.parentElement;
  if (parent) {
    const labelTags = new Set(['LABEL', 'SPAN', 'DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
    const children = Array.from(parent.children);
    const elIndex = children.indexOf(el);

    for (let i = elIndex - 1; i >= 0; i--) {
      const sibling = children[i];
      if (labelTags.has(sibling.tagName)) {
        // Skip <label> elements that have a for attribute pointing to a different element
        if (sibling.tagName === 'LABEL') {
          const labelFor = sibling.getAttribute('for');
          if (labelFor && labelFor !== el.id) continue;
        }
        const text = sibling.textContent?.trim();
        if (text) return text;
      }
    }
  }

  return '';
}

/**
 * Infer field purpose from placeholder, name attribute, and type
 * when no label could be resolved. Returns empty string if label is already present.
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

  // Type-based inference (highest confidence)
  if (field.type === 'url') return 'website URL';
  if (field.type === 'email') return 'email address';
  if (field.type === 'tel') return 'phone number';

  // Placeholder-based inference
  if (ph.includes('email') || ph.includes('@')) return 'email address';
  if (ph.includes('http') || ph.includes('https') || ph.includes('url')) return 'website URL';
  if (ph.includes('name')) return 'full name';

  // Name-attribute-based inference
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
 * Only applies when type="text". Returns empty string if no inference possible.
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
 * Classify a <form> element's role (search, login, newsletter, or unknown).
 * Uses high-confidence signals only — ambiguous forms default to 'unknown'.
 */
export function classifyForm(formEl: HTMLFormElement, formIndex: number): FormGroup {
  const id = formEl.id || undefined;
  const action = formEl.getAttribute('action') || undefined;
  const role = formEl.getAttribute('role') || '';

  // Count visible, fillable fields (same logic as isFormField but inline to avoid import cycle)
  const allInputs = formEl.querySelectorAll('input, textarea, select');
  let fieldCount = 0;
  let hasPassword = false;
  const fieldNames: string[] = [];

  for (const el of allInputs) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const type = (el as HTMLInputElement).type?.toLowerCase() || 'text';
      if (['hidden', 'submit', 'button', 'reset', 'image', 'file'].includes(type)) continue;
      if (type === 'password') hasPassword = true;
    }
    // Skip captcha-like elements
    const name = el.getAttribute('name') || '';
    const elId = el.id || '';
    const cls = el.className || '';
    const captchaSignals = ['captcha', 'recaptcha', 'hcaptcha'];
    const combined = `${name} ${elId} ${cls}`.toLowerCase();
    if (captchaSignals.some(s => combined.includes(s))) continue;

    fieldCount++;
    fieldNames.push(name.toLowerCase());
  }

  // --- Search detection ---
  if (role === 'search') {
    return { form_index: formIndex, role: 'search', confidence: 'high', form_id: id, form_action: action, field_count: fieldCount, filtered: true };
  }
  if (action && (action.includes('/search') || action.includes('?s='))) {
    return { form_index: formIndex, role: 'search', confidence: 'high', form_id: id, form_action: action, field_count: fieldCount, filtered: true };
  }
  // Single text field named q/s/query/keyword/search_term with a submit button
  if (fieldCount === 1 && fieldNames.some(n => ['q', 's', 'query', 'keyword', 'search_term', 'search'].includes(n))) {
    return { form_index: formIndex, role: 'search', confidence: 'high', form_id: id, form_action: action, field_count: fieldCount, filtered: true };
  }

  // --- Login detection ---
  // Only high confidence for password + few fields (typical login form).
  // Submission/registration forms with many fields + password should not be filtered.
  if (hasPassword && fieldCount <= 2) {
    return { form_index: formIndex, role: 'login', confidence: 'high', form_id: id, form_action: action, field_count: fieldCount, filtered: true };
  }
  if (action && (action.includes('/login') || action.includes('/signin') || action.includes('/auth'))) {
    return { form_index: formIndex, role: 'login', confidence: 'high', form_id: id, form_action: action, field_count: fieldCount, filtered: true };
  }
  if (fieldNames.some(n => n.includes('password') || n.includes('passwd'))) {
    return { form_index: formIndex, role: 'login', confidence: 'high', form_id: id, form_action: action, field_count: fieldCount, filtered: true };
  }

  // --- Newsletter detection ---
  if (action && (action.includes('/subscribe') || action.includes('/newsletter'))) {
    return { form_index: formIndex, role: 'newsletter', confidence: 'high', form_id: id, form_action: action, field_count: fieldCount, filtered: true };
  }
  if (fieldNames.some(n => n.includes('newsletter') || n.includes('subscribe') || n.includes('mailing'))) {
    return { form_index: formIndex, role: 'newsletter', confidence: 'high', form_id: id, form_action: action, field_count: fieldCount, filtered: true };
  }
  // Single email input + submit = likely newsletter
  if (fieldCount === 1 && fieldNames.some(n => n.includes('email'))) {
    const submitButtons = formEl.querySelectorAll('button[type="submit"], input[type="submit"]');
    if (submitButtons.length > 0) {
      return { form_index: formIndex, role: 'newsletter', confidence: 'medium', form_id: id, form_action: action, field_count: fieldCount, filtered: true };
    }
  }

  // --- Default: unknown (preserved) ---
  return { form_index: formIndex, role: 'unknown', confidence: 'low', form_id: id, form_action: action, field_count: fieldCount, filtered: false };
}

/**
 * Extract page info (title, description, headings, content preview).
 */
function extractPageInfo(doc: Document): PageInfo {
  const title = doc.title || '';

  const metaDesc =
    doc.querySelector<HTMLMetaElement>('meta[name="description"]')
      ?.content || '';

  const headings: string[] = [];
  const headingElements = doc.querySelectorAll('h1, h2, h3, h4, h5, h6');
  for (const h of headingElements) {
    const level = parseInt(h.tagName[1], 10);
    const prefix = '#'.repeat(level);
    const text = h.textContent?.trim();
    if (text) {
      headings.push(`${prefix} ${text}`);
    }
  }

  // Extract main content
  let contentPreview = '';
  const mainEl =
    doc.querySelector('main') ||
    doc.querySelector('article') ||
    doc.querySelector('[role="main"]');
  if (mainEl) {
    contentPreview = (mainEl.textContent || '').trim().slice(0, 3000);
  }

  return { title, description: metaDesc, headings, content_preview: contentPreview };
}

/**
 * Build a grouped field list string for LLM prompts.
 * Shows form headers for each form, one-line summaries for filtered forms,
 * and detailed field entries for unfiltered forms.
 */
export function buildFieldList(fields: FormField[], forms: FormGroup[]): string {
  // No form context (body fallback) — render flat list
  if (forms.length === 0) {
    return fields.map(formatFieldLine).join('\n');
  }

  const lines: string[] = [];

  for (const group of forms) {
    const formLabel = buildFormLabel(group);

    if (group.filtered) {
      lines.push(`${formLabel} — ${group.field_count} field${group.field_count !== 1 ? 's' : ''} (filtered)`);
      lines.push(`- (${group.role} form — skipped)`);
    } else {
      const groupFields = fields.filter(f => f.form_index === group.form_index);
      lines.push(`${formLabel} — ${groupFields.length} field${groupFields.length !== 1 ? 's' : ''}`);
      for (const f of groupFields) {
        lines.push(formatFieldLine(f));
      }
    }
  }

  return lines.join('\n');
}

function buildFormLabel(group: FormGroup): string {
  const parts = [`[Form ${group.form_index + 1}]`];
  if (group.form_id) parts.push(`id="${group.form_id}"`);
  if (group.form_action) parts.push(`action="${group.form_action}"`);
  if (group.role !== 'unknown') parts.push(`role=${group.role}`);
  return parts.join(' ');
}

function formatFieldLine(f: FormField): string {
  const parts = [`${f.canonical_id}: type=${f.effective_type || f.type}`];
  if (f.label) parts.push(`label="${f.label}"`);
  if (f.placeholder) parts.push(`placeholder="${f.placeholder}"`);
  if (f.inferred_purpose) parts.push(`inferred_purpose="${f.inferred_purpose}"`);
  parts.push(f.required ? 'required' : 'optional');
  if (f.maxlength) parts.push(`maxlength=${f.maxlength}`);
  return `- ${parts.join(', ')}`;
}

/**
 * Remove honeypot-suspect duplicate fields: same label but different type.
 * Within each form group, keeps the more "standard" field and removes the other.
 */
function deduplicateFields(fields: FormField[]): FormField[] {
  const labelKey = (f: FormField) => (f.label || f.inferred_purpose || '').toLowerCase().trim();

  // Group by form_index (undefined fields share one group)
  const groups = new Map<number | undefined, FormField[]>();
  for (const f of fields) {
    const key = f.form_index;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }

  const kept: FormField[] = [];

  for (const [, groupFields] of groups) {
    // Track which fields to remove
    const removeSet = new Set<string>();

    // Build label → fields map
    const byLabel = new Map<string, FormField[]>();
    for (const f of groupFields) {
      const key = labelKey(f);
      if (!key) continue;
      if (!byLabel.has(key)) byLabel.set(key, []);
      byLabel.get(key)!.push(f);
    }

    for (const [, sameLabelFields] of byLabel) {
      if (sameLabelFields.length < 2) continue;

      // Sort: prefer input over textarea, specific type over text, has-label over no-label
      // Higher score = more likely to be the real field
      const score = (f: FormField): number => {
        let s = 0;
        if (f.tagName === 'input') s += 10;
        if (f.type === 'textarea') s += 5;
        // Prefer specific types (url, email, tel) over generic text
        if (['url', 'email', 'tel'].includes(f.type)) s += 8;
        // Prefer fields that have a real label
        if (f.label) s += 3;
        return s;
      };

      sameLabelFields.sort((a, b) => score(b) - score(a));
      // Keep the highest-scored, remove the rest
      for (let i = 1; i < sameLabelFields.length; i++) {
        removeSet.add(sameLabelFields[i].canonical_id);
        console.debug(
          `[SubmitAgent] Honeypot suspect removed: ${sameLabelFields[i].canonical_id}` +
          ` (type=${sameLabelFields[i].type}, label="${sameLabelFields[i].label}")` +
          ` — duplicate of ${sameLabelFields[0].canonical_id} (type=${sameLabelFields[0].type})`
        );
      }
    }

    for (const f of groupFields) {
      if (!removeSet.has(f.canonical_id)) kept.push(f);
    }
  }

  return kept;
}

/**
 * Analyze all forms on the page and extract structured field metadata.
 */
export function analyzeForms(doc: Document): FormAnalysisResult {
  const fields: FormField[] = [];
  let fieldIndex = 0;

  const formElements = Array.from(doc.querySelectorAll('form'));
  const formGroups: FormGroup[] = formElements.map((formEl, i) => classifyForm(formEl, i));
  const filteredIndices = new Set<number>(
    formGroups.filter(g => g.filtered).map(g => g.form_index)
  );

  // Log filtered forms for debugging
  for (const group of formGroups) {
    if (group.filtered) {
      console.debug(
        `[SubmitAgent] Form ${group.form_index + 1} filtered as "${group.role}"` +
        ` (action=${group.form_action || 'none'}, id=${group.form_id || 'none'})`
      );
    }
  }

  // If no <form> elements, scan the whole document (no filtering possible)
  const searchRoots: Array<HTMLElement | Document> =
    formElements.length > 0 ? formElements : [doc.body || doc.documentElement];

  for (let rootIdx = 0; rootIdx < searchRoots.length; rootIdx++) {
    const root = searchRoots[rootIdx];

    // Skip filtered forms
    if (formElements.length > 0 && filteredIndices.has(rootIdx)) continue;

    const candidates = root.querySelectorAll('input, textarea, select');

    for (const el of candidates) {
      if (!isFormField(el)) continue;

      const htmlEl = el as HTMLElement;
      const tag = el.tagName.toLowerCase();
      // For <select>, override the "select-one" DOM type to just "select"
      const type =
        tag === 'select'
          ? 'select'
          : ((el as HTMLInputElement).type?.toLowerCase() || tag);

      const label = findLabel(doc, htmlEl);
      const placeholder = (el as HTMLInputElement).placeholder || '';
      const required = (el as HTMLInputElement).required || false;
      const maxlength = (el as HTMLInputElement).maxLength || null;
      // maxLength of -1 means no limit
      const effectiveMaxlength =
        maxlength !== null && maxlength >= 0 ? maxlength : null;

      let selector = buildSelector(htmlEl);
      // Ensure selector is unique in the document — stamp with data attribute if needed
      if (doc.querySelectorAll(selector).length > 1) {
        const attr = `data-sa-field-${fieldIndex}`;
        htmlEl.setAttribute(attr, '');
        selector = `[${attr}]`;
      }

      const rawField = {
        name: el.getAttribute('name') || '',
        id: el.id || '',
        type,
        label,
        placeholder,
        required,
        maxlength: effectiveMaxlength,
        selector,
        tagName: tag,
      };

      fields.push({
        canonical_id: `field_${fieldIndex}`,
        ...rawField,
        inferred_purpose: inferFieldPurpose(rawField),
        effective_type: inferEffectiveType(rawField),
        form_index: formElements.length > 0 ? rootIdx : undefined,
      });

      fieldIndex++;
    }

    // Also check for contenteditable elements (both in <form> and body-fallback contexts)
    {
      const editables = root.querySelectorAll('[contenteditable="true"]');
      for (const el of editables) {
        if (!isFormField(el)) continue;

        const htmlEl = el as HTMLElement;
        const label = findLabel(doc, htmlEl);
        const ariaLabel = el.getAttribute('aria-label') || '';

        let ceSelector = buildSelector(htmlEl);
        // Ensure selector is unique in the document
        if (doc.querySelectorAll(ceSelector).length > 1) {
          const attr = `data-sa-field-${fieldIndex}`;
          htmlEl.setAttribute(attr, '');
          ceSelector = `[${attr}]`;
        }

        const ceField = {
          name: el.getAttribute('name') || '',
          id: el.id || '',
          type: 'contenteditable' as const,
          label: label || ariaLabel,
          placeholder: '',
          required: false,
          maxlength: null as number | null,
          selector: ceSelector,
          tagName: el.tagName.toLowerCase(),
        };

        fields.push({
          canonical_id: `field_${fieldIndex}`,
          ...ceField,
          inferred_purpose: inferFieldPurpose(ceField),
          effective_type: inferEffectiveType(ceField),
          form_index: formElements.length > 0 ? rootIdx : undefined,
        });

        fieldIndex++;
      }
    }
  }

  return {
    fields: deduplicateFields(fields),
    forms: formGroups,
    page_info: extractPageInfo(doc),
  };
}

/**
 * Find a DOM element by its canonical_id from a FormAnalysisResult.
 */
export function resolveField(
  analysis: FormAnalysisResult,
  canonicalId: string,
): HTMLElement | null {
  const field = analysis.fields.find((f) => f.canonical_id === canonicalId);
  if (!field) return null;

  try {
    return document.querySelector(field.selector);
  } catch {
    return null;
  }
}
