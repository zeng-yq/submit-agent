# Form Analyzer Robustness Refactoring

## Problem

The form analysis (`FormAnalyzer.ts`) fails to resolve labels for many modern web forms, including the target page `https://whatsthebigdata.com/submit-new-ai-tool/`. The root causes:

1. **`findLabel()` only checks 4 DOM patterns** — misses sibling labels, parent-container text, `title` attribute
2. **Fallback chain conflates label and placeholder** — `f.label || f.placeholder || f.name` shows placeholder text as "label", misleading the LLM
3. **Page title empty for SPA pages** — content script reads `doc.title` before React hydration completes
4. **No field purpose inference** — when label is empty, no heuristic fallback exists

## Solution: Hybrid DOM Enhancement + Heuristic Inference + Prompt Separation

### Part 1: Enhanced `findLabel()` — 7-step cascade

Extend `findLabel()` in `FormAnalyzer.ts` from 4 steps to 7:

1. `<label for="id">` (existing)
2. Wrapping `<label>` (existing)
3. `aria-label` attribute (existing)
4. `aria-labelledby` reference (existing)
5. **`title` attribute** — `el.getAttribute('title')`
6. **Adjacent sibling `<label>`** — previous sibling element that is a `<label>` (without `for` attribute)
7. **Parent container text** — in the parent element, find the last text-bearing child element (`<span>`, `<div>`, `<label>`, `<p>`) that appears before the input element

Steps 5-7 run in order; first non-empty result wins.

### Part 2: `inferFieldPurpose()` — heuristic field purpose inference

New function called after `findLabel()` when label is still empty. Infers purpose from:

| Signal | Inference |
|--------|-----------|
| placeholder contains email/@ | "email address" |
| placeholder contains http/https/url | "website URL" |
| placeholder contains name | "full name" |
| name attr contains email/mail | "email address" |
| name attr contains url/website/link | "website URL" |
| name attr contains name/author | "name" |
| name attr contains desc/description | "description" |
| name attr contains title | "title" |
| name attr contains category/tag | "category" |
| type="url" | "URL" |
| type="email" | "email" |
| type="tel" | "phone number" |

### Part 3: Field type enhancement inference

When `type="text"`, use label/placeholder/name to infer a more precise type for LLM hints:
- placeholder matches URL pattern → `effective_type: "url"`
- label contains "email" → `effective_type: "email"`

This does NOT change actual DOM filling behavior — it only provides better context to the LLM.

### Part 4: FormField interface additions

```typescript
export interface FormField {
  // ... existing fields ...
  inferred_purpose?: string  // heuristic purpose when label is empty
  effective_type?: string    // enhanced type for LLM context
}
```

### Part 5: Prompt redesign

**Before** (directory-submit-prompt.ts):
```
label="${f.label || f.placeholder || f.name}"
```

**After**: separate label, placeholder, and inferred purpose:
```
- field_0: type=text, label="Tool Name", placeholder="Enter your tool name", required
- field_1: type=url, label="", placeholder="https://yourtool.com", inferred_purpose="website URL", required
```

LLM sees all signals and decides which to trust.

Same change in `blog-comment-prompt.ts`.

### Part 6: Page title delay fix

In `content.ts`, when handling `analyze` action:
```typescript
// If title is empty, wait briefly for SPA hydration
if (!doc.title) {
  await new Promise(r => setTimeout(r, 500));
}
```

### Part 7: Log display fix

In `FormFillEngine.ts:92`, change the log to show all signals:
```typescript
fields: analysis.fields.map(f => ({
  id: f.canonical_id,
  type: f.effective_type || f.type,
  label: f.label || f.inferred_purpose || '(unknown)',
  placeholder: f.placeholder || undefined,
  required: f.required,
})),
```

### Part 8: Test coverage

New test cases in `FormAnalyzer.test.ts`:

1. Sibling `<label>` without `for` attribute
2. Parent container text pattern
3. `title` attribute resolution
4. `inferFieldPurpose()` — placeholder-based inference
5. `inferFieldPurpose()` — name-attribute-based inference
6. Field type enhancement (text → url)
7. Real-world HTML fragment tests (whatsthebigdata.com form pattern)

## Files to modify

| File | Changes |
|------|---------|
| `extension/src/agent/FormAnalyzer.ts` | Enhanced `findLabel()`, new `inferFieldPurpose()`, type inference, interface additions |
| `extension/src/agent/FormFillEngine.ts` | Update log display to use new fields |
| `extension/src/agent/prompts/directory-submit-prompt.ts` | Separate label/placeholder/inferred_purpose in prompt |
| `extension/src/agent/prompts/blog-comment-prompt.ts` | Same prompt changes |
| `extension/src/entrypoints/content.ts` | Page title delay for SPA |
| `extension/src/__tests__/FormAnalyzer.test.ts` | New test cases |

## Out of scope

- No changes to `dom-utils.ts` fill logic
- No changes to annotation or float button code
- No LLM dependency in analysis phase — inference is purely heuristic
