# Backlink Agent 功能迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 submit-agent Chrome 插件的全部功能迁移到 backlink-agent skill，使其成为完整的外链建设工具。

**Architecture:** 从插件中提取核心逻辑（表单分析、填写、蜜罐检测、评论展开、Google Sheets 同步），转为 CDP 注入脚本和 Node.js 脚本。Claude 自身替代外部 LLM API，通过 CDP Proxy 操控浏览器完成表单填写。数据存储从 IndexedDB 迁移为本地 JSON 文件。

**Tech Stack:** JavaScript（CDP 注入脚本，IIFE 模式）、Node.js 22+（ESM）、CDP Proxy（HTTP API on port 3457）、Google Sheets API v4、Web Crypto API（JWT 签名）

**Spec:** `docs/superpowers/specs/2026-04-16-backlink-agent-migration-design.md`

---

## File Structure

```
.claude/skills/backlink-agent/
  scripts/
    # 已有（不修改）
    cdp-proxy.mjs
    check-deps.mjs
    import-csv.mjs
    page-extractor.mjs
    detect-comment-form.js
    detect-antispam.js
    # 新增
    form-analyzer.js          # Task 1
    honeypot-detector.js      # Task 2
    form-filler.js            # Task 3
    comment-expander.js       # Task 4
    sheets-sync.mjs           # Task 6
    product-generator.mjs     # Task 7
  data/
    products.json             # 已有，扩展字段（Task 8）
    sites.json                # 已有，迁移种子数据（Task 9）
    backlinks.json            # 已有，不修改
    submissions.json          # 新增（Task 8）
    sync-config.json          # 新增（Task 8）
  references/
    data-formats.md           # 更新（Task 10）
  SKILL.md                    # 更新（Task 10）
```

---

### Task 1: form-analyzer.js — 表单字段分析注入脚本

**Files:**
- Create: `.claude/skills/backlink-agent/scripts/form-analyzer.js`
- Reference: `extension/src/agent/FormAnalyzer.ts`, `extension/src/agent/dom-utils.ts`（`isFormField`, `isVisible` 函数）

**来源映射：**
- `FormAnalyzer.ts` → 整体结构、字段推断、label 查找、表单分类
- `dom-utils.ts` → `isFormField`（CAPTCHA/蜜罐/可见性过滤）、`isVisible`、`isCaptchaElement`
- 迁移时去除 TypeScript 类型注解，纯 JS IIFE

- [ ] **Step 1: 创建 form-analyzer.js 骨架**

创建文件 `.claude/skills/backlink-agent/scripts/form-analyzer.js`，IIFE 骨架：

