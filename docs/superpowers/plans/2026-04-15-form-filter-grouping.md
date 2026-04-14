# Form Filter & Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve form fill success rate on multi-form pages by pre-filtering irrelevant forms, grouping fields by form, and enhancing LLM prompts.

**Architecture:** Add a `classifyForm()` function to `FormAnalyzer.ts` that labels each `<form>` element with a role (search/login/newsletter/unknown). Only fields from unfiltered forms are included in the result. Prompt builders render a grouped field list and instruct the LLM to ignore filtered forms. Fuzzy matching gains same-form priority.

**Tech Stack:** TypeScript, Vitest + JSDOM

**Spec:** `docs/superpowers/specs/2026-04-15-form-filter-grouping-design.md`

---

### Task 1: Add `FormGroup` type and `classifyForm()` to FormAnalyzer

**Files:**
- Modify: `extension/src/agent/FormAnalyzer.ts`
- Test: `extension/src/__tests__/FormAnalyzer.test.ts`

- [ ] **Step 1: Write failing tests for `classifyForm()`**

Add a new `describe('classifyForm', ...)` block to `extension/src/__tests__/FormAnalyzer.test.ts`. Import `classifyForm` alongside the existing imports. Each test builds a minimal JSDOM document with specific `<form>` elements and asserts the returned `FormGroup`.

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

let analyzeForms: typeof import('@/agent/FormAnalyzer').analyzeForms;
let inferFieldPurpose: typeof import('@/agent/FormAnalyzer').inferFieldPurpose;
let inferEffectiveType: typeof import('@/agent/FormAnalyzer').inferEffectiveType;
let classifyForm: typeof import('@/agent/FormAnalyzer').classifyForm;

let dom: JSDOM;

// ... existing test blocks unchanged ...

