(() => {
  // --- 工具函数 ---

  function cssEscape(str) {
    if (!str) return '';
    return String(str).replace(/([!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~])/g, '\\$1');
  }

  function isVisible(el) {
    if (!el || !el.ownerDocument || !el.ownerDocument.defaultView) return false;
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (parseFloat(style.opacity) <= 0) return false;
    if (parseFloat(style.fontSize) === 0) return false;
    // max-height: 0 with overflow hidden
    if (parseFloat(style.maxHeight) === 0 && style.overflow === 'hidden') return false;
    // clip/clip-path hiding
    if (style.clip === 'rect(0px, 0px, 0px, 0px)' ||
        style.clip === 'rect(0px 0px 0px 0px)') return false;
    if (style.clipPath && style.clipPath !== 'none') {
      if (style.clipPath === 'inset(100%)' || style.clipPath === 'circle(0px)') return false;
    }
    // Check ancestors
    let parent = el.parentElement;
    while (parent && parent !== el.ownerDocument.documentElement) {
      const pStyle = el.ownerDocument.defaultView.getComputedStyle(parent);
      if (pStyle.display === 'none') return false;
      if (pStyle.visibility === 'hidden' || pStyle.visibility === 'collapse') return false;
      if (parseFloat(pStyle.opacity) <= 0) return false;
      parent = parent.parentElement;
    }
    // Offscreen check
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) return false;
    return true;
  }

  function isCaptchaElement(el) {
    // reCAPTCHA
    if (el.closest('.g-recaptcha') || el.closest('[data-sitekey]') ||
        el.closest('.recaptcha') || el.closest('#recaptcha')) return true;
    // hCaptcha
    if (el.closest('.h-captcha') || el.closest('[data-hcaptcha-widget-id]') ||
        el.closest('.hcaptcha')) return true;
    // reCAPTCHA iframe area
    if (el.closest('iframe[src*="recaptcha"]') || el.closest('iframe[src*="hcaptcha"]')) return true;
    // Common captcha class/id patterns
    const cn = (el.className || '').toString().toLowerCase();
    const id = (el.id || '').toLowerCase();
    if (cn.includes('captcha') || id.includes('captcha')) return true;
    // reCAPTCHA response textarea
    if (el.name === 'g-recaptcha-response') return true;
    return false;
  }

  function isFormField(el) {
    if (isCaptchaElement(el)) return false;
    if (!isVisible(el)) return false;
    const tag = el.tagName.toUpperCase();
    if (tag === 'INPUT') {
      const type = (el.type || 'text').toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image', 'file'].includes(type)) return false;
      return true;
    }
    if (tag === 'TEXTAREA') return true;
    if (tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function findLabel(el) {
    // Level 1: <label for="id">
    if (el.id) {
      const label = document.querySelector('label[for="' + cssEscape(el.id) + '"]');
      if (label) {
        const text = label.textContent.trim();
        if (text) return text;
      }
    }

    // Level 2: Wrapping <label> (clone, remove inputs, get text)
    const wrappingLabel = el.closest('label');
    if (wrappingLabel) {
      const clone = wrappingLabel.cloneNode(true);
      // Remove all form inputs from clone to get pure label text
      const inputs = clone.querySelectorAll('input, textarea, select, button, [contenteditable]');
      for (let i = 0; i < inputs.length; i++) {
        inputs[i].remove();
      }
      const text = clone.textContent.trim();
      if (text) return text;
    }

    // Level 3: aria-label
    if (el.hasAttribute('aria-label')) {
      const text = el.getAttribute('aria-label').trim();
      if (text) return text;
    }

    // Level 4: aria-labelledby
    if (el.hasAttribute('aria-labelledby')) {
      const ids = el.getAttribute('aria-labelledby').trim().split(/\s+/);
      for (let i = 0; i < ids.length; i++) {
        const refEl = document.getElementById(ids[i]);
        if (refEl) {
          const text = refEl.textContent.trim();
          if (text) return text;
        }
      }
    }

    // Level 5: title
    if (el.hasAttribute('title')) {
      const text = el.getAttribute('title').trim();
      if (text) return text;
    }

    // Level 6: Previous sibling <label>
    let prev = el.previousElementSibling;
    while (prev) {
      if (prev.tagName.toUpperCase() === 'LABEL') {
        const text = prev.textContent.trim();
        if (text) return text;
      }
      prev = prev.previousElementSibling;
    }

    // Level 7: Parent container previous sibling (LABEL/SPAN/DIV/P/H1-H6)
    let parent = el.parentElement;
    if (parent) {
      let parentPrev = parent.previousElementSibling;
      while (parentPrev) {
        const tag = parentPrev.tagName.toUpperCase();
        if (['LABEL', 'SPAN', 'DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(tag)) {
          const text = parentPrev.textContent.trim();
          if (text && text.length < 200) return text;
        }
        parentPrev = parentPrev.previousElementSibling;
      }
    }

    return '';
  }

  function inferFieldPurpose(field) {
    const name = (field.name || '').toLowerCase();
    const placeholder = (field.placeholder || '').toLowerCase();
    const type = (field.type || '').toLowerCase();
    const tag = field.tagName.toUpperCase();
    const effective = type === 'text' || type === '' ? (tag === 'TEXTAREA' ? 'textarea' : type) : type;

    // Email
    if (effective === 'email' || name.includes('email') || name.includes('mail') ||
        placeholder.includes('email') || placeholder.includes('e-mail')) return 'email';
    // URL / Website
    if (effective === 'url' || name.includes('url') || name.includes('website') ||
        name.includes('web') || name.includes('link') || name.includes('site') ||
        placeholder.includes('url') || placeholder.includes('website') || placeholder.includes('http')) return 'url';
    // Name / Author
    if (name.includes('author') || name.includes('name') || name.includes('user') ||
        name.includes('nick') || placeholder.includes('name') || placeholder.includes('author')) return 'name';
    // Description
    if (name.includes('description') || placeholder.includes('description')) return 'description';
    // Title
    if (name.includes('title') || name.includes('subject') ||
        placeholder.includes('title') || placeholder.includes('subject')) return 'title';
    // Category
    if (name.includes('category') || name.includes('cat') ||
        placeholder.includes('category')) return 'category';
    // Comment / Message (textarea defaults to comment)
    if (tag === 'TEXTAREA' || effective === 'textarea') {
      if (name.includes('comment') || name.includes('message') || name.includes('msg') ||
          placeholder.includes('comment') || placeholder.includes('message')) return 'comment';
      return 'comment'; // Default textarea purpose
    }
    // Phone
    if (effective === 'tel' || name.includes('phone') || name.includes('tel') ||
        placeholder.includes('phone')) return 'phone';

    return '';
  }

  function inferEffectiveType(field) {
    const declared = (field.type || 'text').toLowerCase();
    if (declared !== 'text' && declared !== '') return declared;
    if (field.tagName.toUpperCase() === 'TEXTAREA') return 'textarea';
    if (field.tagName.toUpperCase() === 'SELECT') return 'select';
    if (field.isContentEditable) return 'contenteditable';

    // Infer from context
    const name = (field.name || '').toLowerCase();
    const placeholder = (field.placeholder || '').toLowerCase();

    if (name.includes('email') || name.includes('mail') ||
        placeholder.includes('email') || placeholder.includes('e-mail')) return 'email';
    if (name.includes('url') || name.includes('website') || name.includes('web') ||
        name.includes('link') || name.includes('site') ||
        placeholder.includes('url') || placeholder.includes('website')) return 'url';
    if (name.includes('phone') || name.includes('tel') ||
        placeholder.includes('phone')) return 'tel';

    return 'text';
  }

  function classifyForm(formEl, formIndex) {
    const html = formEl.innerHTML.toLowerCase();
    const action = (formEl.action || '').toLowerCase();
    const formId = (formEl.id || '').toLowerCase();
    const formClass = (formEl.className || '').toString().toLowerCase();

    // Collect field types within this form
    const inputs = formEl.querySelectorAll('input, textarea, select');
    let hasSearchButton = false;
    let hasEmailField = false;
    let hasPasswordField = false;
    let hasTextarea = false;
    let hasUrlField = false;

    for (let i = 0; i < inputs.length; i++) {
      const inp = inputs[i];
      const type = (inp.type || 'text').toLowerCase();
      const name = (inp.name || '').toLowerCase();
      if (type === 'password') hasPasswordField = true;
      if (type === 'email' || name.includes('email') || name.includes('mail')) hasEmailField = true;
      if (inp.tagName.toUpperCase() === 'TEXTAREA') hasTextarea = true;
      if (type === 'url' || name.includes('url') || name.includes('website') || name.includes('link')) hasUrlField = true;
    }

    // Search button detection
    const buttons = formEl.querySelectorAll('button, input[type="submit"]');
    for (let i = 0; i < buttons.length; i++) {
      const btnText = (buttons[i].textContent || buttons[i].value || '').toLowerCase().trim();
      const btnClass = (buttons[i].className || '').toString().toLowerCase();
      if (btnText === 'search' || btnText.includes('find') || btnClass.includes('search')) {
        hasSearchButton = true;
      }
    }

    // --- Search form ---
    if (hasSearchButton || formId.includes('search') || formClass.includes('search') ||
        action.includes('search')) {
      return { role: 'search', confidence: 'high', filtered: true };
    }
    // Single text input + search-like button
    const visibleInputs = Array.from(inputs).filter(inp => {
      const t = (inp.type || 'text').toLowerCase();
      return !['hidden', 'submit', 'button', 'reset', 'image', 'file'].includes(t);
    });
    if (visibleInputs.length === 1 && visibleInputs[0].tagName.toUpperCase() === 'INPUT' &&
        (visibleInputs[0].type || 'text').toLowerCase() === 'text') {
      const ph = (visibleInputs[0].placeholder || '').toLowerCase();
      if (ph.includes('search') || ph.includes('find') || ph.includes('look')) {
        return { role: 'search', confidence: 'medium', filtered: true };
      }
    }

    // --- Login form ---
    if (hasPasswordField && hasEmailField) {
      return { role: 'login', confidence: 'high', filtered: true };
    }
    if (hasPasswordField) {
      // Password alone or with text input — likely login/register
      const textCount = visibleInputs.filter(inp =>
        (inp.type || 'text').toLowerCase() === 'text' && inp.tagName.toUpperCase() === 'INPUT'
      ).length;
      if (textCount <= 1 && !hasTextarea) {
        return { role: 'login', confidence: 'high', filtered: true };
      }
    }
    if (formId.includes('login') || formClass.includes('login') || action.includes('login') ||
        formId.includes('signin') || formClass.includes('signin') || action.includes('signin')) {
      return { role: 'login', confidence: 'high', filtered: true };
    }

    // --- Newsletter ---
    if (formId.includes('newsletter') || formClass.includes('newsletter') ||
        action.includes('newsletter') || action.includes('subscribe')) {
      return { role: 'newsletter', confidence: 'high', filtered: true };
    }
    // Single email field form (common newsletter pattern)
    if (hasEmailField && !hasTextarea && !hasUrlField && !hasPasswordField) {
      const nonHiddenInputs = visibleInputs.filter(inp => {
        const t = (inp.type || 'text').toLowerCase();
        return t !== 'hidden';
      });
      if (nonHiddenInputs.length <= 2) {
        return { role: 'newsletter', confidence: 'medium', filtered: true };
      }
    }

    return { role: 'unknown', confidence: 'low', filtered: false };
  }

  function buildSelector(el) {
    // Prefer id
    if (el.id) {
      return '#' + cssEscape(el.id);
    }
    // Prefer name
    if (el.name) {
      const byName = document.querySelectorAll('[name="' + cssEscape(el.name) + '"]');
      if (byName.length === 1) {
        return '[name="' + cssEscape(el.name) + '"]';
      }
    }
    // Build path with nth-of-type
    const parts = [];
    let current = el;
    while (current && current !== document.documentElement) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        selector = '#' + cssEscape(current.id);
        parts.unshift(selector);
        break;
      }
      // nth-of-type among siblings
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          s => s.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const idx = siblings.indexOf(current) + 1;
          selector += ':nth-of-type(' + idx + ')';
        }
      }
      parts.unshift(selector);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  function extractPageInfo() {
    const title = document.title || '';
    let description = '';
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      description = metaDesc.getAttribute('content') || '';
    }
    const headings = [];
    const hEls = document.querySelectorAll('h1, h2, h3');
    for (let i = 0; i < hEls.length; i++) {
      const text = hEls[i].textContent.trim();
      if (text) headings.push(text);
    }
    let contentPreview = '';
    if (document.body) {
      contentPreview = document.body.innerText || document.body.textContent || '';
      contentPreview = contentPreview.replace(/\s+/g, ' ').trim().substring(0, 3000);
    }
    return {
      title: title,
      description: description,
      headings: headings,
      content_preview: contentPreview
    };
  }

  // --- 主分析函数 ---

  function analyzeForms() {
    const fields = [];
    const formsResult = [];
    const allForms = document.querySelectorAll('form');
    let fieldCounter = 0;

    for (let fi = 0; fi < allForms.length; fi++) {
      const formEl = allForms[fi];
      const classification = classifyForm(formEl, fi);
      const formFields = formEl.querySelectorAll('input, textarea, select, [contenteditable]');
      let formFieldCount = 0;

      for (let j = 0; j < formFields.length; j++) {
        const el = formFields[j];
        if (!isFormField(el)) continue;

        formFieldCount++;

        const label = findLabel(el);
        const effectiveType = inferEffectiveType(el);
        let inferredPurpose = inferFieldPurpose(el);

        // Set data attribute for later retrieval by form-filler
        el.setAttribute('data-sa-field-' + fieldCounter, '');

        fields.push({
          canonical_id: 'field_' + fieldCounter,
          name: el.name || '',
          id: el.id || '',
          type: el.type || (el.tagName.toUpperCase() === 'TEXTAREA' ? 'textarea' :
                            el.tagName.toUpperCase() === 'SELECT' ? 'select' : ''),
          label: label,
          placeholder: el.placeholder || '',
          required: el.required || el.getAttribute('aria-required') === 'true' || false,
          maxlength: el.maxLength > 0 ? el.maxLength : null,
          inferred_purpose: inferredPurpose,
          effective_type: effectiveType,
          selector: buildSelector(el),
          tagName: el.tagName.toUpperCase(),
          form_index: fi
        });

        fieldCounter++;
      }

      formsResult.push({
        form_index: fi,
        role: classification.role,
        confidence: classification.confidence,
        form_id: formEl.id || '',
        form_action: formEl.action || '',
        field_count: formFieldCount,
        filtered: classification.filtered
      });
    }

    // Also scan standalone form fields (not inside a <form>)
    const allInputs = document.querySelectorAll('input, textarea, select, [contenteditable]');
    const formFieldSet = new Set();
    for (let fi = 0; fi < allForms.length; fi++) {
      const formFields = allForms[fi].querySelectorAll('input, textarea, select, [contenteditable]');
      for (let j = 0; j < formFields.length; j++) {
        formFieldSet.add(formFields[j]);
      }
    }

    for (let j = 0; j < allInputs.length; j++) {
      const el = allInputs[j];
      if (formFieldSet.has(el)) continue;
      if (!isFormField(el)) continue;

      const label = findLabel(el);
      const effectiveType = inferEffectiveType(el);
      let inferredPurpose = inferFieldPurpose(el);

      el.setAttribute('data-sa-field-' + fieldCounter, '');

      fields.push({
        canonical_id: 'field_' + fieldCounter,
        name: el.name || '',
        id: el.id || '',
        type: el.type || (el.tagName.toUpperCase() === 'TEXTAREA' ? 'textarea' :
                          el.tagName.toUpperCase() === 'SELECT' ? 'select' : ''),
        label: label,
        placeholder: el.placeholder || '',
        required: el.required || el.getAttribute('aria-required') === 'true' || false,
        maxlength: el.maxLength > 0 ? el.maxLength : null,
        inferred_purpose: inferredPurpose,
        effective_type: effectiveType,
        selector: buildSelector(el),
        tagName: el.tagName.toUpperCase(),
        form_index: -1
      });

      fieldCounter++;
    }

    return {
      fields: fields,
      forms: formsResult,
      page_info: extractPageInfo()
    };
  }

  return analyzeForms();
})()
