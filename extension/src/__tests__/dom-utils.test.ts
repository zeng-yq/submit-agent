import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

let dom: JSDOM;

describe('isHoneypotField', () => {
  let isHoneypotField: typeof import('@/agent/dom-utils').isHoneypotField;

  beforeEach(async () => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      runScripts: 'dangerously',
      url: 'https://example.com',
    });
    const mod = await import('@/agent/dom-utils');
    isHoneypotField = mod.isHoneypotField;
  });

  function el(html: string): Element {
    const doc = dom.window.document;
    doc.body.innerHTML = html;
    return doc.body.firstElementChild!;
  }

  it('detects aria-hidden="true"', () => {
    expect(isHoneypotField(el('<input aria-hidden="true" name="x">'))).toBe(true);
  });

  it('does not flag aria-hidden="false"', () => {
    expect(isHoneypotField(el('<input aria-hidden="false" name="x">'))).toBe(false);
  });

  it('detects name containing "honeypot"', () => {
    expect(isHoneypotField(el('<input name="ak_hp_text" value="">'))).toBe(true);
  });

  it('detects id containing "honeypot"', () => {
    expect(isHoneypotField(el('<input id="honeypot_field" name="x">'))).toBe(true);
  });

  it('detects class containing "trap"', () => {
    expect(isHoneypotField(el('<input class="trap-field" name="x">'))).toBe(true);
  });

  it('does not flag normal field without honeypot signals', () => {
    expect(isHoneypotField(el('<input name="website" type="url">'))).toBe(false);
  });

  it('detects label with only non-alphanumeric characters (aria-label)', () => {
    expect(isHoneypotField(el('<textarea aria-label="\u0394" name="ak_hp_comment"></textarea>'))).toBe(true);
  });

  it('detects tabindex < 0 with no label and no id', () => {
    expect(isHoneypotField(el('<input tabindex="-1" name="x">'))).toBe(true);
  });

  it('does not flag tabindex < 0 when element has an id', () => {
    expect(isHoneypotField(el('<input tabindex="-1" id="myfield" name="x">'))).toBe(false);
  });

  it('detects autocomplete="off" with no label and no id', () => {
    expect(isHoneypotField(el('<input autocomplete="off" name="x">'))).toBe(true);
  });

  it('does not flag autocomplete="off" when element has aria-label', () => {
    expect(isHoneypotField(el('<input autocomplete="off" aria-label="Website" name="x">'))).toBe(false);
  });

  it('detects name matching _wpcf7 prefix (Contact Form 7)', () => {
    expect(isHoneypotField(el('<input name="_wpcf7_version" value="">'))).toBe(true);
  });

  it('detects name containing "nospam"', () => {
    expect(isHoneypotField(el('<input name="nospam_check" value="">'))).toBe(true);
  });

  it('detects name containing "antispam"', () => {
    expect(isHoneypotField(el('<input name="antispam_field" value="">'))).toBe(true);
  });

  it('detects name containing "wpbruiser"', () => {
    expect(isHoneypotField(el('<input name="wpbruiser_token" value="">'))).toBe(true);
  });

  it('detects name containing "gotcha"', () => {
    expect(isHoneypotField(el('<input name="gotcha_verify" value="">'))).toBe(true);
  });

  it('detects id with 32+ hex chars (random hash)', () => {
    expect(isHoneypotField(el('<input id="a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4" name="x">'))).toBe(true);
  });

  it('does not flag short normal names', () => {
    expect(isHoneypotField(el('<input name="website" type="url">'))).toBe(false);
  });
});

describe('honeypotScore', () => {
  let honeypotScore: typeof import('@/agent/dom-utils').honeypotScore;

  beforeEach(async () => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      runScripts: 'dangerously',
      url: 'https://example.com',
    });
    const mod = await import('@/agent/dom-utils');
    honeypotScore = mod.honeypotScore;
  });

  function el(html: string): Element {
    const doc = dom.window.document;
    doc.body.innerHTML = html;
    return doc.body.firstElementChild!;
  }

  it('returns 0 for a normal visible field', () => {
    expect(honeypotScore(el('<input name="website" type="url">'))).toBe(0);
  });

  it('returns high score (>=80) for aria-hidden="true"', () => {
    expect(honeypotScore(el('<input aria-hidden="true" name="x">'))).toBeGreaterThanOrEqual(80);
  });

  it('returns score >= 50 for name matching honeypot pattern', () => {
    expect(honeypotScore(el('<input name="honeypot_field" value="">'))).toBeGreaterThanOrEqual(50);
  });

  it('returns score < 50 for normal field with autocomplete="off" and aria-label', () => {
    expect(honeypotScore(el('<input autocomplete="off" aria-label="Website" name="x">'))).toBeLessThan(50);
  });
});

describe('isVisible', () => {
  let isVisible: typeof import('@/agent/dom-utils').isVisible;

  beforeEach(async () => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      runScripts: 'dangerously',
      url: 'https://example.com',
    });
    const mod = await import('@/agent/dom-utils');
    isVisible = mod.isVisible;
  });

  function el(html: string): Element {
    const doc = dom.window.document;
    doc.body.innerHTML = html;
    return doc.body.firstElementChild!;
  }

  it('returns true for normally visible element', () => {
    expect(isVisible(el('<input name="x">'))).toBe(true);
  });

  it('returns false when parent has display:none (inline style)', () => {
    const doc = dom.window.document;
    doc.body.innerHTML = '<div style="display:none"><input name="x"></div>';
    const input = doc.body.querySelector('input')!;
    expect(isVisible(input)).toBe(false);
  });

  it('returns false for element with font-size: 0 (inline style)', () => {
    const doc = dom.window.document;
    doc.body.innerHTML = '<input name="x" style="font-size: 0">';
    const input = doc.body.querySelector('input')!;
    expect(isVisible(input)).toBe(false);
  });

  it('returns false for element with max-height: 0 (inline style)', () => {
    const doc = dom.window.document;
    doc.body.innerHTML = '<input name="x" style="max-height: 0">';
    const input = doc.body.querySelector('input')!;
    expect(isVisible(input)).toBe(false);
  });
});

describe('fillAndVerify', () => {
  let fillAndVerify: typeof import('@/agent/dom-utils').fillAndVerify;

  beforeEach(async () => {
    document.body.innerHTML = '';
    const mod = await import('@/agent/dom-utils');
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
  let waitForFormFields: typeof import('@/agent/dom-utils').waitForFormFields;

  beforeEach(async () => {
    // Clear the global jsdom document body so tests don't leak into each other
    document.body.innerHTML = '';
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      runScripts: 'dangerously',
      url: 'https://example.com',
    });
    const mod = await import('@/agent/dom-utils');
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
