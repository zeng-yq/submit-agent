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
}

export interface PageInfo {
  title: string;
  description: string;
  headings: string[];
  content_preview: string;
}

export interface FormAnalysisResult {
  fields: FormField[];
  page_info: PageInfo;
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
      const text = prev.textContent?.trim();
      if (text) return text;
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
 * Analyze all forms on the page and extract structured field metadata.
 */
export function analyzeForms(doc: Document): FormAnalysisResult {
  const fields: FormField[] = [];
  let fieldIndex = 0;

  // Collect all form elements
  const formElements = Array.from(doc.querySelectorAll('form'));

  // If no <form> elements, scan the whole document
  const searchRoots =
    formElements.length > 0 ? formElements : [doc.body || doc.documentElement];

  for (const root of searchRoots) {
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

      fields.push({
        canonical_id: `field_${fieldIndex}`,
        name: el.getAttribute('name') || '',
        id: el.id || '',
        type,
        label,
        placeholder,
        required,
        maxlength: effectiveMaxlength,
        selector: buildSelector(htmlEl),
        tagName: tag,
      });

      fieldIndex++;
    }

    // Also check for contenteditable elements within the form context
    if (formElements.length > 0) {
      const editables = root.querySelectorAll('[contenteditable="true"]');
      for (const el of editables) {
        const role = el.getAttribute('role');
        if (role !== 'textbox') continue;

        const htmlEl = el as HTMLElement;
        const label = findLabel(doc, htmlEl);
        const ariaLabel = el.getAttribute('aria-label') || '';

        fields.push({
          canonical_id: `field_${fieldIndex}`,
          name: el.getAttribute('name') || '',
          id: el.id || '',
          type: 'contenteditable',
          label: label || ariaLabel,
          placeholder: '',
          required: false,
          maxlength: null,
          selector: buildSelector(htmlEl),
          tagName: el.tagName.toLowerCase(),
        });

        fieldIndex++;
      }
    }
  }

  return {
    fields,
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
