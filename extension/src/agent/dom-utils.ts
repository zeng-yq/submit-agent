/**
 * Native DOM utility functions for form filling.
 * Replaces @page-agent/page-controller with lightweight, focused operations.
 */

/** Reset React's internal value tracker via injected page-context script. */
function resetReactTracker(el: HTMLElement): void {
  try {
    const marker = 'data-sa-fill'
    el.setAttribute(marker, '')
    const script = document.createElement('script')
    script.textContent = `(function(){
      var el = document.querySelector('[${marker}]');
      if (!el) return;
      el.removeAttribute('${marker}');
      if (el._valueTracker) { el._valueTracker.setValue(''); }
    })();`
    document.documentElement.appendChild(script)
    script.remove()
  } catch {
    // CSP or other errors — ignore gracefully
  }
}

/** Set value on an <input> element and dispatch events for React/Vue. */
export function setInputValue(el: HTMLInputElement, value: string): void {
  el.focus()

  // Use the native setter to bypass React's read-only value property
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(el, value);
  } else {
    el.value = value;
  }

  // Reset React's value tracker so React perceives the change
  resetReactTracker(el)

  el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Set value on a <textarea> element and dispatch events. */
export function setTextareaValue(el: HTMLTextAreaElement, value: string): void {
  el.focus()

  const nativeSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )?.set;
  if (nativeSetter) {
    nativeSetter.call(el, value);
  } else {
    el.value = value;
  }

  // Reset React's value tracker so React perceives the change
  resetReactTracker(el)

  el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Set value on a <select> element and dispatch change event. */
export function setSelectValue(el: HTMLSelectElement, value: string): void {
  el.focus()
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Set text content on a contenteditable element and dispatch input event. */
export function setContentEditable(el: HTMLElement, value: string): void {
  el.focus()

  // Use innerHTML for HTML content (e.g. blog comments with <a> links)
  if (/<[a-z][\s\S]*>/i.test(value)) {
    el.innerHTML = value;
  } else {
    el.textContent = value;
  }

  el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
}

/** Fill any form field based on its element type. */
export function fillField(el: HTMLElement, value: string): void {
  const tag = el.tagName.toLowerCase();

  if (tag === 'input') {
    setInputValue(el as HTMLInputElement, value);
  } else if (tag === 'textarea') {
    setTextareaValue(el as HTMLTextAreaElement, value);
  } else if (tag === 'select') {
    setSelectValue(el as HTMLSelectElement, value);
  } else if ((el as HTMLElement).isContentEditable) {
    setContentEditable(el, value);
  }
}

/** Wait for the next animation frame. */
export function waitForRAF(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Check if the document has any form fields. */
function hasFormFields(doc: Document): boolean {
  return doc.querySelectorAll('input[type="text"], input[type="email"], input[type="url"], input[type="tel"], input[type="search"], input:not([type]), textarea, select').length > 0;
}

/**
 * Wait for form fields to appear on the page.
 * Returns immediately if fields already exist, otherwise uses MutationObserver
 * with a timeout fallback. Designed for SPA pages where forms load dynamically.
 */
export async function waitForFormFields(timeoutMs = 5000): Promise<void> {
  const doc = window.document;

  // 1. Already have form fields
  if (hasFormFields(doc)) return;

  // 2. Wait for page to fully load
  if (doc.readyState !== 'complete') {
    await new Promise<void>(r => {
      const handler = () => { r(); };
      doc.addEventListener('readystatechange', handler, { once: true });
      window.addEventListener('load', handler, { once: true });
    });
    if (hasFormFields(doc)) return;
  }

  // 3. MutationObserver for dynamically added fields
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);

    const observer = new MutationObserver(() => {
      if (hasFormFields(doc)) {
        clearTimeout(timeout);
        observer.disconnect();
        resolve();
      }
    });

    observer.observe(doc.body, { childList: true, subtree: true });
  });

  // 4. Extra macro task for framework rendering
  await new Promise(r => setTimeout(r, 100));
}

