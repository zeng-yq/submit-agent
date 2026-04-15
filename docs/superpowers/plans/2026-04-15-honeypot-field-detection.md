# Honeypot Field Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Filter honeypot (anti-spam trap) fields from form analysis so they never reach the LLM prompt or UI.

**Architecture:** Two-layer filtering. Layer 1 adds `isHoneypotField()` and enhances `isVisible()` in `dom-utils.ts`. Layer 2 adds `deduplicateFields()` in `FormAnalyzer.ts` to catch same-label different-type pairs. Both layers use TDD.

**Tech Stack:** TypeScript, Vitest, JSDOM

---

### Task 1: Add `isHoneypotField()` to `dom-utils.ts`

**Files:**
- Modify: `extension/src/agent/dom-utils.ts` (add function after `isCaptchaElement`, insert call in `isFormField`)
- Create: `extension/src/__tests__/dom-utils.test.ts`

- [ ] **Step 1: Write failing tests for `isHoneypotField`**

Create `extension/src/__tests__/dom-utils.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

let dom: JSDOM;

describe('isHoneypotField', () => {
  let isHoneypotField: typeof import('@/agent/dom-utils').isHoneypotField;

  beforeEach(async () => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      runScripts: 'dangerously',
      url: 'https://example.com',
    });
    const mod = await import('@/agent/dom-utils');
    isHoneypotField = mod.isHoneypotField;
  });

  function el(html: string): Element {
    const doc = dom.window.document;
    doc.body.innerHTML = html;
    return doc.body.firstElementChild!;
  }

  it('detects aria-hidden="true"', () => {
    expect(isHoneypotField(el('<input aria-hidden="true" name="x">'))).toBe(true);
  });

  it('does not flag aria-hidden="false"', () => {
    expect(isHoneypotField(el('<input aria-hidden="false" name="x">'))).toBe(false);
  });

  it('detects name containing "honeypot"', () => {
    expect(isHoneypotField(el('<input name="ak_hp_text" value="">'))).toBe(true);
  });

  it('detects id containing "honeypot"', () => {
    expect(isHoneypotField(el('<input id="honeypot_field" name="x">'))).toBe(true);
  });

  it('detects class containing "trap"', () => {
    expect(isHoneypotField(el('<input class="trap-field" name="x">'))).toBe(true);
  });

  it('does not flag normal field without honeypot signals', () => {
    expect(isHoneypotField(el('<input name="website" type="url">'))).toBe(false);
  });

  it('does not flag field with label containing "trap" in real word', () => {
    // Element with a real label should not be flagged even if name contains "trap"
    // when it has a parent label — but since isHoneypotField only checks the element,
    // we test the name-signal path: no label resolved yet
    expect(isHoneypotField(el('<input name="trapdoor" type="text">'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extension && npx vitest run src/__tests__/dom-utils.test.ts`
Expected: FAIL — `isHoneypotField` is not exported

- [ ] **Step 3: Implement `isHoneypotField` and update `isFormField`**

In `extension/src/agent/dom-utils.ts`, add after the `isCaptchaElement` function (after line 133):

```typescript
/** Honeypot-related substrings to check in name/id/class attributes. */
const HONEYPOT_NAME_SIGNALS = ['honeypot', 'hp_', 'ak_hp', 'trap', 'cloaked'];

/** Check if an element is a honeypot (anti-spam trap) field. */
export function isHoneypotField(el: Element): boolean {
  const htmlEl = el as HTMLElement;

  // Rule 1: aria-hidden="true"
  if (htmlEl.getAttribute('aria-hidden') === 'true') return true;

  // Rule 2: name/id/class contains honeypot-related keywords
  const name = (htmlEl.getAttribute('name') || '').toLowerCase();
  const id = (htmlEl.getAttribute('id') || '').toLowerCase();
  const cls = (htmlEl.getAttribute('class') || '').toLowerCase();
  const combined = `${name} ${id} ${cls}`;
  if (HONEYPOT_NAME_SIGNALS.some(s => combined.includes(s))) return true;

  // Rule 3: Label contains only non-alphanumeric characters (e.g. Δ)
  // We check aria-label and title as cheap label proxies since findLabel requires doc context
  const ariaLabel = htmlEl.getAttribute('aria-label') || '';
  const title = htmlEl.getAttribute('title') || '';
  const cheapLabel = ariaLabel || title;
  if (cheapLabel && !/[a-zA-Z0-9]/.test(cheapLabel)) return true;

  // Rule 4: tabindex < 0 and no label signals
  const tabindex = htmlEl.getAttribute('tabindex');
  if (tabindex !== null && parseInt(tabindex, 10) < 0 && !ariaLabel && !title && !htmlEl.id) return true;

  // Rule 5: autocomplete="off" and no label and non-standard name
  if (htmlEl.getAttribute('autocomplete') === 'off' && !ariaLabel && !title && !htmlEl.id) return true;

  return false;
}
```

