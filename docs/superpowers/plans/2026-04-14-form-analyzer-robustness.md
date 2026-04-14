# Form Analyzer Robustness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make form field label resolution and type inference robust across modern web forms (SPA, custom form builders, non-semantic HTML).

**Architecture:** Extend `findLabel()` with 3 new DOM patterns, add heuristic `inferFieldPurpose()` and `inferEffectiveType()` functions, separate label/placeholder/inferred_purpose in LLM prompts so the model sees all signals instead of a misleading fallback chain.

**Tech Stack:** TypeScript, Vitest, JSDOM, Chrome Extension (WXT)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `extension/src/agent/FormAnalyzer.ts` | Core: `findLabel()` (7-step), `inferFieldPurpose()`, `inferEffectiveType()`, `analyzeForms()` wiring |
| `extension/src/agent/prompts/directory-submit-prompt.ts` | Prompt: separate label/placeholder/inferred_purpose for directory sites |
| `extension/src/agent/prompts/blog-comment-prompt.ts` | Prompt: same separation for blog comment sites |
| `extension/src/agent/FormFillEngine.ts` | Log: show all signals instead of fallback chain |
| `extension/src/entrypoints/content.ts` | Fix: delay page title read for SPA hydration |
| `extension/src/__tests__/FormAnalyzer.test.ts` | Tests: all new label patterns, inference functions, integration |

---

### Task 1: Extend FormField interface and add `inferFieldPurpose()`

**Files:**
- Modify: `extension/src/agent/FormAnalyzer.ts:8-31` (interface)
- Modify: `extension/src/__tests__/FormAnalyzer.test.ts` (new tests)

- [ ] **Step 1: Write failing tests for `inferFieldPurpose`**

Add these tests to `extension/src/__tests__/FormAnalyzer.test.ts`. Also add the import for the new function at the top of the describe block:

```typescript
let inferFieldPurpose: typeof import('@/agent/FormAnalyzer').inferFieldPurpose;
```

Update `beforeEach` to also import it:
```typescript
beforeEach(async () => {
  dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    runScripts: 'dangerously',
    url: 'https://example.com',
  });
  const mod = await import('@/agent/FormAnalyzer');
  analyzeForms = mod.analyzeForms;
  inferFieldPurpose = mod.inferFieldPurpose;
});
```

Add a new `describe` block after the existing one:

```typescript
describe('inferFieldPurpose', () => {
  it('returns empty string when label is present', () => {
    expect(inferFieldPurpose({ label: 'Name', placeholder: '', name: '', type: 'text' })).toBe('');
  });

  it('infers email from placeholder containing @', () => {
    expect(inferFieldPurpose({ label: '', placeholder: 'your@email.com', name: '', type: 'text' })).toBe('email address');
  });

  it('infers email from placeholder containing "email"', () => {
    expect(inferFieldPurpose({ label: '', placeholder: 'Enter your email', name: '', type: 'text' })).toBe('email address');
  });

  it('infers URL from placeholder containing https://', () => {
    expect(inferFieldPurpose({ label: '', placeholder: 'https://yourtool.com', name: '', type: 'text' })).toBe('website URL');
  });

  it('infers URL from type=url', () => {
    expect(inferFieldPurpose({ label: '', placeholder: '', name: '', type: 'url' })).toBe('website URL');
  });

  it('infers email from name attribute containing "email"', () => {
    expect(inferFieldPurpose({ label: '', placeholder: '', name: 'user_email', type: 'text' })).toBe('email address');
  });

  it('infers URL from name attribute containing "url"', () => {
    expect(inferFieldPurpose({ label: '', placeholder: '', name: 'website_url', type: 'text' })).toBe('website URL');
  });

  it('infers name from name attribute containing "author"', () => {
    expect(inferFieldPurpose({ label: '', placeholder: '', name: 'author_name', type: 'text' })).toBe('name');
  });

  it('infers description from name attribute containing "desc"', () => {
    expect(inferFieldPurpose({ label: '', placeholder: '', name: 'tool_description', type: 'text' })).toBe('description');
  });

  it('infers name from placeholder containing "name"', () => {
    expect(inferFieldPurpose({ label: '', placeholder: 'Your full name', name: '', type: 'text' })).toBe('full name');
  });

  it('returns empty string when no signal matches', () => {
    expect(inferFieldPurpose({ label: '', placeholder: 'something random', name: 'field_42', type: 'text' })).toBe('');
  });

  it('infers phone number from type=tel', () => {
    expect(inferFieldPurpose({ label: '', placeholder: '', name: '', type: 'tel' })).toBe('phone number');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extension && npx vitest run src/__tests__/FormAnalyzer.test.ts`
