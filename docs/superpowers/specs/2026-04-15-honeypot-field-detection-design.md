# Honeypot Field Detection and Filtering

## Problem

Form analysis detects more fields than are visible on the page. The extra fields are honeypot (anti-spam trap) fields that are invisible to real users but detected by the DOM scanner. Examples:

- **goaffpro.com**: WordPress Akismet injects a hidden `textarea` with label `Δ` (Greek Delta). It passes `isVisible()` because it uses off-screen positioning rather than `display:none`.
- **bakersroyale.com**: A hidden `textarea` labeled "Website" duplicates the real `url` input with the same label. The textarea is a honeypot trap.

## Root Cause

Two gaps in `extension/src/agent/dom-utils.ts`:

1. `isVisible()` only checks `display:none`, `visibility:hidden`, `opacity:0`, and zero dimensions. It does not detect off-screen positioning (`left: -9999px`), CSS clipping, or `aria-hidden`.
2. There is no honeypot detection based on naming conventions or structural patterns (duplicate fields with different types).

## Design

Two-layer filtering: DOM-layer checks in `isFormField()`, followed by a cross-validation pass in `analyzeForms()`.

### Layer 1: DOM-layer filtering (`dom-utils.ts`)

#### New function: `isHoneypotField(el: Element): boolean`

Called after `isCaptchaElement()` and before `isVisible()` in `isFormField()`.

Detection rules:

| Rule | Signals | Covers |
|------|---------|--------|
| `aria-hidden="true"` | Semantic hiding attribute | General |
| Label is empty and `name`/`id`/`class` contains `honeypot`, `hp_`, `ak_hp`, `trap`, `cloaked` | Naming convention | General honeypot plugins |
| Label contains only non-alphanumeric characters (e.g. `Δ`, pure whitespace, single symbol) | Meaningless label | WordPress Akismet `Δ` field |
| `tabindex < 0` and no label | Keyboard-inaccessible hidden field | General |
| `autocomplete="off"` and no label and non-standard `name` | Anti-autofill signal | General |

All rules are combined with OR — any single match marks the field as a honeypot.

#### Enhanced `isVisible()`

Add after existing checks:

| Check | Implementation |
|-------|---------------|
| Off-screen positioning | `position: absolute/fixed` and any of `left/top/right/bottom < -500px` |
| CSS clipping | `clip: rect(0,0,0,0)` or `clip-path: inset(100%)` |

The threshold of -500px is conservative enough to avoid false positives on intentionally offset elements.

### Layer 2: Cross-validation pass (`FormAnalyzer.ts`)

#### New function: `deduplicateFields(fields: FormField[]): FormField[]`

Called in `analyzeForms()` after all fields are collected, before returning the result.

Logic: Group fields by `form_index`. Within each group, find pairs with the same `label` (case-insensitive, trimmed) but different `type`. Remove the honeypot suspect based on priority rules:

| Scenario | Keep | Remove |
|----------|------|--------|
| Same label: one `input`, one `textarea` | `input` | `textarea` |
| Same label: one `input` with specific type (`url`/`email`/`tel`), one `input[type=text]` | Specific type | `text` |
| Same label: one has label, one has no label | Has label | No label |
| Same label: both same type | First occurrence | Second occurrence |

Removed fields are logged via `console.debug`:
```
[SubmitAgent] Honeypot suspect removed: field_4 (type=textarea, label="Website") — duplicate of field_3 (type=url)
```

### Call order in `isFormField()`

```
isCaptchaElement(el) → isHoneypotField(el) → isVisible(el) → type check
```

### Filtered fields behavior

Honeypot fields are silently removed from the field list. They never reach the LLM prompt or the UI. Debug logging is available via `console.debug` for development.

## Files to modify

| File | Changes |
|------|---------|
| `extension/src/agent/dom-utils.ts` | Add `isHoneypotField()`, enhance `isVisible()`, update `isFormField()` call order |
| `extension/src/agent/FormAnalyzer.ts` | Add `deduplicateFields()`, call it in `analyzeForms()` |
| `extension/src/__tests__/dom-utils.test.ts` (new) | Unit tests for `isHoneypotField()` and enhanced `isVisible()` |
| `extension/src/__tests__/FormAnalyzer.test.ts` | Integration tests for duplicate field deduplication |

## Test cases

### `isHoneypotField` unit tests

- `aria-hidden="true"` field is detected
- `name` containing `honeypot`/`ak_hp`/`trap` is detected
- Label `Δ` is detected
- Normal field is not flagged

### `isVisible` enhancement tests

- `position: absolute; left: -9999px` is not visible
- `clip: rect(0,0,0,0)` is not visible
- Normal positioned field remains visible

### `deduplicateFields` integration tests

- Same label, `url` input + `textarea` → textarea removed
- Same label, both `text` inputs → second removed
- No duplicates → all fields preserved
