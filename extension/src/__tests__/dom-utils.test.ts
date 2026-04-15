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
});
