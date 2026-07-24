/**
 * Field filter / judgment predicates (L4 domain).
 * 搬运自原 dom-utils.ts（SP-3b 拆分）。
 */

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

/** 蜜罐各信号的评分权重（值搬运自原 honeypotScore，逐字保留） */
const HONEYPOT_WEIGHTS = {
  ariaHidden: 80,        // aria-hidden="true"
  namePattern: 60,       // name/id/class 命中 honeypot 模式
  nonAlnumLabel: 40,     // aria-label/title 仅非字母数字
  negativeTabindex: 50,  // tabindex<0 且无 label 信号
  autocompleteOff: 50,   // autocomplete=off 且无 label 且非标准 name
  hiddenParent: 50,      // 祖先 display:none/visibility:hidden
  fontSizeZero: 60,      // font-size:0
  zeroMaxDimension: 50,  // max-height/max-width:0
} as const

/** 蜜罐判定阈值（>= 此值判为 honeypot） */
const HONEYPOT_THRESHOLD = 50

/** Score an element's likelihood of being a honeypot field. Returns 0–100+. */
export function honeypotScore(el: Element): number {
  const htmlEl = el as HTMLElement;
  let score = 0;

  // Signal: aria-hidden="true"
  if (htmlEl.getAttribute('aria-hidden') === 'true') score += HONEYPOT_WEIGHTS.ariaHidden;

  // Signal: name/id/class matches honeypot patterns
  const name = (htmlEl.getAttribute('name') || '').toLowerCase();
  const id = (htmlEl.getAttribute('id') || '').toLowerCase();
  const cls = (htmlEl.getAttribute('class') || '').toLowerCase();
  const combined = `${name} ${id} ${cls}`;
  if (HONEYPOT_NAME_PATTERNS.some(p => p.test(combined))) score += HONEYPOT_WEIGHTS.namePattern;

  // Signal: label contains only non-alphanumeric characters
  const ariaLabel = htmlEl.getAttribute('aria-label') || '';
  const title = htmlEl.getAttribute('title') || '';
  const cheapLabel = ariaLabel || title;
  if (cheapLabel && !/[a-zA-Z0-9]/.test(cheapLabel)) score += HONEYPOT_WEIGHTS.nonAlnumLabel;

  // Signal: tabindex < 0 and no label signals
  const tabindex = htmlEl.getAttribute('tabindex');
  if (tabindex !== null && parseInt(tabindex, 10) < 0 && !ariaLabel && !title && !htmlEl.id) score += HONEYPOT_WEIGHTS.negativeTabindex;

  // Signal: autocomplete="off" and no label and non-standard name
  if (htmlEl.getAttribute('autocomplete') === 'off' && !ariaLabel && !title && !htmlEl.id) score += HONEYPOT_WEIGHTS.autocompleteOff;

  // Signal: parent element hidden
  let parent = htmlEl.parentElement;
  while (parent && parent !== htmlEl.ownerDocument.body) {
    const ps = parent.ownerDocument.defaultView?.getComputedStyle(parent);
    if (ps) {
      if (ps.display === 'none' || ps.visibility === 'hidden') { score += HONEYPOT_WEIGHTS.hiddenParent; break; }
    }
    parent = parent.parentElement;
  }

  // Signal: font-size: 0 (visual hiding)
  const style = htmlEl.ownerDocument.defaultView?.getComputedStyle(htmlEl);
  if (style && parseFloat(style.fontSize) === 0) score += HONEYPOT_WEIGHTS.fontSizeZero;

  // Signal: max-height or max-width: 0 (CSS transition hiding)
  if (style && (parseFloat(style.maxHeight) === 0 || parseFloat(style.maxWidth) === 0)) score += HONEYPOT_WEIGHTS.zeroMaxDimension;

  return score;
}

/** Check if an element is a honeypot (anti-spam trap) field. Threshold: score >= 50. */
export function isHoneypotField(el: Element): boolean {
  return honeypotScore(el) >= HONEYPOT_THRESHOLD;
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