```javascript
(() => {
  'use strict';

  // --- 工具函数 ---

  function cssEscape(str) {
    return str.replace(/([\\ "'])/g, '\\$1')
              .replace(/(#)/g, '\\$1')
              .replace(/(\.)/g, '\\$1')
              .replace(/(:)/g, '\\$1');
  }

  // --- 可见性检测 ---

  function isCaptchaElement(el) {
    if (!el || !el.classList) return false;
    const cl = el.className || '';
    const id = el.id || '';
    return !!(el.closest('.g-recaptcha, .h-captcha, [data-sitekey], .cf-turnstile'));
  }

  function isVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity) === 0) return false;
    // 祖先遍历
    let parent = el.parentElement;
    while (parent && parent !== document.body) {
      const ps = getComputedStyle(parent);
      if (ps.display === 'none' || ps.visibility === 'hidden') return false;
      parent = parent.parentElement;
    }
    // 离屏定位
    if (style.position === 'absolute' || style.position === 'fixed') {
      const rect = el.getBoundingClientRect();
      if (rect.left < -500 || rect.top < -500) return false;
    }
    // clip/clip-path
    const clip = style.clip || style.clipPath;
    if (clip && (clip.includes('rect(0') || clip.includes('polygon(0') || clip === 'inset(100%)')) return false;
    // font-size:0
    if (parseFloat(style.fontSize) === 0) return false;
    // max-height/max-width:0
    if ((style.maxHeight && parseFloat(style.maxHeight) === 0) ||
        (style.maxWidth && parseFloat(style.maxWidth) === 0)) return false;
    // 尺寸为零（排除 contenteditable）
    if (el.tagName !== 'DIV' || !el.isContentEditable) {
      if (el.offsetWidth === 0 && el.offsetHeight === 0 && el.getClientRects().length === 0) return false;
    }
    return true;
  }

  function isFormField(el) {
    if (isCaptchaElement(el)) return false;
    if (!isVisible(el)) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image', 'file'].includes(t)) return false;
      return true;
    }
    if (tag === 'textarea' || tag === 'select') return true;
    if (el.isContentEditable) {
      return el.getAttribute('role') === 'textbox' ||
             !!el.closest('form, #comments, #respond, .comment-form, #commentform, #wpdcom');
    }
    return false;
  }

  // --- Label 查找（7 级级联）---

  function findLabel(el) {
    // 1. <label for="id">
    if (el.id) {
      const label = document.querySelector(`label[for="${cssEscape(el.id)}"]`);
      if (label) return label.textContent.trim();
    }
    // 2. 包裹型 <label>
    const wrappingLabel = el.closest('label');
    if (wrappingLabel) {
      const clone = wrappingLabel.cloneNode(true);
      clone.querySelectorAll('input,textarea,select,button').forEach(c => c.remove());
      const text = clone.textContent.trim();
      if (text) return text;
    }
    // 3. aria-label
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();
    // 4. aria-labelledby
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const refEl = document.getElementById(labelledBy);
      if (refEl) return refEl.textContent.trim();
    }
    // 5. title
    if (el.title) return el.title.trim();
    // 6. 前驱兄弟 <label>
    let prev = el.previousElementSibling;
    while (prev) {
      if (prev.tagName === 'LABEL') return prev.textContent.trim();
      prev = prev.previousElementSibling;
    }
    // 7. 父容器内前驱元素
    const parentBlock = el.parentElement;
    if (parentBlock) {
      const labelTags = ['LABEL', 'SPAN', 'DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
      let sib = el.previousElementSibling;
      while (sib) {
        if (labelTags.includes(sib.tagName)) {
          const t = sib.textContent.trim();
          if (t && t.length < 200) return t;
        }
        sib = sib.previousElementSibling;
      }
    }
    return '';
  }

  // --- 字段用途推断 ---

  function inferFieldPurpose(field) {
    const text = [field.label, field.placeholder, field.name].filter(Boolean).join(' ').toLowerCase();
    const type = (field.type || '').toLowerCase();
    if (type === 'url') return 'website URL';
    if (type === 'email') return 'email address';
    if (type === 'tel') return 'phone number';
    if (/email|@/.test(text)) return 'email address';
    if (/https?:|url|website|link/i.test(text)) return 'website URL';
    if (/\bname\b|\bauthor\b/i.test(text)) return 'name';
    if (/\bdesc\b|\bdescription\b/i.test(text)) return 'description';
    if (/\btitle\b/i.test(text)) return 'title';
    if (/\bcategory\b|\btag\b/i.test(text)) return 'category';
    if (/\bcomment\b/i.test(text)) return 'comment';
    return '';
  }

  function inferEffectiveType(field) {
    if ((field.type || '').toLowerCase() !== 'text') return field.type || 'text';
    const text = [field.label, field.placeholder, field.name].filter(Boolean).join(' ').toLowerCase();
    if (/email|@/.test(text)) return 'email';
    if (/https?:|url|website|link/i.test(text)) return 'url';
    if (/phone|tel|\+?\d[\d\s-]{6,}/i.test(text)) return 'tel';
    return 'text';
  }

  // --- 表单分类 ---

  function classifyForm(formEl, formIndex) {
    const action = (formEl.action || '').toLowerCase();
    const inputs = formEl.querySelectorAll('input,textarea,select');
    const fieldCount = inputs.length;
    const hasPassword = !!formEl.querySelector('input[type="password"]');
    // search
    if (formEl.getAttribute('role') === 'search') return { form_index: formIndex, role: 'search', confidence: 'high', form_id: formEl.id, form_action: formEl.action, field_count: fieldCount, filtered: true };
    if (/\/search|\?s=/.test(action)) return { form_index: formIndex, role: 'search', confidence: 'high', form_id: formEl.id, form_action: formEl.action, field_count: fieldCount, filtered: true };
    if (fieldCount === 1) {
      const name = (inputs[0].name || '').toLowerCase();
      if (/^(q|s|query|keyword|search_term|search)$/.test(name)) return { form_index: formIndex, role: 'search', confidence: 'medium', form_id: formEl.id, form_action: formEl.action, field_count: fieldCount, filtered: true };
    }
    // login
    if (hasPassword && fieldCount <= 2) return { form_index: formIndex, role: 'login', confidence: 'high', form_id: formEl.id, form_action: formEl.action, field_count: fieldCount, filtered: true };
    if (/\/login|\/signin|\/auth/.test(action)) return { form_index: formIndex, role: 'login', confidence: 'medium', form_id: formEl.id, form_action: formEl.action, field_count: fieldCount, filtered: true };
    // newsletter
    if (/\/subscribe|\/newsletter/.test(action)) return { form_index: formIndex, role: 'newsletter', confidence: 'high', form_id: formEl.id, form_action: formEl.action, field_count: fieldCount, filtered: true };
    const allNames = Array.from(inputs).map(i => (i.name || '').toLowerCase()).join(' ');
    if (/newsletter|subscribe|mailing/.test(allNames) && fieldCount <= 2) return { form_index: formIndex, role: 'newsletter', confidence: 'medium', form_id: formEl.id, form_action: formEl.action, field_count: fieldCount, filtered: true };
    // unknown = 保留
    return { form_index: formIndex, role: 'unknown', confidence: 'low', form_id: formEl.id, form_action: formEl.action, field_count: fieldCount, filtered: false };
  }

  // --- 构建选择器 ---

  function buildSelector(el) {
    if (el.id) return '#' + cssEscape(el.id);
    if (el.name) {
      const sel = `[name="${cssEscape(el.name)}"]`;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }
    const parent = el.parentElement;
    if (parent) {
      const tag = el.tagName.toLowerCase();
      const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
      if (siblings.length === 1) return buildSelector(parent) + ' > ' + tag;
      const idx = siblings.indexOf(el) + 1;
      return buildSelector(parent) + ' > ' + tag + ':nth-of-type(' + idx + ')';
    }
    return el.tagName.toLowerCase();
  }

  // --- 提取页面信息 ---

  function extractPageInfo() {
    const title = document.title || '';
    const desc = (document.querySelector('meta[name="description"]') || {}).content || '';
    const headings = Array.from(document.querySelectorAll('h1,h2,h3')).map(h => h.textContent.trim()).filter(Boolean).slice(0, 10);
    const main = document.querySelector('main, article, [role="main"]');
    const contentEl = main || document.body;
    let contentPreview = contentEl.innerText || '';
    contentPreview = contentPreview.replace(/\s+/g, ' ').trim().slice(0, 3000);
    return { title, description: desc, headings, content_preview: contentPreview };
  }

  // --- 主分析函数 ---

  function analyzeForms() {
    const formElements = document.querySelectorAll('form');
    const forms = [];
    const fieldGroups = [];

    formElements.forEach((formEl, idx) => {
      const group = classifyForm(formEl, idx);
      forms.push(group);
      if (!group.filtered) {
        const fields = [];
        formEl.querySelectorAll('input,textarea,select').forEach(el => {
          if (isFormField(el)) fields.push(el);
        });
        // contenteditable
        formEl.querySelectorAll('[contenteditable="true"]').forEach(el => {
          if (isFormField(el)) fields.push(el);
        });
        fieldGroups.push({ group, elements: fields });
      }
    });

    // 无 form 时扫描 body
    if (forms.length === 0) {
      forms.push({ form_index: -1, role: 'unknown', confidence: 'low', form_id: '', form_action: '', field_count: 0, filtered: false });
      const fields = [];
      document.body.querySelectorAll('input,textarea,select,[contenteditable="true"]').forEach(el => {
        if (isFormField(el)) fields.push(el);
      });
      fieldGroups.push({ group: forms[0], elements: fields });
    }

    const fields = [];
    let fieldCounter = 0;
    fieldGroups.forEach(({ group, elements }) => {
      elements.forEach(el => {
        const tag = el.tagName.toLowerCase();
        const type = tag === 'input' ? (el.type || 'text').toLowerCase() : tag;
        const label = findLabel(el);
        const raw = {
          label,
          placeholder: el.placeholder || '',
          name: el.name || '',
          type
        };
        fields.push({
          canonical_id: 'field_' + fieldCounter++,
          name: raw.name,
          id: el.id || '',
          type,
          label,
          placeholder: raw.placeholder,
          required: el.required || false,
          maxlength: el.maxLength > 0 ? el.maxLength : null,
          inferred_purpose: label ? '' : inferFieldPurpose(raw),
          effective_type: inferEffectiveType(raw),
          selector: buildSelector(el),
          tagName: tag.toUpperCase(),
          form_index: group.form_index
        });
      });
    });

    return { fields, forms, page_info: extractPageInfo() };
  }

  return analyzeForms();
})();
```

- [ ] **Step 2: 提交 form-analyzer.js**

```bash
git add .claude/skills/backlink-agent/scripts/form-analyzer.js
git commit -m "feat(backlink-agent): 添加表单字段分析注入脚本 form-analyzer.js"
```

---

### Task 2: honeypot-detector.js — 蜜罐检测注入脚本

**Files:**
- Create: `.claude/skills/backlink-agent/scripts/honeypot-detector.js`
- Reference: `extension/src/agent/dom-utils.ts`（`honeypotScore`, `isHoneypotField`, `HONEYPOT_NAME_PATTERNS`）

- [ ] **Step 1: 创建 honeypot-detector.js**

创建文件 `.claude/skills/backlink-agent/scripts/honeypot-detector.js`：