/** CAPTCHA-related selectors to skip. */
const CAPTCHA_SELECTORS = [
  '[name*="captcha"]',
  '[name*="recaptcha"]',
  '[name*="hcaptcha"]',
  '[id*="captcha"]',
  '[id*="recaptcha"]',
  '[class*="captcha"]',
  '[class*="recaptcha"]',
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  '.g-recaptcha',
  '.h-captcha',
];

/** Check if an element is a CAPTCHA element. */
function isCaptchaElement(el: Element): boolean {
  if (CAPTCHA_SELECTORS.some((sel) => el.matches?.(sel))) return true;
  // Check iframe src
  if (el.tagName === 'IFRAME') {
    const src = (el as HTMLIFrameElement).src || '';
    if (src.includes('recaptcha') || src.includes('hcaptcha')) return true;
  }
  return false;
}

/** Regex patterns that indicate a honeypot (anti-spam trap) field. */
const HONEYPOT_NAME_PATTERNS: RegExp[] = [
  /honeypot/i,
  /hp_/i,
  /ak_hp/i,
  /trap/i,
  /cloaked/i,
  /^_wpcf7/i,         // Contact Form 7 internal fields
  /nospam/i,
  /no.?spam/i,
  /antispam/i,
  /anti.?bot/i,
  /wpbruiser/i,
  /gotcha/i,
  /[a-f0-9]{32,}/i, // Random hash-named hidden fields (32+ hex chars)
];

/** Score an element's likelihood of being a honeypot field. Returns 0–100+. */
export function honeypotScore(el: Element): number {
  const htmlEl = el as HTMLElement;
  let score = 0;

  // Signal: aria-hidden="true"
  if (htmlEl.getAttribute('aria-hidden') === 'true') score += 80;

  // Signal: name/id/class matches honeypot patterns
  const name = (htmlEl.getAttribute('name') || '').toLowerCase();
  const id = (htmlEl.getAttribute('id') || '').toLowerCase();
  const cls = (htmlEl.getAttribute('class') || '').toLowerCase();
  const combined = `${name} ${id} ${cls}`;
  if (HONEYPOT_NAME_PATTERNS.some(p => p.test(combined))) score += 60;

  // Signal: label contains only non-alphanumeric characters
  const ariaLabel = htmlEl.getAttribute('aria-label') || '';
  const title = htmlEl.getAttribute('title') || '';
  const cheapLabel = ariaLabel || title;
  if (cheapLabel && !/[a-zA-Z0-9]/.test(cheapLabel)) score += 40;

  // Signal: tabindex < 0 and no label signals
  const tabindex = htmlEl.getAttribute('tabindex');
  if (tabindex !== null && parseInt(tabindex, 10) < 0 && !ariaLabel && !title && !htmlEl.id) score += 50;

  // Signal: autocomplete="off" and no label and non-standard name
  if (htmlEl.getAttribute('autocomplete') === 'off' && !ariaLabel && !title && !htmlEl.id) score += 50;

  // Signal: parent element hidden
  let parent = htmlEl.parentElement;
  while (parent && parent !== htmlEl.ownerDocument.body) {
    const ps = parent.ownerDocument.defaultView?.getComputedStyle(parent);
    if (ps) {
      if (ps.display === 'none' || ps.visibility === 'hidden') { score += 50; break; }
    }
    parent = parent.parentElement;
  }

  // Signal: font-size: 0 (visual hiding)
  const style = htmlEl.ownerDocument.defaultView?.getComputedStyle(htmlEl);
  if (style && parseFloat(style.fontSize) === 0) score += 60;

  // Signal: max-height or max-width: 0 (CSS transition hiding)
  if (style && (parseFloat(style.maxHeight) === 0 || parseFloat(style.maxWidth) === 0)) score += 50;

  return score;
}

/** Check if an element is a honeypot (anti-spam trap) field. Threshold: score >= 50. */
export function isHoneypotField(el: Element): boolean {
  return honeypotScore(el) >= 50;
}