Then update `isFormField` to call `isHoneypotField` after `isCaptchaElement` (line 166 area). Change the existing `isFormField` to:

```typescript
export function isFormField(el: Element): boolean {
  const tag = el.tagName.toLowerCase();

  // Check for CAPTCHA first
  if (isCaptchaElement(el)) return false;

  // Check for honeypot (anti-spam trap) fields
  if (isHoneypotField(el)) return false;

  // Skip elements that are visually hidden via CSS
  if (!isVisible(el)) return false;

  if (tag === 'input') {
    const type = (el as HTMLInputElement).type?.toLowerCase() || 'text';
    if (SKIP_INPUT_TYPES.has(type)) return false;
    return true;
  }

  if (tag === 'textarea' || tag === 'select') return true;

  // contenteditable elements (but not the ones used by rich text editors for layout)
  if ((el as HTMLElement).isContentEditable) {
    const role = el.getAttribute('role');
    if (role === 'textbox') return true;
    // Accept explicit contenteditable inside form or comment context
    // (wpDiscuz and similar plugins use contenteditable divs without role="textbox")
    if (el.hasAttribute('contenteditable')) {
      if (el.closest('form, .comment-form, #respond, #commentform, .wpd_comm_form, .wpd-form, .wpdiscuz-textarea-wrap, #wpdcom, [class*="comment-form"], [id*="comment-form"]')) {
        return true;
      }
    }
    // Skip generic contenteditable divs without a form context
    return false;
  }

  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extension && npx vitest run src/__tests__/dom-utils.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extension/src/agent/dom-utils.ts extension/src/__tests__/dom-utils.test.ts
git commit -m "feat: add isHoneypotField() for DOM-layer honeypot detection"
```

---

### Task 2: Enhance `isVisible()` for off-screen and clipping detection

**Files:**
- Modify: `extension/src/agent/dom-utils.ts` (enhance `isVisible`)
- Modify: `extension/src/__tests__/dom-utils.test.ts` (add tests)

- [ ] **Step 1: Write failing tests for enhanced `isVisible`**

Add to `extension/src/__tests__/dom-utils.test.ts`, inside the `describe('isHoneypotField', ...)` block's sibling — create a new `describe('isVisible', ...)`:

```typescript
describe('isVisible', () => {
  let isVisible: typeof import('@/agent/dom-utils').isVisible;

  beforeEach(async () => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      runScripts: 'dangerously',
      url: 'https://example.com',
    });
    const mod = await import('@/agent/dom-utils');
    isVisible = mod.isVisible;
  });

  function el(html: string): Element {
    const doc = dom.window.document;
    doc.body.innerHTML = html;
    return doc.body.firstElementChild!;
  }

  it('returns true for normally visible element', () => {
    expect(isVisible(el('<input name="x">'))).toBe(true);
  });
});
```

> **Note on JSDOM limitation:** JSDOM has no layout engine, so `getComputedStyle` for positioning (`left`, `top`) and `clip` returns empty defaults. Off-screen and clipping checks cannot be unit-tested in JSDOM. They are verified through manual browser testing and real-world usage.

- [ ] **Step 2: Enhance `isVisible()` implementation**

In `extension/src/agent/dom-utils.ts`, replace the `isVisible` function (lines 146-159) with:

```typescript
/** Check if an element is visually visible on the page. */
export function isVisible(el: Element): boolean {
  const htmlEl = el as HTMLElement;
  const style = window.getComputedStyle(htmlEl);
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  if (parseFloat(style.opacity) === 0) return false;

  // Off-screen positioning: absolute/fixed with coordinate far outside viewport
  const position = style.position;
  if (position === 'absolute' || position === 'fixed') {
    const coords = ['left', 'top', 'right', 'bottom'] as const;
    for (const prop of coords) {
      const val = parseFloat(style[prop]);
      if (!isNaN(val) && val < -500) return false;
    }
  }

  // CSS clipping: clip or clip-path that hides the element
  const clip = style.clip;
  if (clip && clip !== 'auto' && /^(rect|inset)\s*\(.*0.*,\s*0.*,\s*0.*,\s*0/i.test(clip)) return false;
  const clipPath = style.clipPath;
  if (clipPath && clipPath !== 'none' && /inset\s*\(\s*100%\s*\)/.test(clipPath)) return false;

  // Dimension check only in real browsers (JSDOM has no layout engine,
  // so offsetWidth/Height are always 0 — use body as a canary)
  const body = htmlEl.ownerDocument.body;
  if (body && (body.offsetWidth || body.offsetHeight || body.getClientRects().length)) {
    if (!htmlEl.offsetWidth && !htmlEl.offsetHeight && !htmlEl.getClientRects().length) return false;
  }
  return true;
}
```