```javascript
(() => {
  'use strict';

  const HONEYPOT_NAME_PATTERNS = [
    /honeypot/i, /hp_/i, /ak_hp/i,
    /trap/i, /cloaked/i, /^_wpcf7/i,
    /nospam/i, /no.?spam/i, /antispam/i, /anti.?bot/i,
    /wpbruiser/i, /gotcha/i,
    /[a-f0-9]{32,}/i
  ];

  function honeypotScore(el) {
    if (!el) return 0;
    let score = 0;
    const style = getComputedStyle(el);

    // aria-hidden
    if (el.getAttribute('aria-hidden') === 'true') score += 80;

    // name/id/class 匹配蜜罐模式
    const identifiers = [el.name, el.id, el.className].filter(Boolean).join(' ');
    for (const pattern of HONEYPOT_NAME_PATTERNS) {
      if (pattern.test(identifiers)) { score += 60; break; }
    }

    // label 仅含非字母数字
    const ariaLabel = el.getAttribute('aria-label') || '';
    const title = el.title || '';
    if ((ariaLabel || title) && !/[a-zA-Z0-9]/.test(ariaLabel + title)) score += 40;

    // tabindex < 0 且无标识
    const hasIdentity = ariaLabel || title || el.id;
    if (el.tabIndex < 0 && !hasIdentity) score += 50;

    // autocomplete="off" 且无标识
    if (el.autocomplete === 'off' && !hasIdentity) score += 50;

    // 父元素隐藏
    let parent = el.parentElement;
    while (parent && parent !== document.body) {
      const ps = getComputedStyle(parent);
      if (ps.display === 'none' || ps.visibility === 'hidden') { score += 50; break; }
      parent = parent.parentElement;
    }

    // font-size: 0
    if (parseFloat(style.fontSize) === 0) score += 60;

    // max-height/max-width: 0
    if ((style.maxHeight && parseFloat(style.maxHeight) === 0) ||
        (style.maxWidth && parseFloat(style.maxWidth) === 0)) score += 50;

    return score;
  }

  function isHoneypotField(el) {
    return honeypotScore(el) >= 50;
  }

  // 扫描页面所有表单字段，返回蜜罐检测结果
  const results = [];
  document.querySelectorAll('input,textarea,select').forEach(el => {
    const score = honeypotScore(el);
    if (score > 0) {
      results.push({
        selector: el.id ? '#' + el.id : (el.name ? `[name="${el.name}"]` : ''),
        tagName: el.tagName,
        name: el.name || '',
        id: el.id || '',
        score,
        isHoneypot: score >= 50,
        signals: {
          ariaHidden: el.getAttribute('aria-hidden') === 'true',
          namePattern: HONEYPOT_NAME_PATTERNS.some(p => p.test([el.name, el.id, el.className].filter(Boolean).join(' '))),
          emptyLabel: !!((el.getAttribute('aria-label') || el.title) && !/[a-zA-Z0-9]/.test((el.getAttribute('aria-label') || '') + (el.title || ''))),
          negativeTabindex: el.tabIndex < 0,
          autocompleteOff: el.autocomplete === 'off',
          hiddenParent: (() => { let p = el.parentElement; while (p && p !== document.body) { const s = getComputedStyle(p); if (s.display === 'none' || s.visibility === 'hidden') return true; p = p.parentElement; } return false; })(),
          zeroFontSize: parseFloat(getComputedStyle(el).fontSize) === 0,
          zeroMaxDimension: (() => { const s = getComputedStyle(el); return (s.maxHeight && parseFloat(s.maxHeight) === 0) || (s.maxWidth && parseFloat(s.maxWidth) === 0); })()
        }
      });
    }
  });

  return {
    total: document.querySelectorAll('input,textarea,select').length,
    suspicious: results.length,
    honeypots: results.filter(r => r.isHoneypot),
    all: results
  };
})();
```

- [ ] **Step 2: 提交 honeypot-detector.js**

```bash
git add .claude/skills/backlink-agent/scripts/honeypot-detector.js
git commit -m "feat(backlink-agent): 添加蜜罐检测注入脚本 honeypot-detector.js"
```

---

### Task 3: form-filler.js — 表单填写注入脚本

**Files:**
- Create: `.claude/skills/backlink-agent/scripts/form-filler.js`
- Reference: `extension/src/agent/dom-utils.ts`（`setInputValue`, `setTextareaValue`, `setSelectValue`, `setContentEditable`, `fillField`, `fillAndVerify`, `resetReactTracker`）

**关键设计：** 此脚本通过 CDP `/eval` 注入执行。但 CDP `/eval` 的执行上下文与 content script 不同——它直接运行在页面上下文中。因此 `_valueTracker` 的重置不再需要通过注入 `<script>` 标签，可以直接访问。但 `HTMLInputElement.prototype.value` 的原生 setter 需要保留以绕过 React 框架限制。

**调用方式变更：** 不像其他注入脚本自动执行，此脚本需要接收参数。通过 CDP `/eval` 执行时，脚本代码前会拼接字段映射 JSON。约定：脚本以 `window.__FILL_DATA__` 作为输入。

- [ ] **Step 1: 创建 form-filler.js**

创建文件 `.claude/skills/backlink-agent/scripts/form-filler.js`：

```javascript
(() => {
  'use strict';

  const fillData = window.__FILL_DATA__;
  if (!fillData || !fillData.fields) {
    return { success: false, error: 'No fill data provided. Set window.__FILL_DATA__ = { fields: { canonical_id: value, ... } } before executing.' };
  }

  const results = [];

  function cssEscape(str) {
    return str.replace(/([\\ "'])/g, '\\$1')
              .replace(/(#)/g, '\\$1')
              .replace(/(\.)/g, '\\$1')
              .replace(/(:)/g, '\\$1');
  }

  function resetReactTracker(el) {
    // CDP eval 运行在页面上下文，可直接访问 _valueTracker
    try {
      if (el._valueTracker) {
        el._valueTracker.setValue('');
      }
    } catch (e) { /* ignore */ }
  }

  function setInputValue(el, value) {
    el.focus();
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype, 'value'
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(el, value);
    } else {
      el.value = value;
    }
    resetReactTracker(el);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function setTextareaValue(el, value) {
    el.focus();
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype, 'value'
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(el, value);
    } else {
      el.value = value;
    }
    resetReactTracker(el);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function setSelectValue(el, value) {
    // 先尝试精确匹配 value
    for (const opt of el.options) {
      if (opt.value === value || opt.text.trim().toLowerCase() === value.toLowerCase()) {
        el.value = opt.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    return false;
  }

  function setContentEditable(el, value) {
    el.focus();
    if (el.innerHTML !== undefined) {
      el.innerHTML = value;
    } else {
      el.textContent = value;
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fillField(el, value) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') return setInputValue(el, value);
    if (tag === 'textarea') return setTextareaValue(el, value);
    if (tag === 'select') return setSelectValue(el, value);
    if (el.isContentEditable) return setContentEditable(el, value);
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function verifyValue(el, expectedValue) {
    const tag = el.tagName.toLowerCase();
    let actual;
    if (tag === 'textarea' || tag === 'input') actual = el.value;
    else if (tag === 'select') actual = el.value;
    else if (el.isContentEditable) actual = el.textContent || el.innerText;
    else actual = el.value || el.textContent;
    return actual === expectedValue;
  }

  function execCommandFallback(el, value) {
    el.focus();
    el.dispatchEvent(new Event('focus', { bubbles: true }));
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, value);
    return verifyValue(el, value);
  }

  function fillAndVerify(el, value, maxRetries) {
    maxRetries = maxRetries || 2;
    fillField(el, value);
    // 等待框架处理
    const verified = verifyValue(el, value);
    if (verified) return { filled: true, verified: true, retries: 0 };

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const fallbackOk = execCommandFallback(el, value);
      if (fallbackOk) return { filled: true, verified: true, retries: attempt };
    }
    return { filled: true, verified: false, actualValue: el.value || el.textContent };
  }

  function findElement(canonicalId) {
    // 1. 通过 data-sa-field-N 属性查找（form-analyzer 设置）
    const match = canonicalId.match(/^field_(\d+)$/);
    if (match) {
      const el = document.querySelector('[data-sa-field-' + match[1] + ']');
      if (el) return el;
    }
    return null;
  }

  // --- 执行填写 ---

  const fieldMap = fillData.fields; // { canonical_id: value, ... }

  for (const [canonicalId, value] of Object.entries(fieldMap)) {
    const el = findElement(canonicalId);
    if (!el) {
      results.push({ canonical_id: canonicalId, status: 'not_found', value });
      continue;
    }
    try {
      const result = fillAndVerify(el, value);
      results.push({ canonical_id: canonicalId, status: result.verified ? 'ok' : 'filled_unverified', ...result });
    } catch (err) {
      results.push({ canonical_id: canonicalId, status: 'error', error: err.message, value });
    }
  }

  // 清理临时数据
  delete window.__FILL_DATA__;

  return {
    success: results.every(r => r.status !== 'error' && r.status !== 'not_found'),
    total: Object.keys(fieldMap).length,
    results
  };
})();
```

