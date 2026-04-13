import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

let extractPageContent: typeof import('./PageContentExtractor').extractPageContent;

describe('PageContentExtractor', () => {
  let dom: JSDOM;

  beforeEach(async () => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      runScripts: 'dangerously',
      url: 'https://example.com',
    });
    const mod = await import('@/agent/PageContentExtractor');
    extractPageContent = mod.extractPageContent;
  });

  function getDoc(): Document {
    return dom.window.document;
  }

  it('extracts title', () => {
    const doc = getDoc();
    doc.title = 'My Blog';
    const result = extractPageContent(doc);
    expect(result.title).toBe('My Blog');
  });

  it('extracts meta description', () => {
    const doc = getDoc();
    const meta = doc.createElement('meta');
    meta.setAttribute('name', 'description');
    meta.setAttribute('content', 'A great post');
    doc.head.appendChild(meta);
    const result = extractPageContent(doc);
    expect(result.description).toBe('A great post');
  });

  it('returns empty description when no meta tag', () => {
    const doc = getDoc();
    const result = extractPageContent(doc);
    expect(result.description).toBe('');
  });

  it('extracts heading hierarchy', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <h1>Main</h1>
      <h2>Sub 1</h2>
      <h2>Sub 2</h2>
      <h3>Sub 2.1</h3>
      <h1>Another Main</h1>
    `;
    const result = extractPageContent(doc);
    expect(result.headings).toEqual([
      '# Main',
      '## Sub 1',
      '## Sub 2',
      '### Sub 2.1',
      '# Another Main',
    ]);
  });

  it('skips empty headings', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <h1></h1>
      <h2>  </h2>
      <h2>Valid</h2>
    `;
    const result = extractPageContent(doc);
    expect(result.headings).toEqual(['## Valid']);
  });

  it('extracts content from <main>', () => {
    const doc = getDoc();
    doc.body.innerHTML = `<main><p>Hello world content</p></main>`;
    const result = extractPageContent(doc);
    expect(result.content_preview).toBe('Hello world content');
  });

  it('extracts content from <article> when no <main>', () => {
    const doc = getDoc();
    doc.body.innerHTML = `<article><p>Article content here</p></article>`;
    const result = extractPageContent(doc);
    expect(result.content_preview).toBe('Article content here');
  });

  it('falls back to body when no main/article', () => {
    const doc = getDoc();
    doc.body.innerHTML = `<p>Just body text</p>`;
    const result = extractPageContent(doc);
    expect(result.content_preview).toBe('Just body text');
  });

  it('truncates content to 3000 characters', () => {
    const doc = getDoc();
    const longText = 'Word '.repeat(2000); // ~10000 chars
    doc.body.innerHTML = `<main>${longText}</main>`;
    const result = extractPageContent(doc);
    expect(result.content_preview.length).toBeLessThanOrEqual(3000);
  });

  it('handles empty page', () => {
    const doc = getDoc();
    const result = extractPageContent(doc);
    expect(result.title).toBe('');
    expect(result.description).toBe('');
    expect(result.headings).toEqual([]);
    expect(result.content_preview).toBe('');
  });

  it('extracts structured content from a realistic blog page', () => {
    const doc = getDoc();
    doc.title = 'How to Build a Chrome Extension';
    const meta = doc.createElement('meta');
    meta.setAttribute('name', 'description');
    meta.setAttribute('content', 'A guide to Chrome extension development');
    doc.head.appendChild(meta);
    doc.body.innerHTML = `
      <main>
        <h1>How to Build a Chrome Extension</h1>
        <p>This is the introduction paragraph.</p>
        <h2>Step 1: Manifest</h2>
        <p>Create a manifest.json file.</p>
        <h3>JSON Structure</h3>
        <p>The manifest has specific fields.</p>
        <h2>Step 2: Background Script</h2>
        <p>Write your background script.</p>
      </main>
    `;
    const result = extractPageContent(doc);

    expect(result.title).toBe('How to Build a Chrome Extension');
    expect(result.description).toBe(
      'A guide to Chrome extension development',
    );
    expect(result.headings).toEqual([
      '# How to Build a Chrome Extension',
      '## Step 1: Manifest',
      '### JSON Structure',
      '## Step 2: Background Script',
    ]);
    expect(result.content_preview).toContain('This is the introduction paragraph.');
    expect(result.content_preview).toContain('Create a manifest.json file.');
  });
});
