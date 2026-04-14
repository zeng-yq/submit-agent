import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

// Import after DOM is available
let analyzeForms: typeof import('@/agent/FormAnalyzer').analyzeForms;
let classifyForm: typeof import('@/agent/FormAnalyzer').classifyForm;
let inferFieldPurpose: typeof import('@/agent/FormAnalyzer').inferFieldPurpose;
let inferEffectiveType: typeof import('@/agent/FormAnalyzer').inferEffectiveType;

let dom: JSDOM;

describe('FormAnalyzer', () => {

  beforeEach(async () => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      runScripts: 'dangerously',
      url: 'https://example.com',
    });
    // Dynamic import to get fresh module with correct `document`
    const mod = await import('@/agent/FormAnalyzer');
    analyzeForms = mod.analyzeForms;
    classifyForm = mod.classifyForm;
    inferFieldPurpose = mod.inferFieldPurpose;
    inferEffectiveType = mod.inferEffectiveType;
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
        <input type="text" name="display_name" aria-label="Search query">
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

  it('ensures selectors are unique when elements lack id and name', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <form>
        <div><input type="text"></div>
        <div><input type="text"></div>
        <div><input type="text"></div>
      </form>
    `;

    const result = analyzeForms(doc);

    // All 3 fields must have unique selectors
    const selectors = result.fields.map(f => f.selector);
    expect(new Set(selectors).size).toBe(3);

    // Each selector must resolve to exactly one element
    for (const selector of selectors) {
      expect(doc.querySelectorAll(selector)).toHaveLength(1);
    }
  });

  it('finds label via title attribute', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <form>
        <input type="text" name="display_name" title="Search keywords">
      </form>
    `;

    const result = analyzeForms(doc);

    expect(result.fields[0].label).toBe('Search keywords');
  });

  it('finds label via adjacent sibling <label> without for attribute', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <form>
        <label>Tool Name</label>
        <input type="text" name="tool_name" placeholder="Enter tool name">
      </form>
    `;

    const result = analyzeForms(doc);

    expect(result.fields[0].label).toBe('Tool Name');
  });

  it('finds label via parent container text (span before input)', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <form>
        <div class="form-group">
          <span class="field-label">Website URL</span>
          <input type="text" name="website" placeholder="https://example.com">
        </div>
      </form>
    `;

    const result = analyzeForms(doc);

    expect(result.fields[0].label).toBe('Website URL');
  });

  it('finds label via parent container text (div before input)', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <form>
        <div class="form-group">
          <div class="label-text">Company Name</div>
          <input type="text" name="company">
          <div class="help-text">Enter your company</div>
        </div>
      </form>
    `;

    const result = analyzeForms(doc);

    expect(result.fields[0].label).toBe('Company Name');
  });

  it('populates inferred_purpose when label is empty but placeholder has clues', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <form>
        <input type="text" name="website" placeholder="https://example.com">
      </form>
    `;

    const result = analyzeForms(doc);

    expect(result.fields[0].label).toBe('');
    expect(result.fields[0].inferred_purpose).toBe('website URL');
  });

  it('populates effective_type when type is text but signals indicate url', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <form>
        <input type="text" name="logo_url" placeholder="https://domain.com/logo.png">
      </form>
    `;

    const result = analyzeForms(doc);

    expect(result.fields[0].type).toBe('text');
    expect(result.fields[0].effective_type).toBe('url');
  });

  it('does not populate inferred_purpose when label is resolved', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <form>
        <label for="email">Email</label>
        <input type="text" id="email" name="email" placeholder="your@email.com">
      </form>
    `;

    const result = analyzeForms(doc);

    expect(result.fields[0].label).toBe('Email');
    expect(result.fields[0].inferred_purpose).toBe('');
  });

  it('real-world pattern: Next.js form with sibling labels', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <form>
        <div>
          <label>Tool Name</label>
          <input type="text" name="tool_name" placeholder="Enter your tool name">
        </div>
        <div>
          <label>Tool URL</label>
          <input type="text" name="tool_url" placeholder="https://yourtool.com">
        </div>
        <div>
          <label>Description</label>
          <textarea name="description" placeholder="Provide a detailed description..."></textarea>
        </div>
        <div>
          <label>Contact Name</label>
          <input type="text" name="contact_name" placeholder="Your full name">
        </div>
        <div>
          <label>Contact Email</label>
          <input type="email" name="contact_email" placeholder="your@email.com">
        </div>
      </form>
    `;

    const result = analyzeForms(doc);

    expect(result.fields).toHaveLength(5);
    expect(result.fields[0].label).toBe('Tool Name');
    expect(result.fields[1].label).toBe('Tool URL');
    expect(result.fields[2].label).toBe('Description');
    expect(result.fields[3].label).toBe('Contact Name');
    expect(result.fields[4].label).toBe('Contact Email');
  });

  it('filters out search form and returns only target form fields', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <form role="search">
        <input type="text" name="q">
      </form>
      <form id="submit-form" action="/submit">
        <input type="text" name="product_name" placeholder="Product Name">
        <input type="url" name="url" placeholder="Website URL">
      </form>
    `;
    const result = analyzeForms(doc);
    expect(result.fields).toHaveLength(2);
    expect(result.fields[0].name).toBe('product_name');
    expect(result.fields[1].name).toBe('url');
    expect(result.forms).toHaveLength(2);
    expect(result.forms[0].role).toBe('search');
    expect(result.forms[0].filtered).toBe(true);
    expect(result.forms[1].role).toBe('unknown');
    expect(result.forms[1].filtered).toBe(false);
  });

  it('filters out login and newsletter forms', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <form action="/login">
        <input name="email">
        <input type="password" name="password">
      </form>
      <form action="/subscribe">
        <input type="email" name="newsletter_email">
      </form>
      <form action="/submit-tool">
        <input name="tool_name">
        <textarea name="description"></textarea>
      </form>
    `;
    const result = analyzeForms(doc);
    expect(result.fields).toHaveLength(2);
    expect(result.fields[0].name).toBe('tool_name');
    expect(result.fields[1].name).toBe('description');
    expect(result.forms).toHaveLength(3);
    expect(result.forms[0].role).toBe('login');
    expect(result.forms[1].role).toBe('newsletter');
    expect(result.forms[2].role).toBe('unknown');
  });

  it('preserves all fields when no forms are classified as irrelevant', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <form action="/submit">
        <input name="name">
      </form>
      <form action="/add-listing">
        <input name="title">
        <input name="url">
      </form>
    `;
    const result = analyzeForms(doc);
    expect(result.fields).toHaveLength(3);
    expect(result.forms).toHaveLength(2);
    expect(result.forms[0].filtered).toBe(false);
    expect(result.forms[1].filtered).toBe(false);
  });

  it('returns empty forms array when no form tags exist (body fallback)', () => {
    const doc = getDoc();
    doc.body.innerHTML = `<input name="username"><input name="password">`;
    const result = analyzeForms(doc);
    expect(result.fields).toHaveLength(2);
    expect(result.forms).toHaveLength(0);
  });

  it('attaches form_index to each field from a form element', () => {
    const doc = getDoc();
    doc.body.innerHTML = `
      <form role="search">
        <input name="q">
      </form>
      <form id="target">
        <input name="name">
        <input name="email">
      </form>
    `;
    const result = analyzeForms(doc);
    expect(result.fields).toHaveLength(2);
    expect(result.fields[0].form_index).toBe(1);
    expect(result.fields[1].form_index).toBe(1);
  });

  it('does not attach form_index to fields from body fallback scan', () => {
    const doc = getDoc();
    doc.body.innerHTML = `<input name="username">`;
    const result = analyzeForms(doc);
    expect(result.fields[0].form_index).toBeUndefined();
  });
});