- [ ] **Step 2: 更新 form-analyzer.js 添加 data-sa-field 属性**

在 form-analyzer.js 的 `analyzeForms` 函数中，构建字段时为每个元素设置 `data-sa-field-N` 属性。在 `fieldGroups.forEach` 循环中，fields.push 之前添加：

```javascript
el.setAttribute('data-sa-field-' + fieldCounter, '');
```

确保 form-filler.js 能通过 `findElement` 定位到对应 DOM 元素。

- [ ] **Step 3: 提交**

```bash
git add .claude/skills/backlink-agent/scripts/form-filler.js .claude/skills/backlink-agent/scripts/form-analyzer.js
git commit -m "feat(backlink-agent): 添加表单填写注入脚本 form-filler.js，并更新 form-analyzer.js 添加定位属性"
```

---

### Task 4: comment-expander.js — 评论展开注入脚本

**Files:**
- Create: `.claude/skills/backlink-agent/scripts/comment-expander.js`
- Reference: `extension/src/entrypoints/content.ts`（`expandLazyCommentForms`, `injectPageClick`, `unhideCommentFields`）

**关键设计：** CDP `/eval` 运行在页面上下文，可以直接访问 `jQuery` 等页面全局对象，不需要通过 `<script>` 注入。但此脚本需要等待 DOM 变化（异步），而 CDP `/eval` 可能不支持 async。解决方案：脚本同步执行点击和取消隐藏，不等待 DOM 变化（由 Claude 在调用后延迟 1 秒再调用 form-analyzer.js）。

- [ ] **Step 1: 创建 comment-expander.js**

创建文件 `.claude/skills/backlink-agent/scripts/comment-expander.js`：

```javascript
(() => {
  'use strict';

  const TRIGGERS = [
    // wpDiscuz contenteditable
    '#wpdcom .wpd-field-textarea [contenteditable="true"]',
    '.wpdiscuz-textarea-wrap [contenteditable="true"]',
    '.wpd-comm .wpd-field-textarea [contenteditable="true"]',
    // wpDiscuz textarea
    '#wpdcom textarea',
    '.wpdiscuz-textarea-wrap textarea',
    '#wc_comment',
    '.wpd-field-textarea textarea',
    // WordPress 默认
    '#respond textarea#comment',
    '.comment-form textarea',
    '#commentform textarea',
    // 通用
    'textarea[name="comment"]',
    'textarea[id*="comment"]'
  ];

  function isVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity) === 0) return false;
    return true;
  }

  function findTrigger() {
    for (const sel of TRIGGERS) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) return el;
    }
    // 尝试不可见的触发器（可能需要点击才展开）
    for (const sel of TRIGGERS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function clickTrigger(el) {
    el.focus();
    el.click();
    // 触发 jQuery 事件（页面上下文可直接访问 jQuery）
    if (typeof jQuery === 'function') {
      try {
        jQuery(el).trigger('focus').trigger('click');
      } catch (e) { /* ignore */ }
    }
  }

  function unhideCommentFields(container) {
    const commentContainers = '#wpdcom,.wpd_comm_form,.comment-form,#respond,#commentform';
    const inputs = container.querySelectorAll('input,textarea,select');
    let unhid = 0;
    inputs.forEach(el => {
      let target = el.parentElement;
      while (target && target !== document.body) {
        if (target.matches(commentContainers)) {
          const cs = getComputedStyle(target);
          if (cs.display === 'none') {
            target.style.display = '';
            unhid++;
          } else if (target.style.display === 'none') {
            target.style.display = '';
            unhid++;
          }
          if (cs.visibility === 'hidden') {
            target.style.visibility = 'visible';
            unhid++;
          }
          if (parseFloat(cs.opacity) === 0) {
            target.style.opacity = '1';
            unhid++;
          }
          break;
        }
        target = target.parentElement;
      }
    });
    return unhid;
  }

  // --- 执行 ---

  const trigger = findTrigger();
  let clicked = false;
  let unhid = 0;
  let triggerSelector = '';

  if (trigger) {
    triggerSelector = trigger.id ? '#' + trigger.id : (trigger.name ? `[name="${trigger.name}"]` : trigger.tagName.toLowerCase());
    clickTrigger(trigger);
    clicked = true;
    // 在评论容器内取消隐藏
    const container = trigger.closest('#wpdcom,.comment-form,#respond,#commentform') || document.body;
    unhid = unhideCommentFields(container);
  }

  return {
    found: !!trigger,
    triggerSelector,
    clicked,
    unhid,
    hint: clicked ? 'Trigger clicked. Wait ~1s for DOM updates before running form-analyzer.js' : 'No comment trigger found on this page'
  };
})();
```

- [ ] **Step 2: 提交**

```bash
git add .claude/skills/backlink-agent/scripts/comment-expander.js
git commit -m "feat(backlink-agent): 添加懒加载评论展开注入脚本 comment-expander.js"
```

---

### Task 5: 数据模型更新 — submissions.json + sync-config.json

**Files:**
- Create: `.claude/skills/backlink-agent/data/submissions.json`
- Create: `.claude/skills/backlink-agent/data/sync-config.json`
- Reference: 设计文档数据模型章节

