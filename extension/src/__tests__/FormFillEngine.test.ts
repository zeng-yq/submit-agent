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
    const result = fuzzyMatchField('name', fields, used, 1);
    expect(result?.canonical_id).toBe('field_1');
  });

  it('falls back to global match when no same-form match exists', () => {
    const used = new Set<string>();
    const result = fuzzyMatchField('search', fields, used, 1);
    expect(result?.canonical_id).toBe('field_0');
  });

  it('skips already-used fields', () => {
    const used = new Set<string>(['field_1']);
    const result = fuzzyMatchField('name', fields, used, 1);
    expect(result).toBeNull();
  });

  it('works without formIndex (backward compatibility)', () => {
    const noFormIndexFields: FormField[] = [
      { canonical_id: 'field_0', name: 'product_name', id: '', type: 'text', label: 'Product Name', placeholder: '', required: true, maxlength: null, selector: '#pname', tagName: 'input' },
    ];
    const used = new Set<string>();
    const result = fuzzyMatchField('name', noFormIndexFields, used);
    expect(result?.canonical_id).toBe('field_0');
  });
});