describe('inferFieldPurpose', () => {
  beforeEach(async () => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      runScripts: 'dangerously',
      url: 'https://example.com',
    });
    const mod = await import('@/agent/FormAnalyzer');
    inferFieldPurpose = mod.inferFieldPurpose;
  });

  it('returns empty string when label is present', () => {
    expect(inferFieldPurpose({ label: 'Name', placeholder: '', name: '', type: 'text' })).toBe('');
  });

  it('infers email from placeholder containing @', () => {
    expect(inferFieldPurpose({ label: '', placeholder: 'your@email.com', name: '', type: 'text' })).toBe('email address');
  });

  it('infers email from placeholder containing "email"', () => {
    expect(inferFieldPurpose({ label: '', placeholder: 'Enter your email', name: '', type: 'text' })).toBe('email address');
  });

  it('infers URL from placeholder containing https://', () => {
    expect(inferFieldPurpose({ label: '', placeholder: 'https://yourtool.com', name: '', type: 'text' })).toBe('website URL');
  });

  it('infers URL from type=url', () => {
    expect(inferFieldPurpose({ label: '', placeholder: '', name: '', type: 'url' })).toBe('website URL');
  });

  it('infers email from name attribute containing "email"', () => {
    expect(inferFieldPurpose({ label: '', placeholder: '', name: 'user_email', type: 'text' })).toBe('email address');
  });

  it('infers URL from name attribute containing "url"', () => {
    expect(inferFieldPurpose({ label: '', placeholder: '', name: 'website_url', type: 'text' })).toBe('website URL');
  });

  it('infers name from name attribute containing "author"', () => {
    expect(inferFieldPurpose({ label: '', placeholder: '', name: 'author_name', type: 'text' })).toBe('name');
  });

  it('infers description from name attribute containing "desc"', () => {
    expect(inferFieldPurpose({ label: '', placeholder: '', name: 'tool_description', type: 'text' })).toBe('description');
  });

  it('infers name from placeholder containing "name"', () => {
    expect(inferFieldPurpose({ label: '', placeholder: 'Your full name', name: '', type: 'text' })).toBe('full name');
  });

  it('returns empty string when no signal matches', () => {
    expect(inferFieldPurpose({ label: '', placeholder: 'something random', name: 'field_42', type: 'text' })).toBe('');
  });

  it('infers phone number from type=tel', () => {
    expect(inferFieldPurpose({ label: '', placeholder: '', name: '', type: 'tel' })).toBe('phone number');
  });
});