- [ ] **Step 1: 创建 submissions.json**

```json
[]
```

- [ ] **Step 2: 创建 sync-config.json**

```json
{
  "serviceAccountKey": "",
  "sheetUrl": ""
}
```

- [ ] **Step 3: 提交**

```bash
git add .claude/skills/backlink-agent/data/submissions.json .claude/skills/backlink-agent/data/sync-config.json
git commit -m "feat(backlink-agent): 添加提交记录和同步配置数据文件"
```

---

### Task 6: sheets-sync.mjs — Google Sheets 同步脚本

**Files:**
- Create: `.claude/skills/backlink-agent/scripts/sheets-sync.mjs`
- Reference: `extension/src/lib/sync/google-auth.ts`, `sheets-client.ts`, `serializer.ts`, `types.ts`

**关键变化：**
- 从 TypeScript → 纯 JavaScript（ESM）
- 从 `chrome.storage.local` → 读取 JSON 配置文件
- 从 `crypto.subtle`（浏览器） → `crypto.subtle`（Node.js 22 内置）
- 不再依赖 chrome.runtime，直接 fetch API

- [ ] **Step 1: 创建 sheets-sync.mjs — JWT 认证模块**

创建文件 `.claude/skills/backlink-agent/scripts/sheets-sync.mjs`，第一部分包含认证和工具函数：

```javascript
#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { crypto } from 'node:crypto';

// --- 参数解析 ---

function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0]; // upload | download
  const opts = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length) {
      opts[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  if (!['upload', 'download'].includes(command)) {
    console.error('Usage: node sheets-sync.mjs <upload|download> --config <path> --data <path>');
    process.exit(1);
  }
  return { command, ...opts };
}

// --- JWT 认证 ---

function base64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

async function createJwt(serviceAccount, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };

  const headerB64 = base64url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload)));
  const signInput = `${headerB64}.${payloadB64}`;

  const keyPem = serviceAccount.private_key;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(keyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, Buffer.from(signInput));
  return `${signInput}.${base64url(signature)}`;
}

function pemToDer(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  return Buffer.from(b64, 'base64');
}

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAuthToken(serviceAccount) {
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) return cachedToken;
  const jwt = await createJwt(serviceAccount, 'https://www.googleapis.com/auth/spreadsheets');
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Auth failed: ${resp.status} ${err}`);
  }
  const data = await resp.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  return cachedToken;
}

// --- Sheets API ---

const MAX_RETRIES = 3;
const CHUNK_SIZE = 500;

async function sheetsFetch(url, options, serviceAccount) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const token = await getAuthToken(serviceAccount);
    const headers = { ...options.headers, Authorization: `Bearer ${token}` };
    const resp = await fetch(url, { ...options, headers });

    if (resp.ok) return resp;
    if (resp.status === 401) { cachedToken = null; throw new Error('401 Unauthorized'); }
    if (resp.status === 429) {
      const retryAfter = parseInt(resp.headers.get('Retry-After') || '5');
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      continue;
    }
    if (resp.status >= 500) {
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
        continue;
      }
    }
    throw new Error(`Sheets API error: ${resp.status} ${await resp.text()}`);
  }
  throw new Error('Max retries exceeded');
}

function extractSheetId(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error('Invalid Google Sheet URL');
  return match[1];
}

// --- 序列化 ---

const SHEET_DEFS = {
  products: {
    tabName: 'products',
    columns: ['id', 'name', 'url', 'tagline', 'shortDesc', 'longDesc', 'categories', 'logoSquare', 'logoBanner', 'screenshots', 'founderName', 'founderEmail', 'socialLinks', 'createdAt', 'updatedAt'],
    jsonFields: ['categories', 'screenshots', 'socialLinks'],
    dateFields: ['createdAt', 'updatedAt']
  },
  submissions: {
    tabName: 'submissions',
    columns: ['id', 'siteName', 'siteUrl', 'productId', 'status', 'screenshotPath', 'fields', 'submittedAt', 'result', 'createdAt', 'updatedAt'],
    jsonFields: ['fields'],
    dateFields: ['submittedAt', 'createdAt', 'updatedAt']
  },
  sites: {
    tabName: 'sites',
    columns: ['id', 'domain', 'url', 'submitUrl', 'category', 'commentSystem', 'antispam', 'relAttribute', 'productId', 'pricing', 'monthlyTraffic', 'lang', 'addedAt', 'createdAt', 'updatedAt'],
    jsonFields: ['antispam'],
    dateFields: ['addedAt', 'createdAt', 'updatedAt']
  },
  backlinks: {
    tabName: 'backlinks',
    columns: ['id', 'sourceUrl', 'sourceTitle', 'pageAscore', 'status', 'analysisLog', 'domain', 'addedAt', 'createdAt', 'updatedAt'],
    jsonFields: ['analysisLog'],
    dateFields: ['addedAt', 'createdAt', 'updatedAt']
  }
};

function serializeRow(obj, def) {
  return def.columns.map(col => {
    const val = obj[col];
    if (val === undefined || val === null) return '';
    if (def.jsonFields.includes(col)) return JSON.stringify(val);
    if (def.dateFields.includes(col) && typeof val === 'string') return val;
    return String(val);
  });
}

function deserializeRows(rows, def) {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1)
    .filter(row => row.some(cell => cell !== '' && cell !== undefined && cell !== null))
    .map(row => {
      const obj = {};
      headers.forEach((header, idx) => {
        const colIdx = def.columns.indexOf(header);
        if (colIdx === -1) return;
        const col = def.columns[colIdx];
        let val = row[idx] !== undefined ? row[idx] : '';
        if (val === '') return;
        if (def.jsonFields.includes(col)) {
          try { val = JSON.parse(val); } catch { /* keep string */ }
        }
        obj[col] = val;
      });
      return obj;
    });
}
```

- [ ] **Step 2: 添加上传和下载功能**

在同一文件中继续添加 `upload` 和 `download` 函数以及 `main`：

```javascript
// --- 上传 ---

async function upload(config, dataDir) {
  const serviceAccount = JSON.parse(readFileSync(config, 'utf8'));
  const sheetId = extractSheetId(serviceAccount.sheetUrl || '');

  // 如果 sync-config 中没有 sheetUrl，从命令行参数或配置文件读取
  const syncConfig = JSON.parse(readFileSync(config, 'utf8'));
  const sid = extractSheetId(syncConfig.sheetUrl);

  const backups = {};

  for (const [key, def] of Object.entries(SHEET_DEFS)) {
    const filePath = resolve(dataDir, `${key}.json`);
    if (!existsSync(filePath)) {
      console.log(`Skipping ${key}: file not found`);
      continue;
    }
    const records = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!Array.isArray(records) || records.length === 0) {
      console.log(`Skipping ${key}: empty or not an array`);
      continue;
    }

    // 备份
    try {
      const backupResp = await sheetsFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${def.tabName}!A1:Z`,
        { headers: {} },
        serviceAccount
      );
      const backupData = await backupResp.json();
      backups[key] = backupData.values || [];
      console.log(`Backed up ${key}: ${backups[key].length} rows`);
    } catch (e) {
      console.log(`Backup ${key}: empty or not found (${e.message})`);
      backups[key] = null;
    }

    // 确保 Tab 存在
    await sheetsFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sid}:batchUpdate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{ addSheet: { properties: { title: def.tabName } } }]
        })
      },
      serviceAccount
    ).catch(() => {}); // Tab 已存在则忽略错误

    // 清空 + 分块写入
    try {
      await sheetsFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${def.tabName}!A1:Z:clear`,
        { method: 'POST', headers: {} },
        serviceAccount
      );
    } catch (e) { /* ignore */ }

    const headerRow = [def.columns];
    const dataRows = records.map(r => serializeRow(r, def));
    const allRows = [...headerRow, ...dataRows];

    for (let i = 0; i < allRows.length; i += CHUNK_SIZE) {
      const chunk = allRows.slice(i, i + CHUNK_SIZE);
      const startRow = i + 1;
      await sheetsFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${def.tabName}!A${startRow}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: chunk })
        },
        serviceAccount
      );
    }
    console.log(`Uploaded ${key}: ${records.length} records`);
  }

  console.log('Upload complete');
}

