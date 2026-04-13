import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

// Import after DOM is available
let analyzeForms: typeof import('@/agent/FormAnalyzer').analyzeForms;

describe('FormAnalyzer', () => {
  let dom: JSDOM;

  beforeEach(async () => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      runScripts: 'dangerously',
      url: 'https://example.com',
    });
    // Dynamic import to get fresh module with correct `document`
    const mod = await import('@/agent/FormAnalyzer');
    analyzeForms = mod.analyzeForms;
  });

  function getDoc(): Document {
    return dom.window.document;
  }

  it('extracts basic form fields', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <form>
        <label for="name">Name</label>
        <input type="text" id="name" name="name" placeholder="Your name" required>
        <input type="email" id="email" name="email">
        <textarea id="comment" name="comment" placeholder="Your comment"></textarea>
      </form>
    `;

    const result = analyzeForms(doc);

    expect(result.fields).toHaveLength(3);
    expect(result.fields[0]).toMatchObject({
      canonical_id: 'field_0',
      name: 'name',
      id: 'name',
      type: 'text',
      label: 'Name',
      placeholder: 'Your name',
      required: true,
    });
    expect(result.fields[1]).toMatchObject({
      canonical_id: 'field_1',
      type: 'email',
    });
    expect(result.fields[2]).toMatchObject({
      canonical_id: 'field_2',
      type: 'textarea',
    });
  });

  it('assigns sequential canonical IDs', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <form>
        <input type="text" name="a">
        <input type="text" name="b">
        <input type="text" name="c">
      </form>
    `;

    const result = analyzeForms(doc);

    expect(result.fields[0].canonical_id).toBe('field_0');
    expect(result.fields[1].canonical_id).toBe('field_1');
    expect(result.fields[2].canonical_id).toBe('field_2');
  });

  it('skips hidden, submit, button, reset inputs', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <form>
        <input type="hidden" name="csrf" value="token">
        <input type="text" name="visible">
        <input type="submit" value="Submit">
        <input type="button" value="Cancel">
        <input type="reset" value="Reset">
        <input type="file" name="avatar">
      </form>
    `;

    const result = analyzeForms(doc);

    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].name).toBe('visible');
  });

  it('skips CAPTCHA elements', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <form>
        <input type="text" name="name">
        <div class="g-recaptcha" id="recaptcha"></div>
        <input type="text" name="h-captcha-response">
        <iframe src="https://recaptcha.net/widget"></iframe>
      </form>
    `;

    const result = analyzeForms(doc);

    // Only the "name" field should be extracted
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].name).toBe('name');
  });

  it('finds label via for attribute', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <form>
        <label for="email">Email Address</label>
        <input type="email" id="email" name="email">
      </form>
    `;

    const result = analyzeForms(doc);

    expect(result.fields[0].label).toBe('Email Address');
  });

  it('finds label via wrapping <label>', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <form>
        <label>Phone <input type="tel" name="phone"></label>
      </form>
    `;

    const result = analyzeForms(doc);

    expect(result.fields[0].label).toBe('Phone');
  });

  it('finds label via aria-label', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <form>
        <input type="text" name="search" aria-label="Search query">
      </form>
    `;

    const result = analyzeForms(doc);

    expect(result.fields[0].label).toBe('Search query');
  });

  it('scans document when no <form> elements exist', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <input type="text" name="username" placeholder="Username">
      <input type="password" name="password" placeholder="Password">
    `;

    const result = analyzeForms(doc);

    expect(result.fields).toHaveLength(2);
  });

  it('handles empty page gracefully', () => {
    const doc = getDoc();
    doc.body.innerHTML = '';

    const result = analyzeForms(doc);

    expect(result.fields).toHaveLength(0);
    expect(result.page_info).toBeDefined();
    expect(result.page_info.title).toBe('');
  });

  it('extracts page info (title, description, headings)', () => {
    const doc = getDoc();
    doc.title = 'My Blog Post';
    const meta = doc.createElement('meta');
    meta.setAttribute('name', 'description');
    meta.setAttribute('content', 'A post about things');
    doc.head.appendChild(meta);
    doc.body.innerHTML = `
      <main>
        <h1>Main Title</h1>
        <h2>Section One</h2>
        <p>Some content here.</p>
        <h2>Section Two</h2>
        <p>More content.</p>
      </main>
    `;

    const result = analyzeForms(doc);

    expect(result.page_info.title).toBe('My Blog Post');
    expect(result.page_info.description).toBe('A post about things');
    expect(result.page_info.headings).toEqual([
      '# Main Title',
      '## Section One',
      '## Section Two',
    ]);
    expect(result.page_info.content_preview).toContain('Some content here');
  });

  it('extracts content from <article> when no <main>', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <article>
        <p>This is article content that should be extracted.</p>
      </article>
    `;

    const result = analyzeForms(doc);

    expect(result.page_info.content_preview).toContain(
      'This is article content',
    );
  });

  it('truncates content preview to 3000 characters', () => {
    const doc = getDoc();
    const longContent = 'A'.repeat(5000);
    doc.body.innerHTML = `<main>${longContent}</main>`;

    const result = analyzeForms(doc);

    expect(result.page_info.content_preview.length).toBeLessThanOrEqual(3000);
  });

  it('handles select elements', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <form>
        <label for="country">Country</label>
        <select id="country" name="country">
          <option value="us">United States</option>
          <option value="cn">China</option>
        </select>
      </form>
    `;

    const result = analyzeForms(doc);

    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]).toMatchObject({
      type: 'select',
      tagName: 'select',
      label: 'Country',
    });
  });

  it('generates valid CSS selectors', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <form>
        <input type="text" id="my-field" name="my_field">
        <input type="text" name="no-id-field">
      </form>
    `;

    const result = analyzeForms(doc);

    // Element with id: use #id
    expect(result.fields[0].selector).toBe('#my-field');
    // Element without id: use tag[name]
    expect(result.fields[1].selector).toBe(
      'input[name="no-id-field"]',
    );
  });
});
