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
    // "Product Name" tokens {product, name} vs field_1 name "product_name" tokens {product, name} = 1.0
    const result = fuzzyMatchField('Product Name', fields, used, 1);
    expect(result?.canonical_id).toBe('field_1');
  });

  it('falls back to global match when no same-form match exists', () => {
    const used = new Set<string>();
    const result = fuzzyMatchField('search', fields, used, 1);
    expect(result?.canonical_id).toBe('field_0');
  });

  it('skips already-used fields', () => {
    const used = new Set<string>(['field_1']);
    const result = fuzzyMatchField('Product Name', fields, used, 1);
    expect(result).toBeNull();
  });

  it('works without formIndex (backward compatibility)', () => {
    const noFormIndexFields: FormField[] = [
      { canonical_id: 'field_0', name: 'product_name', id: '', type: 'text', label: 'Product Name', placeholder: '', required: true, maxlength: null, selector: '#pname', tagName: 'input' },
    ];
    const used = new Set<string>();
    // "productname" normalized = "productname", field name normalized = "productname" → exact match
    const result = fuzzyMatchField('productname', noFormIndexFields, used);
    expect(result?.canonical_id).toBe('field_0');
  });

  it('does not match short key "name" to "first_name" when ambiguous', () => {
    const fields: FormField[] = [
      { canonical_id: 'field_0', name: 'first_name', id: '', type: 'text', label: 'First Name', placeholder: '', required: true, maxlength: null, selector: '#fn', tagName: 'input', form_index: 0 },
      { canonical_id: 'field_1', name: 'last_name', id: '', type: 'text', label: 'Last Name', placeholder: '', required: true, maxlength: null, selector: '#ln', tagName: 'input', form_index: 0 },
      { canonical_id: 'field_2', name: 'username', id: '', type: 'text', label: 'Username', placeholder: '', required: true, maxlength: null, selector: '#un', tagName: 'input', form_index: 0 },
    ];
    const used = new Set<string>();
    // "name" (tokens: {name}) vs "first_name" name (tokens: {first, name}) = 1/2 = 0.5 — NOT > 0.5
    // "name" vs label "First Name" (tokens: {first, name}) = 1/2 = 0.5 — NOT > 0.5
    // "name" vs "username" (tokens: {username}) = 0/1 = 0 — no match
    const result = fuzzyMatchField('name', fields, used);
    expect(result).toBeNull();
  });

  it('matches when token overlap exceeds threshold', () => {
    const fields: FormField[] = [
      { canonical_id: 'field_0', name: 'product_name', id: '', type: 'text', label: 'Product Name', placeholder: '', required: true, maxlength: null, selector: '#pn', tagName: 'input', form_index: 0 },
    ];
    const used = new Set<string>();
    // "product name" tokens {product, name} vs "product_name" tokens {product, name} = 1.0
    const result = fuzzyMatchField('product name', fields, used);
    expect(result?.canonical_id).toBe('field_0');
  });
});
