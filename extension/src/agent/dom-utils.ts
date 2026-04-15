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

/** Honeypot-related substrings to check in name/id/class attributes. */
const HONEYPOT_NAME_SIGNALS = ['honeypot', 'hp_', 'ak_hp', 'trap', 'cloaked'];

/** Check if an element is a honeypot (anti-spam trap) field. */
export function isHoneypotField(el: Element): boolean {
  const htmlEl = el as HTMLElement;

  // Rule 1: aria-hidden="true"
  if (htmlEl.getAttribute('aria-hidden') === 'true') return true;

  // Rule 2: name/id/class contains honeypot-related keywords
  const name = (htmlEl.getAttribute('name') || '').toLowerCase();
  const id = (htmlEl.getAttribute('id') || '').toLowerCase();
  const cls = (htmlEl.getAttribute('class') || '').toLowerCase();
  const combined = `${name} ${id} ${cls}`;
  if (HONEYPOT_NAME_SIGNALS.some(s => combined.includes(s))) return true;

  // Rule 3: Label contains only non-alphanumeric characters (e.g. Delta)
  // We check aria-label and title as cheap label proxies since findLabel requires doc context
  const ariaLabel = htmlEl.getAttribute('aria-label') || '';
  const title = htmlEl.getAttribute('title') || '';
  const cheapLabel = ariaLabel || title;
  if (cheapLabel && !/[a-zA-Z0-9]/.test(cheapLabel)) return true;

  // Rule 4: tabindex < 0 and no label signals
  const tabindex = htmlEl.getAttribute('tabindex');
  if (tabindex !== null && parseInt(tabindex, 10) < 0 && !ariaLabel && !title && !htmlEl.id) return true;

  // Rule 5: autocomplete="off" and no label and non-standard name
  if (htmlEl.getAttribute('autocomplete') === 'off' && !ariaLabel && !title && !htmlEl.id) return true;

  return false;
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
  if (clipPath && clipPath !== 'none' && /inset\s*\(\s*100%\s*\)/.test(clipPath)) return false;

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
