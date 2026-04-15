// Usage (two-step CDP eval):
// Step 1: curl -s -X POST "http://localhost:3457/eval?target=<id>" -d "window.__FILL_DATA__ = { fields: { 'field_0': 'value1', 'field_1': 'value2' } }"
// Step 2: curl -s -X POST "http://localhost:3457/eval?target=<id>" -d "$(cat form-filler.js)"
(() => {
  'use strict';

  // --- 工具函数 ---

  function resetReactTracker(el) {
    if (el._valueTracker) {
      el._valueTracker.setValue('');
    }
  }

  function dispatchEvents(el, eventType) {
    if (eventType === 'input') {
      el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
    } else {
      el.dispatchEvent(new Event(eventType, { bubbles: true }));
    }
  }

  function setInputValue(el, value) {
    el.focus();

    var nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (nativeSetter && nativeSetter.set) {
      nativeSetter.set.call(el, value);
    } else {
      el.value = value;
    }

    resetReactTracker(el);

    dispatchEvents(el, 'input');
    dispatchEvents(el, 'change');
    dispatchEvents(el, 'blur');
  }

  function setTextareaValue(el, value) {
    el.focus();

    var nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (nativeSetter && nativeSetter.set) {
      nativeSetter.set.call(el, value);
    } else {
      el.value = value;
    }

    resetReactTracker(el);

    dispatchEvents(el, 'input');
    dispatchEvents(el, 'change');
    dispatchEvents(el, 'blur');
  }

  function setSelectValue(el, value) {
    el.focus();

    var options = el.options;
    var matched = false;
    var valueLower = String(value).toLowerCase();

    // 首先尝试精确匹配 option value
    for (var i = 0; i < options.length; i++) {
      if (options[i].value === value) {
        el.selectedIndex = i;
        matched = true;
        break;
      }
    }

    // 其次尝试忽略大小写匹配 option text
    if (!matched) {
      for (var i = 0; i < options.length; i++) {
        if ((options[i].textContent || '').trim().toLowerCase() === valueLower) {
          el.selectedIndex = i;
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      return false;
    }

    dispatchEvents(el, 'change');
    dispatchEvents(el, 'blur');
    return true;
  }

  function setContentEditable(el, value) {
    el.focus();

    if (el.innerHTML !== undefined) {
      el.innerHTML = value;
    } else {
      el.textContent = value;
    }

    dispatchEvents(el, 'input');
    dispatchEvents(el, 'change');
    dispatchEvents(el, 'blur');
  }

  function fillField(el, value) {
    var tag = el.tagName ? el.tagName.toUpperCase() : '';

    if (tag === 'INPUT') {
      setInputValue(el, value);
    } else if (tag === 'TEXTAREA') {
      setTextareaValue(el, value);
    } else if (tag === 'SELECT') {
      return setSelectValue(el, value);
    } else if (el.isContentEditable) {
      setContentEditable(el, value);
    } else {
      // 未知类型，尝试 setInputValue
      setInputValue(el, value);
    }

    return true;
  }

  function verifyValue(el, expectedValue) {
    var actual = '';

    if (typeof el.value !== 'undefined') {
      actual = String(el.value);
    } else if (el.isContentEditable) {
      actual = el.innerText || el.textContent || '';
    }

    return actual === String(expectedValue);
  }

  function execCommandFallback(el, value) {
    el.focus();

    // 选中全部内容
    document.execCommand('selectAll', false, null);

    // 插入新文本替换选中内容
    document.execCommand('insertText', false, value);

    resetReactTracker(el);
  }

  function fillAndVerify(el, value, maxRetries) {
    maxRetries = maxRetries || 2;

    var retries = 0;
    var filled = false;

    // 首次尝试 fillField
    filled = fillField(el, value);

    if (filled && verifyValue(el, value)) {
      return { filled: true, verified: true, retries: 0 };
    }

    // 重试：使用 execCommandFallback
    for (var attempt = 0; attempt < maxRetries; attempt++) {
      retries++;
      execCommandFallback(el, value);

      if (verifyValue(el, value)) {
        return { filled: true, verified: true, retries: retries };
      }
    }

    // 填写完毕但无法验证
    return { filled: filled || true, verified: false, retries: retries };
  }

  function findElement(canonicalId) {
    // 从 canonicalId (如 "field_0") 解析出编号 N
    var match = canonicalId.match(/^field_(\d+)$/);
    if (!match) return null;

    var n = match[1];
    // 查找带有 data-sa-field-N 属性的元素
    var el = document.querySelector('[data-sa-field-' + n + ']');
    return el || null;
  }

  // --- 主执行逻辑 ---

  function execute() {
    var data = window.__FILL_DATA__;

    // 清理全局数据
    try {
      delete window.__FILL_DATA__;
    } catch (e) {
      window.__FILL_DATA__ = undefined;
    }

    if (!data || !data.fields || typeof data.fields !== 'object') {
      return {
        success: false,
        total: 0,
        results: [],
        error: 'No fill data found in window.__FILL_DATA__'
      };
    }

    var fields = data.fields;
    var keys = Object.keys(fields);
    var results = [];
    var hasErrors = false;
    var hasNotFound = false;

    for (var i = 0; i < keys.length; i++) {
      var canonicalId = keys[i];
      var value = fields[canonicalId];

      // 查找元素
      var el = findElement(canonicalId);

      if (!el) {
        hasNotFound = true;
        results.push({
          canonical_id: canonicalId,
          status: 'not_found',
          value: value
        });
        continue;
      }

      // 填写并验证
      try {
        var result = fillAndVerify(el, value, 2);
        var status;

        if (result.verified) {
          status = 'ok';
        } else {
          status = 'filled_unverified';
        }

        var entry = {
          canonical_id: canonicalId,
          status: status,
          filled: result.filled,
          verified: result.verified,
          retries: result.retries
        };

        // 如果验证失败，记录实际值
        if (!result.verified) {
          var actual = '';
          if (typeof el.value !== 'undefined') {
            actual = String(el.value);
          } else if (el.isContentEditable) {
            actual = el.innerText || el.textContent || '';
          }
          entry.actualValue = actual;
        }

        results.push(entry);
      } catch (err) {
        hasErrors = true;
        results.push({
          canonical_id: canonicalId,
          status: 'error',
          error: err.message || String(err),
          value: value
        });
      }
    }

    return {
      success: !hasErrors && !hasNotFound,
      total: keys.length,
      results: results
    };
  }

  return execute();
})()