describe('classifyForm', () => {
  beforeEach(async () => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      runScripts: 'dangerously',
      url: 'https://example.com',
    });
    const mod = await import('@/agent/FormAnalyzer');
    classifyForm = mod.classifyForm;
  });

  function getDoc(): Document {
    return dom.window.document;
  }

  it('classifies form with role="search" as search', () => {
    const doc = getDoc();
    doc.body.innerHTML = `<form role="search"><input type="text" name="q"><button type="submit">Search</button></form>`;
    const form = doc.querySelector('form')!;
    const result = classifyForm(form, 0);
    expect(result.role).toBe('search');
    expect(result.filtered).toBe(true);
    expect(result.confidence).toBe('high');
  });

  it('classifies form with action="/search" as search', () => {
    const doc = getDoc();
    doc.body.innerHTML = `<form action="/search"><input type="text" name="q"></form>`;
    const form = doc.querySelector('form')!;
    const result = classifyForm(form, 0);
    expect(result.role).toBe('search');
    expect(result.filtered).toBe(true);
  });

  it('classifies form with password field as login', () => {
    const doc = getDoc();
    doc.body.innerHTML = `<form action="/login"><input name="email"><input type="password" name="password"><button>Login</button></form>`;
    const form = doc.querySelector('form')!;
    const result = classifyForm(form, 0);
    expect(result.role).toBe('login');
    expect(result.filtered).toBe(true);
  });

  it('classifies form with action="/subscribe" and single email as newsletter', () => {
    const doc = getDoc();
    doc.body.innerHTML = `<form action="/subscribe"><input type="email" name="email"><button>Subscribe</button></form>`;
    const form = doc.querySelector('form')!;
    const result = classifyForm(form, 0);
    expect(result.role).toBe('newsletter');
    expect(result.filtered).toBe(true);
  });

  it('classifies unknown form as unknown and not filtered', () => {
    const doc = getDoc();
    doc.body.innerHTML = `<form id="submit-form" action="/submit"><input name="product_name"><textarea name="description"></textarea></form>`;
    const form = doc.querySelector('form')!;
    const result = classifyForm(form, 0);
    expect(result.role).toBe('unknown');
    expect(result.filtered).toBe(false);
  });

  it('records form_id and form_action', () => {
    const doc = getDoc();
    doc.body.innerHTML = `<form id="my-form" action="/api/submit"><input name="name"></form>`;
    const form = doc.querySelector('form')!;
    const result = classifyForm(form, 0);
    expect(result.form_id).toBe('my-form');
    expect(result.form_action).toBe('/api/submit');
  });

  it('records field_count', () => {
    const doc = getDoc();
    doc.body.innerHTML = `<form><input name="a"><input name="b"><textarea name="c"></textarea></form>`;
    const form = doc.querySelector('form')!;
    const result = classifyForm(form, 0);
    expect(result.field_count).toBe(3);
  });

  it('does not classify form with ambiguous action as filtered', () => {
    const doc = getDoc();
    doc.body.innerHTML = `<form action="/process"><input name="title"><input name="url"></form>`;
    const form = doc.querySelector('form')!;
    const result = classifyForm(form, 0);
    expect(result.role).toBe('unknown');
    expect(result.filtered).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extension && npx vitest run src/__tests__/FormAnalyzer.test.ts`
Expected: FAIL — `classifyForm` is not exported

- [ ] **Step 3: Implement `classifyForm()` and `FormGroup` type**

In `extension/src/agent/FormAnalyzer.ts`, add after the existing type definitions:

```typescript
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
```

Then add the `classifyForm()` function. Place it right before the `analyzeForms()` function:

```typescript
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
  if (hasPassword) {
    return { form_index: formIndex, role: 'login', confidence: 'high', form_id: id, form_action: action, field_count: fieldCount, filtered: true };
  }
  if (action && (action.includes('/login') || action.includes('/signin') || action.includes('/auth'))) {
    // Only classify as login if action is clearly auth-related (high confidence)
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extension && npx vitest run src/__tests__/FormAnalyzer.test.ts`
Expected: All tests PASS (both existing and new `classifyForm` tests)

- [ ] **Step 5: Commit**

```bash
git add extension/src/agent/FormAnalyzer.ts extension/src/__tests__/FormAnalyzer.test.ts
git commit -m "feat: add form role classification (classifyForm)"
```

---

### Task 2: Integrate `classifyForm()` into `analyzeForms()` and update return type

**Files:**
- Modify: `extension/src/agent/FormAnalyzer.ts`
- Modify: `extension/src/__tests__/FormAnalyzer.test.ts`

- [ ] **Step 1: Write failing tests for multi-form filtering in `analyzeForms()`**

Add these tests to the existing `describe('FormAnalyzer', ...)` block:

```typescript
  it('filters out search form and returns only target form fields', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <form role="search">
        <input type="text" name="q">
      </form>
      <form id="submit-form" action="/submit">
        <input type="text" name="product_name" placeholder="Product Name">
        <input type="url" name="url" placeholder="Website URL">
      </form>
    `;
    const result = analyzeForms(doc);
    // Search form filtered, only submit-form fields remain
    expect(result.fields).toHaveLength(2);
    expect(result.fields[0].name).toBe('product_name');
    expect(result.fields[1].name).toBe('url');
    // forms array has both
    expect(result.forms).toHaveLength(2);
    expect(result.forms[0].role).toBe('search');
    expect(result.forms[0].filtered).toBe(true);
    expect(result.forms[1].role).toBe('unknown');
    expect(result.forms[1].filtered).toBe(false);
  });

  it('filters out login and newsletter forms', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <form action="/login">
        <input name="email">
        <input type="password" name="password">
      </form>
      <form action="/subscribe">
        <input type="email" name="newsletter_email">
      </form>
      <form action="/submit-tool">
        <input name="tool_name">
        <textarea name="description"></textarea>
      </form>
    `;
    const result = analyzeForms(doc);
    expect(result.fields).toHaveLength(2);
    expect(result.fields[0].name).toBe('tool_name');
    expect(result.fields[1].name).toBe('description');
    expect(result.forms).toHaveLength(3);
    expect(result.forms[0].role).toBe('login');
    expect(result.forms[1].role).toBe('newsletter');
    expect(result.forms[2].role).toBe('unknown');
  });

  it('preserves all fields when no forms are classified as irrelevant', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <form action="/submit">
        <input name="name">
      </form>
      <form action="/add-listing">
        <input name="title">
        <input name="url">
      </form>
    `;
    const result = analyzeForms(doc);
    expect(result.fields).toHaveLength(3);
    expect(result.forms).toHaveLength(2);
    expect(result.forms[0].filtered).toBe(false);
    expect(result.forms[1].filtered).toBe(false);
  });

  it('returns empty forms array when no <form> tags exist (body fallback)', () => {
    const doc = getDoc();
    doc.body.innerHTML = `<input name="username"><input name="password">`;
    const result = analyzeForms(doc);
    expect(result.fields).toHaveLength(2);
    expect(result.forms).toHaveLength(0);
  });

  it('attaches form_index to each field from a <form> element', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <form role="search">
        <input name="q">
      </form>
      <form id="target">
        <input name="name">
        <input name="email">
      </form>
    `;
    const result = analyzeForms(doc);
    // Only target form fields remain, both with form_index=1
    expect(result.fields).toHaveLength(2);
    expect(result.fields[0].form_index).toBe(1);
    expect(result.fields[1].form_index).toBe(1);
  });

  it('does not attach form_index to fields from body fallback scan', () => {
    const doc = getDoc();
    doc.body.innerHTML = `<input name="username">`;
    const result = analyzeForms(doc);
    expect(result.fields[0].form_index).toBeUndefined();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extension && npx vitest run src/__tests__/FormAnalyzer.test.ts`
Expected: FAIL — `result.forms` is undefined, `result.fields` includes search form fields

- [ ] **Step 3: Modify `FormAnalysisResult` and `FormField` types**

In `FormAnalyzer.ts`, update the `FormField` interface to add `form_index`:

```typescript
export interface FormField {
  canonical_id: string;
  name: string;
  id: string;
  type: string;
  label: string;
  placeholder: string;
  required: boolean;
  maxlength: number | null;
  inferred_purpose?: string;
  effective_type?: string;
  selector: string;
  tagName: string;
  form_index?: number;  // NEW: which form this field belongs to
}
```

Update `FormAnalysisResult` to include `forms`:

```typescript
export interface FormAnalysisResult {
  fields: FormField[];
  forms: FormGroup[];   // NEW: all form metadata (including filtered)
  page_info: PageInfo;
}
```

- [ ] **Step 4: Modify `analyzeForms()` to classify and filter forms**

Replace the current `analyzeForms()` function. The key changes:

1. Collect `<form>` elements and classify each with `classifyForm()`
2. Build a `Set<number>` of filtered form indices
3. When iterating form elements for fields, skip filtered forms
4. Attach `form_index` to each field from a `<form>` element
5. Return `forms` array in the result

```typescript
export function analyzeForms(doc: Document): FormAnalysisResult {
  const fields: FormField[] = [];
  let fieldIndex = 0;

  const formElements = Array.from(doc.querySelectorAll('form'));
  const formGroups: FormGroup[] = formElements.map((formEl, i) => classifyForm(formEl, i));
  const filteredIndices = new Set<number>(
    formGroups.filter(g => g.filtered).map(g => g.form_index)
  );

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
      const type =
        tag === 'select'
          ? 'select'
          : ((el as HTMLInputElement).type?.toLowerCase() || tag);

      const label = findLabel(doc, htmlEl);
      const placeholder = (el as HTMLInputElement).placeholder || '';
      const required = (el as HTMLInputElement).required || false;
      const maxlength = (el as HTMLInputElement).maxLength || null;
      const effectiveMaxlength =
        maxlength !== null && maxlength >= 0 ? maxlength : null;

      let selector = buildSelector(htmlEl);
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

    // Also check for contenteditable elements
    {
      const editables = root.querySelectorAll('[contenteditable="true"]');
      for (const el of editables) {
        if (!isFormField(el)) continue;

        const htmlEl = el as HTMLElement;
        const label = findLabel(doc, htmlEl);
        const ariaLabel = el.getAttribute('aria-label') || '';

        let ceSelector = buildSelector(htmlEl);
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
    fields,
    forms: formGroups,
    page_info: extractPageInfo(doc),
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd extension && npx vitest run src/__tests__/FormAnalyzer.test.ts`
Expected: All tests PASS (existing tests still pass because they have single forms with no filtering)

- [ ] **Step 6: Commit**

```bash
git add extension/src/agent/FormAnalyzer.ts extension/src/__tests__/FormAnalyzer.test.ts
git commit -m "feat: integrate form filtering into analyzeForms()"
```

---

### Task 3: Add `buildFieldList()` helper for grouped field rendering

**Files:**
- Modify: `extension/src/agent/FormAnalyzer.ts`
- Test: `extension/src/__tests__/FormAnalyzer.test.ts`

- [ ] **Step 1: Write failing tests for `buildFieldList()`**

```typescript
describe('buildFieldList', () => {
  let buildFieldList: typeof import('@/agent/FormAnalyzer').buildFieldList;

  beforeEach(async () => {
    const mod = await import('@/agent/FormAnalyzer');
    buildFieldList = mod.buildFieldList;
  });

  it('renders single unfiltered form with header', () => {
    const fields: FormField[] = [
      { canonical_id: 'field_0', name: 'name', id: '', type: 'text', label: 'Name', placeholder: '', required: true, maxlength: null, selector: '', tagName: 'input', form_index: 0 },
    ];
    const forms: FormGroup[] = [
      { form_index: 0, role: 'unknown', confidence: 'low', form_id: 'submit', form_action: '/submit', field_count: 1, filtered: false },
    ];
    const result = buildFieldList(fields, forms);
    expect(result).toContain('[Form 1] id="submit" action="/submit"');
    expect(result).toContain('field_0: type=text, label="Name", required');
    expect(result).not.toContain('filtered');
  });

  it('renders filtered forms as single-line summaries', () => {
    const fields: FormField[] = [
      { canonical_id: 'field_0', name: 'product', id: '', type: 'text', label: 'Product', placeholder: '', required: true, maxlength: null, selector: '', tagName: 'input', form_index: 1 },
    ];
    const forms: FormGroup[] = [
      { form_index: 0, role: 'search', confidence: 'high', form_id: undefined, form_action: '/search', field_count: 1, filtered: true },
      { form_index: 1, role: 'unknown', confidence: 'low', form_id: 'target', form_action: '/submit', field_count: 1, filtered: false },
    ];
    const result = buildFieldList(fields, forms);
    expect(result).toContain('[Form 1] role=search — 1 field (filtered)');
    expect(result).toContain('[Form 2] id="target" action="/submit" — 1 field');
    expect(result).toContain('field_0: type=text, label="Product", required');
  });

  it('handles empty forms array gracefully (body fallback)', () => {
    const fields: FormField[] = [
      { canonical_id: 'field_0', name: 'name', id: '', type: 'text', label: 'Name', placeholder: '', required: true, maxlength: null, selector: '', tagName: 'input' },
    ];
    const result = buildFieldList(fields, []);
    // Should render fields without form grouping
    expect(result).toContain('field_0: type=text, label="Name", required');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extension && npx vitest run src/__tests__/FormAnalyzer.test.ts`
Expected: FAIL — `buildFieldList` is not exported

- [ ] **Step 3: Implement `buildFieldList()`**

Add to `FormAnalyzer.ts` after `classifyForm()`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extension && npx vitest run src/__tests__/FormAnalyzer.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add extension/src/agent/FormAnalyzer.ts extension/src/__tests__/FormAnalyzer.test.ts
git commit -m "feat: add buildFieldList() for grouped field rendering"
```

---

### Task 4: Update prompt builders to use grouped field list and filter rule

**Files:**
- Modify: `extension/src/agent/prompts/directory-submit-prompt.ts`
- Modify: `extension/src/agent/prompts/blog-comment-prompt.ts`

- [ ] **Step 1: Update `DirectorySubmitPromptInput` and `buildDirectorySubmitPrompt()`**

In `directory-submit-prompt.ts`:

1. Add `FormGroup` import and extend the input interface
2. Replace inline field list with `buildFieldList()`
3. Insert filter rule as Rule #1

```typescript
import type { FormField } from '../FormAnalyzer'
import type { PageInfo, FormGroup } from '../FormAnalyzer'
import { buildFieldList } from '../FormAnalyzer'

export interface DirectorySubmitPromptInput {
  productContext: string
  pageInfo: PageInfo
  fields: FormField[]
  forms: FormGroup[]    // NEW
}

export function buildDirectorySubmitPrompt(input: DirectorySubmitPromptInput): string {
  const { productContext, pageInfo, fields, forms } = input

  const fieldList = buildFieldList(fields, forms)

  // ... keep example unchanged ...

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
```

- [ ] **Step 2: Update `BlogCommentPromptInput` and `buildBlogCommentPrompt()`**

In `blog-comment-prompt.ts`:

```typescript
import type { PageContent } from '../PageContentExtractor'
import type { FormField, FormGroup } from '../FormAnalyzer'
import { buildFieldList } from '../FormAnalyzer'

export interface BlogCommentPromptInput {
  productContext: string
  pageContent: PageContent
  fields: FormField[]
  forms: FormGroup[]    // NEW
}

export function buildBlogCommentPrompt(input: BlogCommentPromptInput): string {
  const { productContext, pageContent, fields, forms } = input

  const fieldList = buildFieldList(fields, forms)

  // ... keep examples unchanged ...

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
    '1. The page may contain multiple forms. Only fill fields from the target comment form (marked with [Form N] above). Ignore any forms marked as "filtered" — these are unrelated forms and should NOT receive any values. Your comment and personal info go into the comment form only.',
    '2. Read the page content carefully and write a relevant, authentic-sounding comment (not generic praise).',
    // ... remaining rules renumbered 3-8 ...
    '3. Comment structure: ~30 chars of genuine value affirmation + ~50 chars of supplementary insight. Naturally weave in the product name or a relevant keyword as part of the comment.',
    '4. Link placement priority (follow this order):',
    '   - FIRST: "URL" / "website" / "homepage" field → fill with the product URL directly.',
    '   - SECOND: "name" / "author" field → use the product name (or a keyword from the product tagline) as the display name. This is the preferred anchor text strategy.',
    '   - FALLBACK: If neither a URL/website field nor a name/author field exists, place the link in the comment body using HTML: `<a href="{product_url}" rel="dofollow">{keyword}</a>`. The link text must be semantically coherent with the comment content.',
    '5. If placing a link in the comment body (fallback only):',
    '   - Use HTML format: `<a href="{product_url}" rel="dofollow">{keyword}</a>`',
    '   - The keyword must naturally relate to the surrounding comment text',
    '   - Do NOT use promotional phrases like "best tool", "must try", "highly recommend", etc.',
    '6. For the "email" field: use the founder email from product data if available, otherwise leave empty.',
    '7. Fill all required fields. For optional fields, only fill if the product data has relevant information.',
    '8. All text should be in the same language as the page content.',
    '9. The comment must feel like a genuine contribution — no spam, no generic praise, no overt promotion. The goal is for the comment to be approved by the blog owner.',
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
```

- [ ] **Step 3: Update `FormFillEngine.ts` to pass `forms` to prompt builders**

In `FormFillEngine.ts`, update the two prompt builder calls around line 165-169:

```typescript
// Before:
systemPrompt = buildBlogCommentPrompt({ productContext, pageContent, fields: analysis.fields })
// After:
systemPrompt = buildBlogCommentPrompt({ productContext, pageContent, fields: analysis.fields, forms: analysis.forms })

// Before:
systemPrompt = buildDirectorySubmitPrompt({ productContext, pageInfo: analysis.page_info, fields: analysis.fields })
// After:
systemPrompt = buildDirectorySubmitPrompt({ productContext, pageInfo: analysis.page_info, fields: analysis.fields, forms: analysis.forms })
```

- [ ] **Step 4: Run all tests**

Run: `cd extension && npx vitest run`
Expected: All tests PASS

- [ ] **Step 5: Build to verify no type errors**

Run: `cd extension && npx wxt build`
Expected: Build succeeds with no errors

- [ ] **Step 6: Commit**

```bash
git add extension/src/agent/prompts/directory-submit-prompt.ts extension/src/agent/prompts/blog-comment-prompt.ts extension/src/agent/FormFillEngine.ts
git commit -m "feat: use grouped field list and filter rules in prompts"
```

---

### Task 5: Add same-form priority to fuzzy matching

**Files:**
- Modify: `extension/src/agent/FormFillEngine.ts`
- Test: `extension/src/__tests__/FormAnalyzer.test.ts` (or a new `FormFillEngine.test.ts` if it exists)

- [ ] **Step 1: Write failing test for same-form fuzzy matching**

The fuzzy matching function is not currently exported. Export it and add a test. Add to a new test block in the existing test file, or create `extension/src/__tests__/FormFillEngine.test.ts` if you prefer isolation. For simplicity, add to `FormAnalyzer.test.ts` in a new `describe` block at the end (since `fuzzyMatchField` depends on `FormField` from `FormAnalyzer`):

Actually, `fuzzyMatchField` is a private function in `FormFillEngine.ts`. Instead of exporting it, we test the behavior indirectly. But the spec says to test directly. The simplest approach: export `fuzzyMatchField` from `FormFillEngine.ts` and test it.

Add to `extension/src/__tests__/FormFillEngine.test.ts` (new file):

```typescript
import { describe, it, expect } from 'vitest';
import { fuzzyMatchField } from '@/agent/FormFillEngine';
import type { FormField } from '@/agent/FormAnalyzer';

describe('fuzzyMatchField', () => {
  const fields: FormField[] = [
    { canonical_id: 'field_0', name: 'q', id: '', type: 'text', label: 'Search', placeholder: '', required: false, maxlength: null, selector: '#q', tagName: 'input', form_index: 0 },
    { canonical_id: 'field_1', name: 'product_name', id: '', type: 'text', label: 'Product Name', placeholder: '', required: true, maxlength: null, selector: '#pname', tagName: 'input', form_index: 1 },
    { canonical_id: 'field_2', name: 'email', id: '', type: 'email', label: 'Email', placeholder: '', required: true, maxlength: null, selector: '#email', tagName: 'input', form_index: 1 },
  ];

  it('prefers same-form match over cross-form match', () => {
    const used = new Set<string>();
    // "name" could match field_0's label "Search" or field_1's label "Product Name"
    // field_1 is in form_index=1, field_0 is in form_index=0
    // When searching from form_index=1 context, should prefer field_1
    const result = fuzzyMatchField('name', fields, used, 1);
    expect(result?.canonical_id).toBe('field_1');
  });

  it('falls back to global match when no same-form match exists', () => {
    const used = new Set<string>();
    const result = fuzzyMatchField('search', fields, used, 1);
    // No field in form_index=1 matches "search", so falls back to field_0 in form_index=0
    expect(result?.canonical_id).toBe('field_0');
  });

  it('skips already-used fields', () => {
    const used = new Set<string>(['field_1']);
    const result = fuzzyMatchField('name', fields, used, 1);
    // field_1 is used, should fall back to field_0 or return null
    // field_0 label "Search" doesn't contain "name" — actually it doesn't match
    // So this should return null
    expect(result).toBeNull();
  });

  it('works without form_index (backward compatibility)', () => {
    const noFormIndexFields: FormField[] = [
      { canonical_id: 'field_0', name: 'product_name', id: '', type: 'text', label: 'Product Name', placeholder: '', required: true, maxlength: null, selector: '#pname', tagName: 'input' },
    ];
    const used = new Set<string>();
    const result = fuzzyMatchField('name', noFormIndexFields, used);
    expect(result?.canonical_id).toBe('field_0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extension && npx vitest run src/__tests__/FormFillEngine.test.ts`
Expected: FAIL — `fuzzyMatchField` is not exported, and signature doesn't accept `formIndex`

- [ ] **Step 3: Export and update `fuzzyMatchField()` in `FormFillEngine.ts`**

Add a new optional `formIndex` parameter. Modify the existing function:

```typescript
export function fuzzyMatchField(
  llmKey: string,
  fields: FormAnalysisResult['fields'],
  usedCanonicalIds: Set<string>,
  formIndex?: number,
): FormAnalysisResult['fields'][number] | null {
  const key = normalizeKey(llmKey)

  // Phase 1: Try same-form match first
  if (formIndex !== undefined) {
    for (const field of fields) {
      if (usedCanonicalIds.has(field.canonical_id)) continue
      if (field.form_index !== formIndex) continue
      if (matchesField(key, field)) return field
    }
  }

  // Phase 2: Fall back to global match
  for (const field of fields) {
    if (usedCanonicalIds.has(field.canonical_id)) continue
    if (matchesField(key, field)) return field
  }

  return null
}

function matchesField(key: string, field: FormAnalysisResult['fields'][number]): boolean {
  const identifiers = [
    field.canonical_id,
    field.name,
    field.id,
    field.label,
    field.placeholder,
    field.inferred_purpose,
  ]

  for (const id of identifiers) {
    if (!id) continue
    const norm = normalizeKey(id)
    if (norm === key || norm.includes(key) || key.includes(norm)) {
      return true
    }
  }
  return false
}
```

Update the call site in the fuzzy match fallback block (~line 220):

```typescript
// Before:
const matched = fuzzyMatchField(llmKey, analysis.fields, usedCanonicalIds)
// After:
const matched = fuzzyMatchField(llmKey, analysis.fields, usedCanonicalIds)
// Note: no formIndex passed here since we don't know which form the LLM key belongs to
// This is fine — global fallback is appropriate for the exact-match-failure path
```

- [ ] **Step 4: Run all tests**

Run: `cd extension && npx vitest run`
Expected: All tests PASS

- [ ] **Step 5: Build to verify no type errors**

Run: `cd extension && npx wxt build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add extension/src/agent/FormFillEngine.ts extension/src/__tests__/FormFillEngine.test.ts
git commit -m "feat: add same-form priority to fuzzy matching"
```

---

### Task 6: Full integration verification

- [ ] **Step 1: Run all tests**

Run: `cd extension && npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Build production bundle**

Run: `cd extension && npx wxt build`
Expected: Build succeeds, no type errors, no warnings

- [ ] **Step 3: Manual smoke test (optional but recommended)**

1. Load `extension/.output/chrome-mv3/` as unpacked extension
2. Navigate to a page with multiple forms (e.g. a directory site with a search bar)
3. Click the float button and trigger form fill
4. Verify in the sidepanel log that filtered forms are reported and only target fields are sent to LLM