Expected: FAIL — `inferFieldPurpose` is not exported

- [ ] **Step 3: Add interface fields and implement `inferFieldPurpose`**

In `extension/src/agent/FormAnalyzer.ts`, add two optional fields to the `FormField` interface (after `maxlength`):

```typescript
  inferred_purpose?: string;  // heuristic purpose when label is empty
  effective_type?: string;    // enhanced type for LLM context
```

Then add the `inferFieldPurpose` function after the `findLabel` function (after line 123):

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extension && npx vitest run src/__tests__/FormAnalyzer.test.ts`
Expected: All `inferFieldPurpose` tests PASS, existing tests still PASS

- [ ] **Step 5: Commit**

```bash
git add extension/src/agent/FormAnalyzer.ts extension/src/__tests__/FormAnalyzer.test.ts
git commit -m "feat: add inferFieldPurpose() with heuristic field purpose inference"
```

---

### Task 2: Add `inferEffectiveType()` function

**Files:**
- Modify: `extension/src/agent/FormAnalyzer.ts` (new function)
- Modify: `extension/src/__tests__/FormAnalyzer.test.ts` (new tests)

- [ ] **Step 1: Write failing tests for `inferEffectiveType`**

Add import in the `beforeEach`:
```typescript
let inferEffectiveType: typeof import('@/agent/FormAnalyzer').inferEffectiveType;
```

Update `beforeEach`:
```typescript
inferEffectiveType = mod.inferEffectiveType;
```

Add a new `describe` block:

```typescript
describe('inferEffectiveType', () => {
  it('returns empty string for non-text types', () => {
    expect(inferEffectiveType({ label: '', placeholder: '', name: '', type: 'email' })).toBe('');
  });

  it('returns empty string for text type with no signals', () => {
    expect(inferEffectiveType({ label: '', placeholder: 'something', name: 'field_1', type: 'text' })).toBe('');
  });

  it('infers url from placeholder containing https://', () => {
    expect(inferEffectiveType({ label: '', placeholder: 'https://example.com', name: '', type: 'text' })).toBe('url');
  });

  it('infers url from placeholder containing http://', () => {
    expect(inferEffectiveType({ label: '', placeholder: 'http://example.com', name: '', type: 'text' })).toBe('url');
  });

  it('infers email from label containing "email"', () => {
    expect(inferEffectiveType({ label: 'Email Address', placeholder: '', name: '', type: 'text' })).toBe('email');
  });

  it('infers email from name containing "email"', () => {
    expect(inferEffectiveType({ label: '', placeholder: '', name: 'contact_email', type: 'text' })).toBe('email');
  });

  it('infers tel from combined signals containing "phone"', () => {
    expect(inferEffectiveType({ label: 'Phone', placeholder: '', name: '', type: 'text' })).toBe('tel');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extension && npx vitest run src/__tests__/FormAnalyzer.test.ts`
Expected: FAIL — `inferEffectiveType` is not exported

- [ ] **Step 3: Implement `inferEffectiveType`**

Add after `inferFieldPurpose` in `extension/src/agent/FormAnalyzer.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extension && npx vitest run src/__tests__/FormAnalyzer.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add extension/src/agent/FormAnalyzer.ts extension/src/__tests__/FormAnalyzer.test.ts
git commit -m "feat: add inferEffectiveType() for enhanced type inference"
```

---

### Task 3: Enhance `findLabel()` with 3 new DOM patterns

**Files:**
- Modify: `extension/src/agent/FormAnalyzer.ts:87-123` (`findLabel` function)
- Modify: `extension/src/__tests__/FormAnalyzer.test.ts` (new tests)

- [ ] **Step 1: Write failing tests for the 3 new label patterns**

Add these tests inside the existing `describe('FormAnalyzer', ...)` block:

```typescript
it('finds label via title attribute', () => {
  const doc = getDoc();
  doc.body.innerHTML = `
    <form>
      <input type="text" name="search" title="Search keywords">
    </form>
  `;

  const result = analyzeForms(doc);

  expect(result.fields[0].label).toBe('Search keywords');
});

it('finds label via adjacent sibling <label> without for attribute', () => {
  const doc = getDoc();
  doc.body.innerHTML = `
    <form>
      <label>Tool Name</label>
      <input type="text" name="tool_name" placeholder="Enter tool name">
    </form>
  `;

  const result = analyzeForms(doc);

  expect(result.fields[0].label).toBe('Tool Name');
});

it('finds label via parent container text (span before input)', () => {
  const doc = getDoc();
  doc.body.innerHTML = `
    <form>
      <div class="form-group">
        <span class="field-label">Website URL</span>
        <input type="text" name="website" placeholder="https://example.com">
      </div>
    </form>
  `;

  const result = analyzeForms(doc);

  expect(result.fields[0].label).toBe('Website URL');
});

it('finds label via parent container text (div before input)', () => {
  const doc = getDoc();
  doc.body.innerHTML = `
    <form>
      <div class="form-group">
        <div class="label-text">Company Name</div>
        <input type="text" name="company">
        <div class="help-text">Enter your company</div>
      </div>
    </form>
  `;

  const result = analyzeForms(doc);

  expect(result.fields[0].label).toBe('Company Name');
});

it('real-world pattern: Next.js form with sibling labels', () => {
  const doc = getDoc();
  doc.body.innerHTML = `
    <form>
      <div>
        <label>Tool Name</label>
        <input type="text" name="tool_name" placeholder="Enter your tool name">
      </div>
      <div>
        <label>Tool URL</label>
        <input type="text" name="tool_url" placeholder="https://yourtool.com">
      </div>
      <div>
        <label>Description</label>
        <textarea name="description" placeholder="Provide a detailed description..."></textarea>
      </div>
      <div>
        <label>Contact Name</label>
        <input type="text" name="contact_name" placeholder="Your full name">
      </div>
      <div>
        <label>Contact Email</label>
        <input type="email" name="contact_email" placeholder="your@email.com">
      </div>
    </form>
  `;

  const result = analyzeForms(doc);

  expect(result.fields).toHaveLength(5);
  expect(result.fields[0].label).toBe('Tool Name');
  expect(result.fields[1].label).toBe('Tool URL');
  expect(result.fields[2].label).toBe('Description');
  expect(result.fields[3].label).toBe('Contact Name');
  expect(result.fields[4].label).toBe('Contact Email');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extension && npx vitest run src/__tests__/FormAnalyzer.test.ts`
Expected: New tests FAIL (labels resolve to empty string)

- [ ] **Step 3: Add 3 new steps to `findLabel()`**

Replace the `findLabel` function in `extension/src/agent/FormAnalyzer.ts` (lines 87-123) with:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extension && npx vitest run src/__tests__/FormAnalyzer.test.ts`
Expected: All PASS (new + existing)

- [ ] **Step 5: Commit**

```bash
git add extension/src/agent/FormAnalyzer.ts extension/src/__tests__/FormAnalyzer.test.ts
git commit -m "feat: enhance findLabel() with title, sibling, and parent-container patterns"
```

---

### Task 4: Wire up `inferFieldPurpose()` and `inferEffectiveType()` in `analyzeForms()`

**Files:**
- Modify: `extension/src/agent/FormAnalyzer.ts:162-244` (`analyzeForms` function)

- [ ] **Step 1: Write integration test**

Add to the existing `describe('FormAnalyzer', ...)` block:

```typescript
it('populates inferred_purpose when label is empty but placeholder has clues', () => {
  const doc = getDoc();
  doc.body.innerHTML = `
    <form>
      <input type="text" name="website" placeholder="https://example.com">
    </form>
  `;

  const result = analyzeForms(doc);

  expect(result.fields[0].label).toBe('');
  expect(result.fields[0].inferred_purpose).toBe('website URL');
});

it('populates effective_type when type is text but signals indicate url', () => {
  const doc = getDoc();
  doc.body.innerHTML = `
    <form>
      <input type="text" name="logo_url" placeholder="https://domain.com/logo.png">
    </form>
  `;

  const result = analyzeForms(doc);

  expect(result.fields[0].type).toBe('text');
  expect(result.fields[0].effective_type).toBe('url');
});

it('does not populate inferred_purpose when label is resolved', () => {
  const doc = getDoc();
  doc.body.innerHTML = `
    <form>
      <label for="email">Email</label>
      <input type="text" id="email" name="email" placeholder="your@email.com">
    </form>
  `;

  const result = analyzeForms(doc);

  expect(result.fields[0].label).toBe('Email');
  expect(result.fields[0].inferred_purpose).toBe('');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extension && npx vitest run src/__tests__/FormAnalyzer.test.ts`
Expected: FAIL — `inferred_purpose` and `effective_type` are undefined

- [ ] **Step 3: Wire up inference functions in `analyzeForms()`**

In `extension/src/agent/FormAnalyzer.ts`, in the `analyzeForms` function, make two changes:

**Change A:** Replace the regular inputs `fields.push(...)` block (around line 195-206) with:

```typescript
      const label = findLabel(doc, htmlEl);
      const placeholder = (el as HTMLInputElement).placeholder || '';
      const required = (el as HTMLInputElement).required || false;
      const maxlength = (el as HTMLInputElement).maxLength || null;
      const effectiveMaxlength =
        maxlength !== null && maxlength >= 0 ? maxlength : null;

      const rawField = {
        name: el.getAttribute('name') || '',
        id: el.id || '',
        type,
        label,
        placeholder,
        required,
        maxlength: effectiveMaxlength,
        selector: buildSelector(htmlEl),
        tagName: tag,
      };

      fields.push({
        canonical_id: `field_${fieldIndex}`,
        ...rawField,
        inferred_purpose: inferFieldPurpose(rawField),
        effective_type: inferEffectiveType(rawField),
      });
```

**Change B:** Also update the contenteditable `fields.push(...)` block (around line 222-235). Replace:

```typescript
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
```

With:

```typescript
        const ceField = {
          name: el.getAttribute('name') || '',
          id: el.id || '',
          type: 'contenteditable' as const,
          label: label || ariaLabel,
          placeholder: '',
          required: false,
          maxlength: null as number | null,
          selector: buildSelector(htmlEl),
          tagName: el.tagName.toLowerCase(),
        };

        fields.push({
          canonical_id: `field_${fieldIndex}`,
          ...ceField,
          inferred_purpose: inferFieldPurpose(ceField),
          effective_type: inferEffectiveType(ceField),
        });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extension && npx vitest run src/__tests__/FormAnalyzer.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add extension/src/agent/FormAnalyzer.ts extension/src/__tests__/FormAnalyzer.test.ts
git commit -m "feat: wire inferFieldPurpose and inferEffectiveType into analyzeForms"
```

---

### Task 5: Update directory-submit-prompt to separate label/placeholder/inferred_purpose

**Files:**
- Modify: `extension/src/agent/prompts/directory-submit-prompt.ts:20-22`

- [ ] **Step 1: Update field list format**

Replace lines 20-22 in `extension/src/agent/prompts/directory-submit-prompt.ts`:

Before:
```typescript
		const fieldList = fields
			.map((f) => `- ${f.canonical_id}: type=${f.type}, label="${f.label || f.placeholder || f.name}", ${f.required ? 'required' : 'optional'}${f.maxlength ? `, maxlength=${f.maxlength}` : ''}`)
			.join('\n')
```

After:
```typescript
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
```

- [ ] **Step 2: Verify build succeeds**

Run: `cd extension && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add extension/src/agent/prompts/directory-submit-prompt.ts
git commit -m "feat: separate label/placeholder/inferred_purpose in directory prompt"
```

---

### Task 6: Update blog-comment-prompt with same separation

**Files:**
- Modify: `extension/src/agent/prompts/blog-comment-prompt.ts:20-22`

- [ ] **Step 1: Update field list format**

Replace lines 20-22 in `extension/src/agent/prompts/blog-comment-prompt.ts`:

Before:
```typescript
		const fieldList = fields
			.map((f) => `- ${f.canonical_id}: type=${f.type}, label="${f.label || f.placeholder || f.name}", ${f.required ? 'required' : 'optional'}`)
			.join('\n')
```

After:
```typescript
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
```

- [ ] **Step 2: Verify build succeeds**

Run: `cd extension && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add extension/src/agent/prompts/blog-comment-prompt.ts
git commit -m "feat: separate label/placeholder/inferred_purpose in blog comment prompt"
```

---

### Task 7: Fix page title delay for SPA hydration in content.ts

**Files:**
- Modify: `extension/src/entrypoints/content.ts:22-33`

- [ ] **Step 1: Make analyze handler async with title delay**

Replace the `case 'analyze'` block (lines 22-33) in `extension/src/entrypoints/content.ts`:

Before:
```typescript
				case 'analyze': {
						const siteType = message.payload?.siteType as string | undefined
						const analysis = analyzeForms(document)

						if (siteType === 'blog_comment') {
							const pageContent = extractPageContent(document)
							sendResponse({ ok: true, analysis, pageContent })
						} else {
							sendResponse({ ok: true, analysis })
						}
						return
					}
```

After:
```typescript
				case 'analyze': {
						const siteType = message.payload?.siteType as string | undefined

						;(async () => {
							// Wait briefly for SPA hydration if title is empty
							if (!document.title) {
								await new Promise(r => setTimeout(r, 500))
							}

							const analysis = analyzeForms(document)

							if (siteType === 'blog_comment') {
								const pageContent = extractPageContent(document)
								sendResponse({ ok: true, analysis, pageContent })
							} else {
								sendResponse({ ok: true, analysis })
							}
						})()

						return true // keep message channel open for async response
					}
```

- [ ] **Step 2: Verify build succeeds**

Run: `cd extension && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add extension/src/entrypoints/content.ts
git commit -m "fix: delay page title read for SPA hydration"
```

---

### Task 8: Fix log display in FormFillEngine.ts

**Files:**
- Modify: `extension/src/agent/FormFillEngine.ts:88-99`

- [ ] **Step 1: Update log to show all signals**

Replace lines 88-99 in `extension/src/agent/FormFillEngine.ts`:

Before:
```typescript
			log('success', 'analyze', `表单分析完成: 发现 ${analysis.fields.length} 个字段`, {
				fields: analysis.fields.map(f => ({
					id: f.canonical_id,
					type: f.type,
					label: f.label || f.placeholder || f.name,
					required: f.required,
				})),
				pageInfo: {
					title: analysis.page_info.title,
					description: analysis.page_info.description?.slice(0, 100),
				},
			})
```

After:
```typescript
			log('success', 'analyze', `表单分析完成: 发现 ${analysis.fields.length} 个字段`, {
				fields: analysis.fields.map(f => ({
					id: f.canonical_id,
					type: f.effective_type || f.type,
					label: f.label || f.inferred_purpose || '(unknown)',
					placeholder: f.placeholder || undefined,
					required: f.required,
				})),
				pageInfo: {
					title: analysis.page_info.title,
					description: analysis.page_info.description?.slice(0, 200),
				},
			})
```

Note: also increased description truncation from 100 to 200 chars.

- [ ] **Step 2: Verify build succeeds**

Run: `cd extension && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add extension/src/agent/FormFillEngine.ts
git commit -m "fix: show all signals in form analysis log instead of fallback chain"
```

---

### Task 9: Final verification — run all tests and build

- [ ] **Step 1: Run full test suite**

Run: `cd extension && npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Run production build**

Run: `cd extension && npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 3: Final commit if any fixes needed**

If any adjustments were needed during verification:
```bash
git add -A
git commit -m "fix: address issues found during final verification"
```
