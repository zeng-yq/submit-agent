import type { FormField, PageInfo } from './types'

/**
 * Escape a string for use in a CSS selector.
 */
export function cssEscape(str: string): string {
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
export function buildSelector(el: HTMLElement): string {
  if (el.id) return `#${cssEscape(el.id)}`;

  const name = el.getAttribute('name');
  if (name) return `${el.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;

  const parent = el.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children).filter(
      (c) => c.tagName === el.tagName,
    );
    const index = siblings.indexOf(el);
    if (index >= 0) return `${el.tagName.toLowerCase()}:nth-of-type(${index + 1})`;
  }

  if (el.className && typeof el.className === 'string') {
    const classes = el.className.split(/\s+/).filter(Boolean).slice(0, 2);
    if (classes.length) return `${el.tagName.toLowerCase()}.${classes.join('.')}`;
  }

  return el.tagName.toLowerCase();
}

/**
 * Find the associated label text for a form element.
 * Uses a 7-step cascade from most specific to most general.
 */
export function findLabel(doc: Document, el: HTMLElement): string {
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

  // 6. Adjacent sibling <label>
  let prev = el.previousElementSibling;
  while (prev) {
    if (prev.tagName === 'LABEL') {
      const labelFor = prev.getAttribute('for');
      if (!labelFor || labelFor === el.id) {
        const text = prev.textContent?.trim();
        if (text) return text;
      }
    }
    prev = prev.previousElementSibling;
  }

  // 7. Parent container text
  const parent = el.parentElement;
  if (parent) {
    const labelTags = new Set(['LABEL', 'SPAN', 'DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
    const children = Array.from(parent.children);
    const elIndex = children.indexOf(el);
    for (let i = elIndex - 1; i >= 0; i--) {
      const sibling = children[i];
      if (labelTags.has(sibling.tagName)) {
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
 * Remove honeypot-suspect duplicate fields: same label but different type.
 */
export function deduplicateFields(fields: FormField[]): FormField[] {
  const labelKey = (f: FormField) => (f.label || f.inferred_purpose || '').toLowerCase().trim();

  const groups = new Map<number | undefined, FormField[]>();
  for (const f of fields) {
    const key = f.form_index;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }

  const kept: FormField[] = [];

  for (const [, groupFields] of groups) {
    const removeSet = new Set<string>();
    const byLabel = new Map<string, FormField[]>();
    for (const f of groupFields) {
      const key = labelKey(f);
      if (!key) continue;
      if (!byLabel.has(key)) byLabel.set(key, []);
      byLabel.get(key)!.push(f);
    }

    for (const [, sameLabelFields] of byLabel) {
      if (sameLabelFields.length < 2) continue;

      const score = (f: FormField): number => {
        let s = 0;
        if (f.tagName === 'input') s += 10;
        if (f.type === 'textarea') s += 5;
        if (['url', 'email', 'tel'].includes(f.type)) s += 8;
        if (f.label) s += 3;
        return s;
      };

      sameLabelFields.sort((a, b) => score(b) - score(a));
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
 * Extract page info (title, description, headings, content preview).
 */
export function extractPageInfo(doc: Document): PageInfo {
  const title = doc.title || '';
  const metaDesc =
    doc.querySelector<HTMLMetaElement>('meta[name="description"]')?.content || '';

  const headings: string[] = [];
  const headingElements = doc.querySelectorAll('h1, h2, h3, h4, h5, h6');
  for (const h of headingElements) {
    const level = parseInt(h.tagName[1], 10);
    const prefix = '#'.repeat(level);
    const text = h.textContent?.trim();
    if (text) headings.push(`${prefix} ${text}`);
  }

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