// --- 下载 ---

async function download(config, dataDir) {
  const serviceAccount = JSON.parse(readFileSync(config, 'utf8'));
  const sid = extractSheetId(serviceAccount.sheetUrl);

  const counts = {};

  for (const [key, def] of Object.entries(SHEET_DEFS)) {
    try {
      const resp = await sheetsFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${def.tabName}!A1:Z`,
        { headers: {} },
        serviceAccount
      );
      const data = await resp.json();
      const rows = data.values || [];

      if (rows.length < 2) {
        console.log(`${key}: empty sheet`);
        counts[key] = 0;
        continue;
      }

      const records = deserializeRows(rows, def);
      const filePath = resolve(dataDir, `${key}.json`);
      writeFileSync(filePath, JSON.stringify(records, null, 2));
      counts[key] = records.length;
      console.log(`Downloaded ${key}: ${records.length} records`);
    } catch (e) {
      console.error(`Error downloading ${key}: ${e.message}`);
    }
  }

  console.log('Download complete:', counts);
}

// --- main ---

const { command, config, data } = parseArgs();

if (!config || !data) {
  console.error('Missing --config or --data');
  process.exit(1);
}

const configPath = resolve(config);
if (!existsSync(configPath)) {
  console.error(`Config file not found: ${configPath}`);
  process.exit(1);
}

if (command === 'upload') {
  upload(configPath, resolve(data)).catch(e => { console.error('Upload failed:', e.message); process.exit(1); });
} else {
  download(configPath, resolve(data)).catch(e => { console.error('Download failed:', e.message); process.exit(1); });
}
```

- [ ] **Step 3: 提交**

```bash
git add .claude/skills/backlink-agent/scripts/sheets-sync.mjs
git commit -m "feat(backlink-agent): 添加 Google Sheets 同步脚本 sheets-sync.mjs"
```

---

### Task 7: product-generator.mjs — 产品资料生成辅助脚本

**Files:**
- Create: `.claude/skills/backlink-agent/scripts/product-generator.mjs`
- Reference: `extension/src/lib/profile-generator.ts`

**关键设计：** 通过 CDP Proxy 打开产品页面，提取 meta 信息和正文内容，输出 JSON 供 Claude 生成完整产品资料。不调用 LLM，只做页面内容提取和预处理。

- [ ] **Step 1: 创建 product-generator.mjs**

创建文件 `.claude/skills/backlink-agent/scripts/product-generator.mjs`：

```javascript
#!/usr/bin/env node
// 通过 CDP Proxy 提取产品页面信息，输出 JSON 供 Claude 生成产品资料
import { readFileSync } from 'node:fs';

const CDP_PROXY = 'http://localhost:3457';
const url = process.argv[2];

if (!url) {
  console.error('Usage: node product-generator.mjs <product-url>');
  process.exit(1);
}

async function main() {
  // 1. 创建 tab
  const newResp = await fetch(`${CDP_PROXY}/new?url=${encodeURIComponent(url)}`);
  const { targetId } = await newResp.json();
  if (!targetId) { console.error('Failed to create tab'); process.exit(1); }

  // 2. 等待加载
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const infoResp = await fetch(`${CDP_PROXY}/info?target=${targetId}`);
    const info = await infoResp.json();
    if (info.ready === 'complete') break;
    if (i === 29) { console.error('Page load timeout'); process.exit(1); }
  }

  // 3. 提取页面信息
  const extractScript = `
(() => {
  const result = {
    url: location.href,
    title: document.title || '',
    metaDescription: (document.querySelector('meta[name="description"]') || {}).content || '',
    ogTitle: (document.querySelector('meta[property="og:title"]') || {}).content || '',
    ogDescription: (document.querySelector('meta[property="og:description"]') || {}).content || '',
    ogSiteName: (document.querySelector('meta[property="og:site_name"]') || {}).content || '',
    ogImage: (document.querySelector('meta[property="og:image"]') || {}).content || '',
    headings: Array.from(document.querySelectorAll('h1,h2,h3')).map(h => h.textContent.trim()).filter(Boolean).slice(0, 15),
    bodyText: ''
  };
  const main = document.querySelector('main, article, [role="main"]') || document.body;
  const clone = main.cloneNode(true);
  clone.querySelectorAll('script,style,nav,footer,header,aside,iframe,noscript').forEach(el => el.remove());
  result.bodyText = (clone.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 5000);
  return result;
})()`;

  const evalResp = await fetch(`${CDP_PROXY}/eval?target=${targetId}`, {
    method: 'POST',
    body: extractScript
  });
  const evalResult = await evalResp.json();

  // 4. 关闭 tab
  await fetch(`${CDP_PROXY}/close?target=${targetId}`);

  // 5. 输出 JSON
  if (evalResult.result) {
    const data = typeof evalResult.result === 'string' ? JSON.parse(evalResult.result) : evalResult.result;
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.error('Extraction failed:', JSON.stringify(evalResult));
    process.exit(1);
  }
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
```

- [ ] **Step 2: 提交**

```bash
git add .claude/skills/backlink-agent/scripts/product-generator.mjs
git commit -m "feat(backlink-agent): 添加产品页面信息提取脚本 product-generator.mjs"
```

---

### Task 8: 种子站点数据迁移

**Files:**
- Modify: `.claude/skills/backlink-agent/data/sites.json`
- Reference: `sites.json`（项目根目录，375 个种子站点）

**字段映射：**
- `name` → `domain`（取 hostname）
- `submit_url` → `submitUrl`
- `monthly_traffic` → `monthlyTraffic`（保留字符串格式）
- `dr` → 保留数字
- `category` → 转换为 skill 分类（`Non-Blog Comment` → `directory`，`Blog Comment` → `blog_comment`）
- `pricing` → 保留
- `lang` → 保留
- `status` → 保留（alive/dead）
- `notes` → 保留

- [ ] **Step 1: 创建迁移脚本**

创建临时脚本 `scripts/migrate-sites.mjs`：

```javascript
#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const source = JSON.parse(readFileSync('sites.json', 'utf8'));
const target = [];

const CATEGORY_MAP = {
  'Blog Comment': 'blog_comment',
  'Non-Blog Comment': 'directory',
  'Forum': 'forum',
  'Q&A': 'forum',
  'Guest Post': 'guest_post',
  'Profile': 'profile',
  'Directory': 'directory'
};

source.sites.forEach((site, idx) => {
  const url = new URL(site.submit_url);
  target.push({
    id: `site-${String(idx + 1).padStart(3, '0')}`,
    domain: url.hostname,
    url: site.submit_url,
    submitUrl: site.submit_url,
    category: CATEGORY_MAP[site.category] || 'directory',
    pricing: (site.pricing || '').toLowerCase() || 'unknown',
    monthlyTraffic: site.monthly_traffic || '',
    lang: site.lang || 'en',
    dr: site.dr || 0,
    status: site.status === 'alive' ? 'alive' : 'dead',
    notes: site.notes || '',
    commentSystem: '',
    antispam: [],
    relAttribute: '',
    productId: '',
    addedAt: new Date().toISOString()
  });
});

writeFileSync('.claude/skills/backlink-agent/data/sites.json', JSON.stringify(target, null, 2));
console.log(`Migrated ${target.length} sites`);
```

- [ ] **Step 2: 执行迁移脚本**

```bash
node scripts/migrate-sites.mjs
```

Expected: 输出 `Migrated 375 sites`（或 311 个 alive 的站点，根据实际数据）

- [ ] **Step 3: 验证迁移结果**

```bash
cat .claude/skills/backlink-agent/data/sites.json | head -30
```

验证字段格式正确、分类映射正确。

- [ ] **Step 4: 删除临时脚本并提交**

```bash
rm scripts/migrate-sites.mjs
git add .claude/skills/backlink-agent/data/sites.json
git commit -m "feat(backlink-agent): 迁移 375 个种子站点数据"
```

---

### Task 9: 更新 references/data-formats.md

**Files:**
- Modify: `.claude/skills/backlink-agent/references/data-formats.md`

- [ ] **Step 1: 更新 products 字段定义**

在 products 节中补充已有但未文档化的字段：

```
- `socialLinks` — 社交媒体链接对象 `{ twitter, linkedin, facebook }`
- `founderName` — 创始人姓名
- `founderEmail` — 创始人邮箱
```

- [ ] **Step 2: 更新 sites 字段定义**

在 sites 节中补充新字段：

```
- `submitUrl` — 提交页面 URL（可能与 url 不同）
- `pricing` — 定价类型 `free` | `freemium` | `paid` | `unknown`
- `monthlyTraffic` — 月流量估计（字符串，如 "3.2M"）
- `lang` — 站点语言代码（如 "en"）
- `dr` — Domain Rating 评分（数字）
- `notes` — 备注
```

- [ ] **Step 3: 补充 submissions.json 格式定义**

新增 submissions 节：

```markdown
### submissions.json

提交记录数组，记录每次外链提交的结果。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一标识，格式 `sub-{timestamp}-{random4hex}` |
| `siteName` | string | 是 | 目标站点域名 |
| `siteUrl` | string | 是 | 提交页面 URL |
| `productId` | string | 是 | 关联产品 ID |
| `status` | string | 是 | `submitted` \| `failed` \| `skipped` |
| `submittedAt` | string | 是 | ISO 8601 时间戳 |
| `result` | string | 否 | 提交结果描述 |
| `screenshotPath` | string | 否 | 截图文件路径 |
| `fields` | object | 否 | 填写的字段键值对 |
```

- [ ] **Step 4: 补充 sync-config.json 格式定义**

新增 sync-config 节：

```markdown
### sync-config.json

Google Sheets 同步配置。

| 字段 | 类型 | 说明 |
|------|------|------|
| `serviceAccountKey` | string | Google Cloud 服务账号 JSON 密钥（完整 JSON 字符串） |
| `sheetUrl` | string | Google Sheet URL |
```

- [ ] **Step 5: 提交**

```bash
git add .claude/skills/backlink-agent/references/data-formats.md
git commit -m "docs(backlink-agent): 更新数据格式文档，补充 submissions 和扩展字段"
```

---

### Task 10: 更新 SKILL.md — 补充新流程和脚本文档

**Files:**
- Modify: `.claude/skills/backlink-agent/SKILL.md`

这是最大的文档更新任务。按以下章节逐一添加：

- [ ] **Step 1: 添加 4.6 表单提交流程**

在 SKILL.md 的 4.5 节之后，添加 4.6 节：

```markdown
### 4.6 表单提交

对已确认可发布的站点执行实际的表单填写和提交。

#### 目录提交流程

1. 通过 `/new` 打开目标站点的 `submitUrl`
2. 等待页面加载完成（`/info` 确认 ready 为 complete）
3. 调用 `form-analyzer.js` 注入分析表单结构
4. 调用 `honeypot-detector.js` 注入检测蜜罐字段
5. Claude 分析字段 + 活跃产品信息，生成字段映射
6. 设置 `window.__FILL_DATA__`，调用 `form-filler.js` 注入填写
7. `/screenshot` 截图确认 → 展示给用户
8. 用户确认后通过 `/click` 点击提交按钮
9. 记录到 `data/submissions.json`
10. `/close` 关闭 tab

#### 博客评论流程

1. 通过 `/new` 打开目标页面
2. 调用 `comment-expander.js` 注入展开评论区域
3. 等待 ~1 秒让 DOM 更新
4. 调用 `form-analyzer.js` 注入分析评论表单
5. 调用 `page-extractor.mjs` 提取页面内容
6. Claude 阅读页面内容，生成相关评论（80-300 字符）
7. 决定链接放置策略（URL 字段 > name 字段 > 正文 HTML）
8. 设置 `window.__FILL_DATA__`，调用 `form-filler.js` 注入填写
9. `/screenshot` 截图确认 → 用户确认 → 提交
10. 记录到 `data/submissions.json`
11. `/close` 关闭 tab

**form-filler.js 调用方式：**

由于 form-filler.js 需要接收参数，使用两步注入：

```bash
# 步骤 1: 设置填写数据
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "window.__FILL_DATA__ = { fields: { 'field_0': 'value1', 'field_1': 'value2' } }"

# 步骤 2: 执行填写脚本
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${SKILL_DIR}/scripts/form-filler.js")"
```
```

- [ ] **Step 2: 添加 4.7 提交记录管理**

```markdown
### 4.7 提交记录管理

查看和统计提交历史。

- 所有提交记录存储在 `data/submissions.json`
- 按状态筛选：`submitted` / `failed` / `skipped`
- 按产品筛选：`productId`
- 统计总提交数、成功率、失败原因分布
```

- [ ] **Step 3: 添加 4.8 Google Sheets 同步**

```markdown
### 4.8 Google Sheets 同步

将本地 JSON 数据与 Google Sheet 双向同步。

**前置条件：**
1. 配置 `data/sync-config.json` 中的服务账号密钥和 Sheet URL
2. 将 Sheet 分享给服务账号的邮箱地址

**上传（本地 → Sheet）：**

```bash
node "${SKILL_DIR}/scripts/sheets-sync.mjs" upload \
  --config "${SKILL_DIR}/data/sync-config.json" \
  --data "${SKILL_DIR}/data"
```

上传前自动备份现有 Sheet 数据，失败时自动回滚。

**下载（Sheet → 本地）：**

```bash
node "${SKILL_DIR}/scripts/sheets-sync.mjs" download \
  --config "${SKILL_DIR}/data/sync-config.json" \
  --data "${SKILL_DIR}/data"
```

**同步的 4 个 Tab：** products / submissions / sites / backlinks
```

- [ ] **Step 4: 添加 4.9 产品资料生成**

```markdown
### 4.9 产品资料生成

输入产品官网 URL，自动提取页面信息，由 Claude 生成完整产品资料。

```bash
node "${SKILL_DIR}/scripts/product-generator.mjs" <product-url>
```

脚本输出 JSON 包含 title、metaDescription、ogTitle、ogDescription、headings、bodyText。

Claude 基于提取结果生成产品记录（name、tagline、shortDesc、longDesc、categories、anchorTexts），写入 `products.json`。
```

- [ ] **Step 5: 添加新脚本文档（5-9 节）**

```markdown
## 7.1 表单分析脚本

脚本路径：`${SKILL_DIR}/scripts/form-analyzer.js`

通过 CDP `/eval` 在目标页面执行，扫描所有表单元素，返回结构化字段描述。

使用方式：
```bash
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${SKILL_DIR}/scripts/form-analyzer.js")"
```

返回值：
```json
{
  "fields": [
    {
      "canonical_id": "field_0",
      "name": "comment",
      "id": "comment",
      "type": "textarea",
      "label": "Comment",
      "placeholder": "Leave a comment...",
      "required": true,
      "maxlength": null,
      "inferred_purpose": "",
      "effective_type": "textarea",
      "selector": "#comment",
      "tagName": "TEXTAREA",
      "form_index": 0
    }
  ],
  "forms": [
    {
      "form_index": 0,
      "role": "unknown",
      "confidence": "low",
      "form_id": "commentform",
      "form_action": "",
      "field_count": 4,
      "filtered": false
    }
  ],
  "page_info": {
    "title": "Page Title",
    "description": "Meta description",
    "headings": ["H1", "H2"],
    "content_preview": "Page text..."
  }
}
```

## 7.2 蜜罐检测脚本

脚本路径：`${SKILL_DIR}/scripts/honeypot-detector.js`

检测页面中可疑的蜜罐表单字段。

返回值：
```json
{
  "total": 5,
  "suspicious": 2,
  "honeypots": [
    {
      "selector": "[name=\"ak_hp_textarea\"]",
      "tagName": "TEXTAREA",
      "name": "ak_hp_textarea",
      "id": "",
      "score": 60,
      "isHoneypot": true,
      "signals": { "namePattern": true }
    }
  ],
  "all": [...]
}
```

## 7.3 表单填写脚本

脚本路径：`${SKILL_DIR}/scripts/form-filler.js`

接收字段映射数据，逐字段填写表单。兼容 React/Vue 受控组件。

使用方式（两步注入）：
```bash
# 设置数据
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "window.__FILL_DATA__ = { fields: { 'field_0': 'value' } }"

# 执行填写
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${SKILL_DIR}/scripts/form-filler.js")"
```

返回值：
```json
{
  "success": true,
  "total": 3,
  "results": [
    { "canonical_id": "field_0", "status": "ok", "filled": true, "verified": true, "retries": 0 },
    { "canonical_id": "field_1", "status": "filled_unverified", "filled": true, "verified": false, "actualValue": "partial" },
    { "canonical_id": "field_2", "status": "not_found", "value": "..." }
  ]
}
```

## 7.4 评论展开脚本

脚本路径：`${SKILL_DIR}/scripts/comment-expander.js`

检测并展开懒加载的评论表单区域（支持 wpDiscuz、WordPress 默认评论等）。

返回值：
```json
{
  "found": true,
  "triggerSelector": "#comment",
  "clicked": true,
  "unhid": 2,
  "hint": "Trigger clicked. Wait ~1s for DOM updates before running form-analyzer.js"
}
```

## 7.5 Google Sheets 同步脚本

脚本路径：`${SKILL_DIR}/scripts/sheets-sync.mjs`

Google Sheets 双向同步。支持 4 个 Tab 的分块上传/下载，自动备份回滚。

使用方式见 4.8 节。

## 7.6 产品信息提取脚本

脚本路径：`${SKILL_DIR}/scripts/product-generator.mjs`

通过 CDP Proxy 打开产品页面，提取 meta 信息和正文内容。不调用 LLM。

使用方式：
```bash
node "${SKILL_DIR}/scripts/product-generator.mjs" <product-url>
```

返回值：
```json
{
  "url": "https://example.com",
  "title": "Product Name",
  "metaDescription": "...",
  "ogTitle": "...",
  "ogDescription": "...",
  "ogSiteName": "...",
  "ogImage": "https://...",
  "headings": ["H1", "H2"],
  "bodyText": "Page content..."
}
```
```

- [ ] **Step 6: 提交**

```bash
git add .claude/skills/backlink-agent/SKILL.md
git commit -m "docs(backlink-agent): 更新 SKILL.md，补充表单提交、同步、产品生成等新流程文档"
```

---

### Task 11: 最终集成验证

**Files:**
- All created files

- [ ] **Step 1: 验证所有脚本文件存在**

```bash
ls -la .claude/skills/backlink-agent/scripts/
```

Expected: 看到 12 个文件（6 已有 + 6 新增）

- [ ] **Step 2: 验证数据文件存在**

```bash
ls -la .claude/skills/backlink-agent/data/
```

Expected: 5 个文件（products.json, sites.json, backlinks.json, submissions.json, sync-config.json）

- [ ] **Step 3: 语法检查新脚本**

```bash
node --check .claude/skills/backlink-agent/scripts/form-analyzer.js
node --check .claude/skills/backlink-agent/scripts/honeypot-detector.js
node --check .claude/skills/backlink-agent/scripts/form-filler.js
node --check .claude/skills/backlink-agent/scripts/comment-expander.js
node --check .claude/skills/backlink-agent/scripts/sheets-sync.mjs
node --check .claude/skills/backlink-agent/scripts/product-generator.mjs
```

Expected: 所有脚本无语法错误

- [ ] **Step 4: 验证种子站点数据**

```bash
node -e "const s = require('./.claude/skills/backlink-agent/data/sites.json'); console.log('Sites:', s.length, '| Sample:', s[0].domain, s[0].category)"
```

Expected: `Sites: 375 | Sample: g2.com directory`（具体域名和分类取决于数据）

- [ ] **Step 5: 验证 JSON 数据文件格式**

```bash
node -e "JSON.parse(require('fs').readFileSync('.claude/skills/backlink-agent/data/submissions.json'))"
node -e "JSON.parse(require('fs').readFileSync('.claude/skills/backlink-agent/data/sync-config.json'))"
```

Expected: 无报错
