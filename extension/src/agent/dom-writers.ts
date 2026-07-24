/**
 * DOM writers + waiting utilities (L5 infrastructure).
 * 搬运自原 dom-utils.ts（SP-3b 拆分）。
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
  el.dispatchEvent(new Event('blur', { bubbles: true }));
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
  el.dispatchEvent(new Event('blur', { bubbles: true }));
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

/**
 * Fill a form field and verify the value was actually written.
 * Retries with execCommand fallback if verification fails.
 * Returns true if the value was successfully written.
 */
export async function fillAndVerify(
  el: HTMLElement,
  value: string,
  retries = 2,
): Promise<boolean> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt === 0) {
      fillField(el, value);
    } else {
      // Retry: use execCommand as fallback for framework-managed inputs
      el.focus();
      if ((el as HTMLInputElement).select) {
        (el as HTMLInputElement).select();
      }
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, value);
    }

    // Wait for framework to process
    await new Promise(r => setTimeout(r, 50 * (attempt + 1)));

    // Check element is still in the document
    if (!el.isConnected) return false;

    // Read actual value — use innerHTML for contenteditable with HTML content
    // since textContent strips tags and will never match HTML values
    let actual: string
    if ((el as HTMLElement).isContentEditable && /<[a-z][\s\S]*>/i.test(value)) {
      actual = el.innerHTML ?? ''
    } else {
      actual = (el as HTMLInputElement).value ?? el.textContent ?? ''
    }

    if (actual.trim() === value.trim()) return true;
  }

  return false;
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

  // 2. MutationObserver for dynamically added fields
  // Content script is injected at document_end (readyState >= 'interactive'),
  // so MutationObserver can work immediately. We intentionally do NOT wait for
  // readyState 'complete' because pages with persistent connections (analytics,
  // websockets, SSE) may never reach that state.
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
