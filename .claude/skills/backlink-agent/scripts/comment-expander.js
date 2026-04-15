(() => {
  // --- 评论展开注入脚本 ---
  // 检测并展开懒加载的评论表单（wpDiscuz, WordPress 默认评论等）
  // 通过 CDP /eval 在页面上下文中运行，可直接访问 jQuery 和其他页面全局变量

  const TRIGGER_SELECTORS = [
    '#wpdcom .wpd-field-textarea [contenteditable="true"]',
    '.wpdiscuz-textarea-wrap [contenteditable="true"]',
    '.wpd-comm .wpd-field-textarea [contenteditable="true"]',
    '#wpdcom textarea',
    '.wpdiscuz-textarea-wrap textarea',
    '#wc_comment',
    '.wpd-field-textarea textarea',
    '#respond textarea#comment',
    '.comment-form textarea',
    '#commentform textarea',
    'textarea[name="comment"]',
    'textarea[id*="comment"]'
  ];

  const COMMENT_CONTAINERS = ['#wpdcom', '.comment-form', '#respond', '#commentform'];

  // --- 工具函数 ---

  function isVisible(el) {
    if (!el || !el.ownerDocument || !el.ownerDocument.defaultView) return false;
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (parseFloat(style.opacity) <= 0) return false;
    return true;
  }

  function isAncestorHidden(el) {
    let parent = el.parentElement;
    while (parent && parent !== el.ownerDocument.documentElement) {
      const style = el.ownerDocument.defaultView.getComputedStyle(parent);
      if (style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.visibility === 'collapse' ||
          parseFloat(style.opacity) <= 0) {
        return parent;
      }
      parent = parent.parentElement;
    }
    return null;
  }

  function findNearestCommentContainer(el) {
    let current = el;
    while (current && current !== document.documentElement) {
      for (let i = 0; i < COMMENT_CONTAINERS.length; i++) {
        if (current.matches && current.matches(COMMENT_CONTAINERS[i])) {
          return current;
        }
      }
      current = current.parentElement;
    }
    return null;
  }

  function forceVisible(el) {
    el.style.setProperty('display', 'block', 'important');
    el.style.setProperty('visibility', 'visible', 'important');
    el.style.setProperty('opacity', '1', 'important');
  }

  // --- 主逻辑 ---

  // 1. 查找触发元素
  let triggerEl = null;
  let triggerSelector = '';

  // 优先查找可见的触发元素
  for (let i = 0; i < TRIGGER_SELECTORS.length; i++) {
    const sel = TRIGGER_SELECTORS[i];
    const candidates = document.querySelectorAll(sel);
    for (let j = 0; j < candidates.length; j++) {
      if (isVisible(candidates[j])) {
        triggerEl = candidates[j];
        triggerSelector = sel;
        break;
      }
    }
    if (triggerEl) break;
  }

  // 如果没有找到可见的触发元素，尝试查找任意触发元素（包括隐藏的）
  if (!triggerEl) {
    for (let i = 0; i < TRIGGER_SELECTORS.length; i++) {
      const sel = TRIGGER_SELECTORS[i];
      const el = document.querySelector(sel);
      if (el) {
        triggerEl = el;
        triggerSelector = sel;
        break;
      }
    }
  }

  // 2. 点击触发元素
  let clicked = false;
  if (triggerEl) {
    triggerEl.focus();
    triggerEl.click();
    // 如果页面有 jQuery，触发 jQuery 事件
    if (typeof jQuery !== 'undefined') {
      try {
        jQuery(triggerEl).trigger('focus').trigger('click');
      } catch (e) {
        // 忽略 jQuery 错误
      }
    }
    clicked = true;
  }

  // 3. 取消隐藏评论容器中的隐藏字段
  let unhid = 0;
  const containers = document.querySelectorAll(COMMENT_CONTAINERS.join(','));
  for (let ci = 0; ci < containers.length; ci++) {
    const container = containers[ci];
    const fields = container.querySelectorAll('input, textarea, select');
    for (let fi = 0; fi < fields.length; fi++) {
      const field = fields[fi];
      const hiddenAncestor = isAncestorHidden(field);
      if (hiddenAncestor) {
        forceVisible(hiddenAncestor);
        unhid++;
      }
    }
  }

  // 4. 返回结果
  if (triggerEl) {
    return {
      found: true,
      triggerSelector: triggerSelector,
      clicked: clicked,
      unhid: unhid,
      hint: 'Trigger clicked. Wait ~1s for DOM updates before running form-analyzer.js'
    };
  } else {
    return {
      found: false,
      triggerSelector: '',
      clicked: false,
      unhid: unhid,
      hint: 'No comment trigger found on this page'
    };
  }
})()
