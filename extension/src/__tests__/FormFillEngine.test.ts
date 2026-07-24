import { describe, it, expect, vi } from 'vitest';
import { fuzzyMatchField } from '@/agent/pipeline/fuzzy';
import { executeFormFill } from '@/agent/FormFillEngine';
import type { FormFillEngineConfig } from '@/agent/FormFillEngine';
import type { FormFillDeps } from '@/agent/pipeline/types';
import type { AnalyzeResponse, FillResponse } from '@/messaging/messages';
import type { SubmitResponse } from '@/agent/comment-submit';
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

const mkConfig = (): FormFillEngineConfig => ({
  llmConfig: { apiKey: 'k', baseUrl: 'u', model: 'm' },
  product: { id: 'p1', name: 'P', url: 'u', description: 'd', anchorTexts: 'a', founderName: 'F', founderEmail: 'e', createdAt: 0, updatedAt: 0 },
  site: { name: 'S', submit_url: 'https://x', category: 'blog_comment', dr: 0 },
  siteType: 'blog_comment',
  tabId: 1,
  callbacks: { onStatusChange: () => {}, onError: () => {}, onLog: () => {}, onLLMFields: () => {} },
});

const mkDeps = (over: Partial<FormFillDeps> = {}): FormFillDeps => ({
  sendToTabMessage: vi.fn(async (msg: any) => {
    if (msg.action === 'analyze') return { ok: true, analysis: { fields: [{ canonical_id: 'f1', selector: '#f1', form_index: 0, type: 'input', effective_type: 'comment' } as any], forms: [{ form_index: 0, filtered: false }], page_info: { title: 't', description: 'd', headings: [], content_preview: '' } } } as unknown as AnalyzeResponse
    if (msg.action === 'fill') return { ok: true, filled: 1, failed: 0 } as FillResponse
    if (msg.action === 'submit') return { ok: true, clicked: true, verifyResult: 'ajax' } as SubmitResponse
    return { ok: true }
  }) as any,
  sendProgress: vi.fn(),
  callLLM: vi.fn().mockResolvedValue('{"f1":"hello"}'),
  verifyNavigation: vi.fn().mockResolvedValue('confirmed'),
  log: vi.fn(),
  onLLMFields: vi.fn(),
  ...over,
}) as any;

describe('executeFormFill (end-to-end, mock deps)', () => {
  it('成功路径：analyze→llm→match→fill→submit，返回 filled=1 submitted', async () => {
    const r = await executeFormFill(mkConfig(), mkDeps());
    expect(r.filled).toBe(1);
    expect(r.failed).toBe(0);
    expect(r.submitted).toBe(true);
    expect(r.verifyResult).toBe('ajax');
  });

  it('无字段 → filled=0 早退，不调 callLLM', async () => {
    const deps = mkDeps({ sendToTabMessage: vi.fn(async () => ({ ok: true, analysis: { fields: [], forms: [], page_info: { title: '', description: '', headings: [], content_preview: '' } } } as unknown as AnalyzeResponse)) as any });
    const r = await executeFormFill(mkConfig(), deps);
    expect(r.filled).toBe(0);
    expect(deps.callLLM).not.toHaveBeenCalled();
  });

  it('directory_submit → 不自动提交（无 submit 消息）', async () => {
    const cfg = { ...mkConfig(), siteType: 'directory_submit' as const };
    const deps = mkDeps();
    const r = await executeFormFill(cfg, deps);
    expect(r.submitted).toBeUndefined();
    expect(deps.sendToTabMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'submit' }),
      expect.anything(),
    );
  });

  it('Abort 中断 → idle return Cancelled', async () => {
    const onStatusChange = vi.fn()
    const cfg = { ...mkConfig(), callbacks: { onStatusChange, onError: vi.fn(), onLog: vi.fn(), onLLMFields: vi.fn() } }
    // jsdom 的 DOMException 不是 instanceof Error，会被 catch 的 instanceof 分支重新包成普通 Error（丢 name）。
    // 真实浏览器中 fetch 中断抛的 AbortError 是 instanceof Error 的，这里模拟真实形状以覆盖 err.name === 'AbortError' 分支。
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const deps = mkDeps({ callLLM: vi.fn().mockRejectedValue(abortErr) })
    const r = await executeFormFill(cfg, deps)
    expect(r.notes).toBe('Cancelled.')
    expect(onStatusChange).toHaveBeenCalledWith('idle')
  });
});
