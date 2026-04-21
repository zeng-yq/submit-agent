import { isFormField } from '../dom-utils';
import type { FormField, FormGroup, FormAnalysisResult } from './types';
import { buildSelector, findLabel, deduplicateFields, extractPageInfo } from './form-scanner';
import { classifyForm } from './form-classifier';
import { inferFieldPurpose, inferEffectiveType } from './field-resolver';
import { detectCommentLinks } from './comment-links';
import { detectCommentSystem } from './comment-system-detector';

// Re-export all public types and functions
export type { FormField, PageInfo, FormAnalysisResult, CommentLinkResult, FormRole, FormConfidence, FormGroup } from './types'
export { findLabel, deduplicateFields, extractPageInfo, buildSelector, cssEscape } from './form-scanner'
export { classifyForm } from './form-classifier'
export { inferFieldPurpose, inferEffectiveType, classifyFields } from './field-resolver'
export { detectCommentLinks } from './comment-links'
export { detectCommentSystem } from './comment-system-detector'
export { buildFieldList } from './field-list-builder'

/**
 * Resolve a DOM element by its canonical_id from a FormAnalysisResult.
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
    commentLinks: detectCommentLinks(doc),
    commentSystem: detectCommentSystem(doc) ?? undefined,
  };
}
