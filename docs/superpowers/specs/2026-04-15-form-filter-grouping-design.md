# Form Filter & Grouping — Multi-Form Detection Optimization

**Date:** 2026-04-15
**Status:** Approved
**Constraint:** Single LLM call only

## Problem

When a submission page contains multiple forms (e.g. a search bar, a login form, a newsletter subscription alongside the actual submission form), the current system flattens all fields from all forms into a single list and sends everything to the LLM. This causes:

- LLM fills values into irrelevant forms (search, login, newsletter)
- Target submission fields get missed because attention is diluted
- Fuzzy matching may map values to wrong fields across forms

Estimated success rate on multi-form pages: ~50-70% (vs ~80-90% on single-form pages).

## Solution: DOM Pre-Filter + Form Grouping + Prompt Enhancement

Filter irrelevant forms at the DOM scanning stage, group remaining fields by form with context, and instruct the LLM to ignore filtered forms — all within a single LLM call.

## Section 1: FormFilter — Form Role Classification

New `classifyForm()` function in `FormAnalyzer.ts`. Classifies each `<form>` element with a role label.

### Classification Rules (high confidence only)

```
search:
  - form[role="search"]
  - form[action*="/search"] or form[action*="?s="]
  - sole field name contains q/s/query/keyword/search_term
  - form contains only 1-2 text inputs + 1 submit button

login:
  - form[action*="/login"] or form[action*="/signin"] or form[action*="/auth"]
  - field names contain password/passwd/username/signin/login
  - contains type="password" field

newsletter:
  - form[action*="/subscribe"] or form[action*="/newsletter"]
  - field names contain newsletter/subscribe/mailing
  - contains only 1 email input + 1 submit button

unknown:
  - does not match any above rules → preserved (not filtered)
```

### Key Principle

Only high-confidence signals trigger filtering. Ambiguous cases default to `unknown` and are preserved. It is better to send a few extra fields to the LLM than to accidentally remove the target submission form.

### Data Structure

```typescript
interface FormGroup {
  form_index: number
  role: 'search' | 'login' | 'newsletter' | 'unknown'
  confidence: 'high' | 'medium' | 'low'
  form_id?: string
  form_action?: string
  field_count: number
  filtered: boolean
}

interface FormAnalysisResult {
  fields: FormField[]        // only unfiltered fields
  forms: FormGroup[]         // all forms (including filtered)
  page_info: PageInfo
}
```

Filtered forms are excluded from `fields` but retained in `forms` for logging and debugging.

## Section 2: Field Grouping + Prompt Enhancement

### Field List Format Change

From flat list to grouped format:

```
[Form 1] id="submit-form" action="/submit" — 3 fields
- field_0: type=text, label="Product Name", required
- field_1: type=url, label="Website URL", required
- field_2: type=text, label="Description", required

[Form 2] role=search — 1 field (filtered)
- (search field — skipped)

[Form 3] role=newsletter — 1 field (filtered)
- (email field — skipped)
```

Only unfiltered form fields are sent to the LLM. A one-line summary is kept for each filtered form so the LLM knows they exist but should be ignored.

### Prompt Changes

**directory-submit-prompt.ts** — insert as Rule #1:

```
1. The page may contain multiple forms. Only fill fields from the target
   submission form (marked with [Form N] above). Ignore any forms marked
   as "filtered" — these are search bars, login forms, or newsletter
   subscriptions and should NOT receive any values.
```

**blog-comment-prompt.ts** — insert as Rule #1:

```
1. The page may contain multiple forms. Only fill fields from the target
   comment form (marked with [Form N] above). Ignore any forms marked
   as "filtered" — these are unrelated forms and should NOT receive any
   values. Your comment and personal info go into the comment form only.
```

### Implementation Scope

- `FormAnalyzer.ts`: `analyzeForms()` returns `forms` array alongside `fields`; only unfiltered fields in `fields`
- Two prompt builders: call new `buildFieldList(fields, forms)` for grouped format; add filter rule
- `FormFillEngine.ts`: no changes needed (consumes `analysis.fields` which is already clean)

## Section 3: Fuzzy Matching Hardening

### Same-Form Priority

`fuzzyMatchField()` in `FormFillEngine.ts` gains awareness of form boundaries. Each `FormField` gets a `form_index` property. When matching, prefer fields within the same form first; fall back to global matching only if no same-form match is found.

```typescript
// New property on FormField
interface FormField {
  // ...existing...
  form_index?: number
}
```

~10 lines of change in `fuzzyMatchField()`.

### Already-Solved: Filtered Fields

Since filtered form fields are removed from `analysis.fields`, fuzzy matching cannot accidentally match them. No additional work needed.

## Section 4: Edge Cases & Degradation

| Scenario | Behavior | LLM Calls |
|---|---|---|
| Single form on page | No filtering, normal grouping | 1 |
| Multiple forms with clear irrelevant ones | Filter irrelevant, send only target fields | 1 |
| Multiple forms, can't determine target | Preserve all, show grouped | 1 |
| No `<form>` tags | Body fallback scan, no filtering | 1 |
| All forms filtered | Return "No form fields found", no LLM call | 0 |

### Specific Edge Cases

- **No `<form>` tags:** Body fallback scan runs without filtering (no form elements to classify). Unchanged from current behavior.
- **All forms filtered:** `fields` is empty after filtering, existing "no fields" branch returns early without LLM call.
- **Target form misclassified as irrelevant:** Mitigated by only using high-confidence signals. Ambiguous forms default to `unknown`.
- **Single form page:** `forms` array has one element, no filtering occurs. Grouped format degrades to single group. Filter rule in prompt is harmless redundancy. Zero extra cost.
- **Dynamically loaded forms:** `expandLazyCommentForms()` runs before `analyzeForms()`. New filtering logic is inside `analyzeForms()`, timing unaffected.
- **Log visibility:** Every filtered form logs its classification reason for debugging.

## Files Changed

| File | Change |
|---|---|
| `extension/src/agent/FormAnalyzer.ts` | New `classifyForm()`, `FormGroup` type, modified `analyzeForms()` return value, new `buildFieldList()` helper |
| `extension/src/agent/prompts/directory-submit-prompt.ts` | Grouped field list format + filter rule in Rules |
| `extension/src/agent/prompts/blog-comment-prompt.ts` | Same as above |
| `extension/src/agent/FormFillEngine.ts` | `fuzzyMatchField()` same-form priority (~10 lines) |

### Files NOT Changed

`content.ts`, `dom-utils.ts`, `llm-utils.ts`, `product-context.ts`, `PageContentExtractor.ts`
