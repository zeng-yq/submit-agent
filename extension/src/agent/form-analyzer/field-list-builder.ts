import type { FormField, FormGroup } from './types'

/**
 * Build a grouped field list string for LLM prompts.
 */
export function buildFieldList(fields: FormField[], forms: FormGroup[]): string {
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