- [ ] **Step 3: Run all tests**

Run: `cd extension && npx vitest run`
Expected: All existing tests PASS (no regressions) + new `isVisible` tests PASS

- [ ] **Step 4: Commit**

```bash
git add extension/src/agent/dom-utils.ts extension/src/__tests__/dom-utils.test.ts
git commit -m "feat: enhance isVisible() to detect off-screen and clipped elements"
```

---

### Task 3: Add `deduplicateFields()` to `FormAnalyzer.ts`

**Files:**
- Modify: `extension/src/agent/FormAnalyzer.ts` (add `deduplicateFields`, call in `analyzeForms`)
- Modify: `extension/src/__tests__/FormAnalyzer.test.ts` (add integration tests)

- [ ] **Step 1: Write failing integration tests**

Add to `extension/src/__tests__/FormAnalyzer.test.ts`, inside the first `describe('FormAnalyzer', ...)` block, after the existing tests:

```typescript
  it('removes duplicate textarea when same label as input (honeypot pattern)', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <form>
        <label for="comment">Comment</label>
        <textarea id="comment" name="comment"></textarea>
        <label for="name">Name</label>
        <input type="text" id="name" name="author">
        <label for="email">Email</label>
        <input type="email" id="email" name="email">
        <label for="url">Website</label>
        <input type="url" id="url" name="url">
        <textarea name="url" aria-label="Website"></textarea>
      </form>
    `;
    const result = analyzeForms(doc);
    // Should have 4 fields: comment, name, email, url (the duplicate textarea "Website" removed)
    expect(result.fields).toHaveLength(4);
    expect(result.fields.some(f => f.type === 'textarea' && f.label === 'Website')).toBe(false);
    expect(result.fields.some(f => f.type === 'url' && f.label === 'Website')).toBe(true);
  });

  it('preserves all fields when no duplicates exist', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <form>
        <label for="name">Name</label>
        <input type="text" id="name" name="name">
        <label for="email">Email</label>
        <input type="email" id="email" name="email">
        <label for="msg">Message</label>
        <textarea id="msg" name="message"></textarea>
      </form>
    `;
    const result = analyzeForms(doc);
    expect(result.fields).toHaveLength(3);
  });

  it('removes second field when both have same type and same label', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <form>
        <label for="name1">Name</label>
        <input type="text" id="name1" name="name">
        <label for="name2">Name</label>
        <input type="text" id="name2" name="name_copy">
      </form>
    `;
    const result = analyzeForms(doc);
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].id).toBe('name1');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extension && npx vitest run src/__tests__/FormAnalyzer.test.ts`
Expected: FAIL — duplicate fields are not removed

- [ ] **Step 3: Implement `deduplicateFields`**

In `extension/src/agent/FormAnalyzer.ts`, add before the `analyzeForms` function:

```typescript
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
```

Then update `analyzeForms` to call `deduplicateFields`. Find the return statement (line 517-521):

```typescript
  return {
    fields,
    forms: formGroups,
    page_info: extractPageInfo(doc),
  };
```

Replace with:

```typescript
  return {
    fields: deduplicateFields(fields),
    forms: formGroups,
    page_info: extractPageInfo(doc),
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extension && npx vitest run src/__tests__/FormAnalyzer.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite**

Run: `cd extension && npx vitest run`
Expected: All tests PASS across both test files

- [ ] **Step 6: Commit**

```bash
git add extension/src/agent/FormAnalyzer.ts extension/src/__tests__/FormAnalyzer.test.ts
git commit -m "feat: add deduplicateFields() to remove honeypot duplicate fields"
```

---

### Task 4: Verify no regressions with full test suite

**Files:** None (testing only)

- [ ] **Step 1: Run full test suite**

Run: `cd extension && npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Build the extension**

Run: `cd extension && npm run build`
Expected: Build succeeds with no errors
