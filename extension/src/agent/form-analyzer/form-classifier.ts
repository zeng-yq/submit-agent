import type { FormGroup } from './types'

/**
 * Classify a <form> element's role (search, login, newsletter, or unknown).
 */
export function classifyForm(formEl: HTMLFormElement, formIndex: number): FormGroup {
  const id = formEl.id || undefined;
  const action = formEl.getAttribute('action') || undefined;
  const role = formEl.getAttribute('role') || '';

  const allInputs = formEl.querySelectorAll('input, textarea, select');
  let fieldCount = 0;
  let hasPassword = false;
  const fieldNames: string[] = [];

  for (const el of allInputs) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const type = (el as HTMLInputElement).type?.toLowerCase() || 'text';
      if (['hidden', 'submit', 'button', 'reset', 'image', 'file'].includes(type)) continue;
      if (type === 'password') hasPassword = true;
    }
    const name = el.getAttribute('name') || '';
    const elId = el.id || '';
    const cls = el.className || '';
    const captchaSignals = ['captcha', 'recaptcha', 'hcaptcha'];
    const combined = `${name} ${elId} ${cls}`.toLowerCase();
    if (captchaSignals.some(s => combined.includes(s))) continue;

    fieldCount++;
    fieldNames.push(name.toLowerCase());
  }

  if (role === 'search') {
    return { form_index: formIndex, role: 'search', confidence: 'high', form_id: id, form_action: action, field_count: fieldCount, filtered: true };
  }
  if (action && (action.includes('/search') || action.includes('?s='))) {
    return { form_index: formIndex, role: 'search', confidence: 'high', form_id: id, form_action: action, field_count: fieldCount, filtered: true };
  }
  if (fieldCount === 1 && fieldNames.some(n => ['q', 's', 'query', 'keyword', 'search_term', 'search'].includes(n))) {
    return { form_index: formIndex, role: 'search', confidence: 'high', form_id: id, form_action: action, field_count: fieldCount, filtered: true };
  }

  if (hasPassword && fieldCount <= 2) {
    return { form_index: formIndex, role: 'login', confidence: 'high', form_id: id, form_action: action, field_count: fieldCount, filtered: true };
  }
  if (action && (action.includes('/login') || action.includes('/signin') || action.includes('/auth'))) {
    return { form_index: formIndex, role: 'login', confidence: 'high', form_id: id, form_action: action, field_count: fieldCount, filtered: true };
  }
  if (fieldNames.some(n => n.includes('password') || n.includes('passwd'))) {
    return { form_index: formIndex, role: 'login', confidence: 'high', form_id: id, form_action: action, field_count: fieldCount, filtered: true };
  }

  if (action && (action.includes('/subscribe') || action.includes('/newsletter'))) {
    return { form_index: formIndex, role: 'newsletter', confidence: 'high', form_id: id, form_action: action, field_count: fieldCount, filtered: true };
  }
  if (fieldNames.some(n => n.includes('newsletter') || n.includes('subscribe') || n.includes('mailing'))) {
    return { form_index: formIndex, role: 'newsletter', confidence: 'high', form_id: id, form_action: action, field_count: fieldCount, filtered: true };
  }
  if (fieldCount === 1 && fieldNames.some(n => n.includes('email'))) {
    const submitButtons = formEl.querySelectorAll('button[type="submit"], input[type="submit"]');
    if (submitButtons.length > 0) {
      return { form_index: formIndex, role: 'newsletter', confidence: 'medium', form_id: id, form_action: action, field_count: fieldCount, filtered: true };
    }
  }

  return { form_index: formIndex, role: 'unknown', confidence: 'low', form_id: id, form_action: action, field_count: fieldCount, filtered: false };
}