describe('inferEffectiveType', () => {
  beforeEach(async () => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      runScripts: 'dangerously',
      url: 'https://example.com',
    });
    const mod = await import('@/agent/FormAnalyzer');
    inferEffectiveType = mod.inferEffectiveType;
  });

  it('returns empty string for non-text types', () => {
    expect(inferEffectiveType({ label: '', placeholder: '', name: '', type: 'email' })).toBe('');
  });

  it('returns empty string for text type with no signals', () => {
    expect(inferEffectiveType({ label: '', placeholder: 'something', name: 'field_1', type: 'text' })).toBe('');
  });

  it('infers url from placeholder containing https://', () => {
    expect(inferEffectiveType({ label: '', placeholder: 'https://example.com', name: '', type: 'text' })).toBe('url');
  });

  it('infers url from placeholder containing http://', () => {
    expect(inferEffectiveType({ label: '', placeholder: 'http://example.com', name: '', type: 'text' })).toBe('url');
  });

  it('infers email from label containing "email"', () => {
    expect(inferEffectiveType({ label: 'Email Address', placeholder: '', name: '', type: 'text' })).toBe('email');
  });

  it('infers email from name containing "email"', () => {
    expect(inferEffectiveType({ label: '', placeholder: '', name: 'contact_email', type: 'text' })).toBe('email');
  });

  it('infers tel from combined signals containing "phone"', () => {
    expect(inferEffectiveType({ label: 'Phone', placeholder: '', name: '', type: 'text' })).toBe('tel');
  });
});

describe('classifyForm', () => {
  beforeEach(async () => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      runScripts: 'dangerously',
      url: 'https://example.com',
    });
    const mod = await import('@/agent/FormAnalyzer');
    classifyForm = mod.classifyForm;
  });

  function getDoc(): Document {
    return dom.window.document;
  }

  it('classifies form with role="search" as search', () => {
    const doc = getDoc();
    doc.body.innerHTML = `<form role="search"><input type="text" name="q"><button type="submit">Search</button></form>`;
    const form = doc.querySelector('form')!;
    const result = classifyForm(form, 0);
    expect(result.role).toBe('search');
    expect(result.filtered).toBe(true);
    expect(result.confidence).toBe('high');
  });

  it('classifies form with action="/search" as search', () => {
    const doc = getDoc();
    doc.body.innerHTML = `<form action="/search"><input type="text" name="q"></form>`;
    const form = doc.querySelector('form')!;
    const result = classifyForm(form, 0);
    expect(result.role).toBe('search');
    expect(result.filtered).toBe(true);
  });

  it('classifies form with password field as login', () => {
    const doc = getDoc();
    doc.body.innerHTML = `<form action="/login"><input name="email"><input type="password" name="password"><button>Login</button></form>`;
    const form = doc.querySelector('form')!;
    const result = classifyForm(form, 0);
    expect(result.role).toBe('login');
    expect(result.filtered).toBe(true);
  });

  it('classifies form with action="/subscribe" and single email as newsletter', () => {
    const doc = getDoc();
    doc.body.innerHTML = `<form action="/subscribe"><input type="email" name="email"><button>Subscribe</button></form>`;
    const form = doc.querySelector('form')!;
    const result = classifyForm(form, 0);
    expect(result.role).toBe('newsletter');
    expect(result.filtered).toBe(true);
  });

  it('classifies unknown form as unknown and not filtered', () => {
    const doc = getDoc();
    doc.body.innerHTML = `<form id="submit-form" action="/submit"><input name="product_name"><textarea name="description"></textarea></form>`;
    const form = doc.querySelector('form')!;
    const result = classifyForm(form, 0);
    expect(result.role).toBe('unknown');
    expect(result.filtered).toBe(false);
  });

  it('records form_id and form_action', () => {
    const doc = getDoc();
    doc.body.innerHTML = `<form id="my-form" action="/api/submit"><input name="name"></form>`;
    const form = doc.querySelector('form')!;
    const result = classifyForm(form, 0);
    expect(result.form_id).toBe('my-form');
    expect(result.form_action).toBe('/api/submit');
  });

  it('records field_count', () => {
    const doc = getDoc();
    doc.body.innerHTML = `<form><input name="a"><input name="b"><textarea name="c"></textarea></form>`;
    const form = doc.querySelector('form')!;
    const result = classifyForm(form, 0);
    expect(result.field_count).toBe(3);
  });

  it('does not classify form with ambiguous action as filtered', () => {
    const doc = getDoc();
    doc.body.innerHTML = `<form action="/process"><input name="title"><input name="url"></form>`;
    const form = doc.querySelector('form')!;
    const result = classifyForm(form, 0);
    expect(result.role).toBe('unknown');
    expect(result.filtered).toBe(false);
  });
});