/** Types of input elements to skip. */
const SKIP_INPUT_TYPES = new Set([
  'hidden',
  'submit',
  'button',
  'reset',
  'image',
  'file',
]);

/** Check if an element is visually visible on the page. */
export function isVisible(el: Element): boolean {
  const htmlEl = el as HTMLElement;
  const style = window.getComputedStyle(htmlEl);
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  if (parseFloat(style.opacity) === 0) return false;

  // Ancestor traversal: check if any parent is hidden
  let parent = htmlEl.parentElement;
  while (parent && parent !== htmlEl.ownerDocument.body) {
    const ps = parent.ownerDocument.defaultView?.getComputedStyle(parent);
    if (ps && (ps.display === 'none' || ps.visibility === 'hidden')) return false;
    parent = parent.parentElement;
  }

  // Off-screen positioning: absolute/fixed with coordinate far outside viewport
  const position = style.position;
  if (position === 'absolute' || position === 'fixed') {
    const coords = ['left', 'top', 'right', 'bottom'] as const;
    for (const prop of coords) {
      const val = parseFloat(style[prop]);
      if (!isNaN(val) && val < -500) return false;
    }
  }

  // CSS clipping: clip or clip-path that hides the element
  const clip = style.clip;
  if (clip && clip !== 'auto' && /^(rect|inset)\s*\(.*0.*,\s*0.*,\s*0.*,\s*0/i.test(clip)) return false;
  const clipPath = style.clipPath;
  if (clipPath && clipPath !== 'none') {
    if (/inset\s*\(\s*100%\s*\)/.test(clipPath)) return false;
    if (/inset\s*\(\s*50%\s*\)/.test(clipPath)) return false;
    if (/polygon\s*\(\s*0\s+0\s*\)/.test(clipPath)) return false;
  }

  // Visual hiding via font-size: 0
  if (parseFloat(style.fontSize) === 0) return false;

  // Visual hiding via max-height/max-width: 0 (CSS transition trick)
  if (parseFloat(style.maxHeight) === 0 || parseFloat(style.maxWidth) === 0) return false;

  // Dimension check only in real browsers (JSDOM has no layout engine,
  // so offsetWidth/Height are always 0 — use body as a canary)
  const body = htmlEl.ownerDocument.body;
  if (body && (body.offsetWidth || body.offsetHeight || body.getClientRects().length)) {
    if (!htmlEl.offsetWidth && !htmlEl.offsetHeight && !htmlEl.getClientRects().length) return false;
  }
  return true;
}

/** Check if an element is a form field we should analyze/fill. */
export function isFormField(el: Element): boolean {
  const tag = el.tagName.toLowerCase();

  // Check for CAPTCHA first
  if (isCaptchaElement(el)) return false;

  // Check for honeypot (anti-spam trap) fields
  if (isHoneypotField(el)) return false;

  // Skip elements that are visually hidden via CSS
  if (!isVisible(el)) return false;

  if (tag === 'input') {
    const type = (el as HTMLInputElement).type?.toLowerCase() || 'text';
    if (SKIP_INPUT_TYPES.has(type)) return false;
    return true;
  }

  if (tag === 'textarea' || tag === 'select') return true;

  // contenteditable elements (but not the ones used by rich text editors for layout)
  if ((el as HTMLElement).isContentEditable) {
    const role = el.getAttribute('role');
    if (role === 'textbox') return true;
    // Accept explicit contenteditable inside form or comment context
    // (wpDiscuz and similar plugins use contenteditable divs without role="textbox")
    if (el.hasAttribute('contenteditable')) {
      if (el.closest('form, .comment-form, #respond, #commentform, .wpd_comm_form, .wpd-form, .wpdiscuz-textarea-wrap, #wpdcom, [class*="comment-form"], [id*="comment-form"]')) {
        return true;
      }
    }
    // Skip generic contenteditable divs without a form context
    return false;
  }

  return false;
}
