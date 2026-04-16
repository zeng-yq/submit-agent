(() => {
  // --- 蜜罐名称模式 ---
  const HONEYPOT_NAME_PATTERNS = [
    /honeypot/i,
    /hp_/i,
    /ak_hp/i,
    /trap/i,
    /cloaked/i,
    /^_wpcf7/i,
    /nospam/i,
    /no.?spam/i,
    /antispam/i,
    /anti.?bot/i,
    /wpbruiser/i,
    /gotcha/i,
    /[a-f0-9]{32,}/i
  ];

  // --- 工具函数 ---

  function cssEscape(str) {
    if (!str) return '';
    return String(str).replace(/([!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~])/g, '\\$1');
  }

  function buildSelector(el) {
    if (el.id) {
      return '#' + cssEscape(el.id);
    }
    if (el.name) {
      return '[name="' + cssEscape(el.name) + '"]';
    }
    const parts = [];
    let current = el;
    while (current && current !== document.documentElement) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        selector = '#' + cssEscape(current.id);
        parts.unshift(selector);
        break;
      }
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

  function matchesNamePattern(str) {
    if (!str) return false;
    for (let i = 0; i < HONEYPOT_NAME_PATTERNS.length; i++) {
      if (HONEYPOT_NAME_PATTERNS[i].test(str)) return true;
    }
    return false;
  }

  function hasIdentitySignals(el) {
    if (el.getAttribute('aria-label')) return true;
    if (el.getAttribute('title')) return true;
    if (el.id) return true;
    return false;
  }

  function labelOnlyNonAlphanumeric(el) {
    const ariaLabel = el.getAttribute('aria-label') || '';
    const title = el.getAttribute('title') || '';
    const text = ariaLabel || title;
    if (!text) return false;
    return !/[a-zA-Z0-9]/.test(text);
  }

  function hasHiddenAncestor(el) {
    let parent = el.parentElement;
    while (parent && parent !== document.documentElement) {
      const style = el.ownerDocument.defaultView.getComputedStyle(parent);
      if (style.display === 'none') return true;
      if (style.visibility === 'hidden' || style.visibility === 'collapse') return true;
      parent = parent.parentElement;
    }
    return false;
  }

  // --- 主检测函数 ---

  function scanHoneypots() {
    const elements = document.querySelectorAll('input, textarea, select');
    const allResults = [];

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const score = { value: 0 };
      const signals = {
        ariaHidden: false,
        namePattern: false,
        emptyLabel: false,
        negativeTabindex: false,
        autocompleteOff: false,
        hiddenParent: false,
        zeroFontSize: false,
        zeroMaxDimension: false
      };

      // Signal 1: aria-hidden
      if (el.getAttribute('aria-hidden') === 'true') {
        score.value += 80;
        signals.ariaHidden = true;
      }

      // Signal 2: name/id/class matches honeypot pattern
      const nameAttr = el.name || '';
      const idAttr = el.id || '';
      const classAttr = (el.className || '').toString();
      if (matchesNamePattern(nameAttr) || matchesNamePattern(idAttr) || matchesNamePattern(classAttr)) {
        score.value += 60;
        signals.namePattern = true;
      }

      // Signal 3: label only non-alphanumeric
      if (labelOnlyNonAlphanumeric(el)) {
        score.value += 40;
        signals.emptyLabel = true;
      }

      // Signal 4: tabindex < 0, no identity
      const tabindex = el.getAttribute('tabindex');
      if (tabindex !== null && parseInt(tabindex, 10) < 0 && !hasIdentitySignals(el)) {
        score.value += 50;
        signals.negativeTabindex = true;
      }

      // Signal 5: autocomplete="off", no identity
      const autocomplete = el.getAttribute('autocomplete');
      if (autocomplete === 'off' && !hasIdentitySignals(el)) {
        score.value += 50;
        signals.autocompleteOff = true;
      }

      // Signal 6: parent hidden
      if (hasHiddenAncestor(el)) {
        score.value += 50;
        signals.hiddenParent = true;
      }

      // Signal 7: font-size: 0
      const computedStyle = el.ownerDocument.defaultView.getComputedStyle(el);
      if (parseFloat(computedStyle.fontSize) === 0) {
        score.value += 60;
        signals.zeroFontSize = true;
      }

      // Signal 8: max-height/max-width: 0
      const maxHeight = computedStyle.maxHeight;
      const maxWidth = computedStyle.maxWidth;
      if (maxHeight === '0px' || maxWidth === '0px') {
        score.value += 50;
        signals.zeroMaxDimension = true;
      }

      if (score.value > 0) {
        allResults.push({
          selector: buildSelector(el),
          tagName: el.tagName.toUpperCase(),
          name: el.name || '',
          id: el.id || '',
          score: score.value,
          isHoneypot: score.value >= 50,
          signals: signals
        });
      }
    }

    const honeypots = allResults.filter(r => r.isHoneypot);

    return {
      total: elements.length,
      suspicious: allResults.length,
      honeypots: honeypots,
      all: allResults
    };
  }

  return scanHoneypots();
})()
