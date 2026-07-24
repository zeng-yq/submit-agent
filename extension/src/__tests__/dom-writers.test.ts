import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

let dom: JSDOM;

describe('fillAndVerify', () => {
  let fillAndVerify: typeof import('@/agent/dom-writers').fillAndVerify;

  beforeEach(async () => {
    document.body.innerHTML = '';
    const mod = await import('@/agent/dom-writers');
    fillAndVerify = mod.fillAndVerify;
  });

  it('returns true when fill succeeds on input', async () => {
    document.body.innerHTML = '<input type="text" name="q" id="q">';
    const input = document.querySelector('#q') as HTMLElement;
    const result = await fillAndVerify(input, 'hello', 1);
    expect(result).toBe(true);
    expect((input as HTMLInputElement).value).toBe('hello');
  });

  it('returns true when fill succeeds on textarea', async () => {
    document.body.innerHTML = '<textarea name="comment" id="c"></textarea>';
    const ta = document.querySelector('#c') as HTMLElement;
    const result = await fillAndVerify(ta, 'nice comment', 1);
    expect(result).toBe(true);
    expect((ta as HTMLTextAreaElement).value).toBe('nice comment');
  });

  it('returns false when element has been removed', async () => {
    document.body.innerHTML = '<input type="text" name="q" id="q">';
    const input = document.querySelector('#q') as HTMLElement;
    input.remove();
    const result = await fillAndVerify(input, 'hello', 1);
    expect(result).toBe(false);
  });
});

describe('waitForFormFields', () => {
  let waitForFormFields: typeof import('@/agent/dom-writers').waitForFormFields;

  beforeEach(async () => {
    // Clear the global jsdom document body so tests don't leak into each other
    document.body.innerHTML = '';
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      runScripts: 'dangerously',
      url: 'https://example.com',
    });
    const mod = await import('@/agent/dom-writers');
    waitForFormFields = mod.waitForFormFields;
  });

  it('returns immediately when form fields already exist', async () => {
    document.body.innerHTML = '<input type="text" name="q">';
    const start = Date.now();
    await waitForFormFields(2000);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('times out when no form fields appear', async () => {
    document.body.innerHTML = '';
    const start = Date.now();
    await waitForFormFields(200);
    expect(Date.now() - start).toBeGreaterThanOrEqual(150);
  });
});

describe('setInputValue', () => {
  let setInputValue: typeof import('@/agent/dom-writers').setInputValue;

  beforeEach(async () => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      runScripts: 'dangerously',
      url: 'https://example.com',
    });
    const mod = await import('@/agent/dom-writers');
    setInputValue = mod.setInputValue;
  });

  it('sets value and dispatches input+change+blur events', () => {
    const doc = dom.window.document;
    doc.body.innerHTML = '<input type="text" name="q" id="q">';
    const input = doc.querySelector('#q') as HTMLInputElement;

    const events: string[] = [];
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));
    input.addEventListener('blur', () => events.push('blur'));

    setInputValue(input, 'hello');

    expect(input.value).toBe('hello');
    expect(events).toContain('input');
    expect(events).toContain('change');
    expect(events).toContain('blur');
  });
});

describe('setTextareaValue', () => {
  let setTextareaValue: typeof import('@/agent/dom-writers').setTextareaValue;

  beforeEach(async () => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      runScripts: 'dangerously',
      url: 'https://example.com',
    });
    const mod = await import('@/agent/dom-writers');
    setTextareaValue = mod.setTextareaValue;
  });

  it('sets value and dispatches input+change+blur events', () => {
    const doc = dom.window.document;
    doc.body.innerHTML = '<textarea name="c" id="c"></textarea>';
    const ta = doc.querySelector('#c') as HTMLTextAreaElement;

    const events: string[] = [];
    ta.addEventListener('input', () => events.push('input'));
    ta.addEventListener('change', () => events.push('change'));
    ta.addEventListener('blur', () => events.push('blur'));

    setTextareaValue(ta, 'hello world');

    expect(ta.value).toBe('hello world');
    expect(events).toContain('input');
    expect(events).toContain('change');
    expect(events).toContain('blur');
  });
});
