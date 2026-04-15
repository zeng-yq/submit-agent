(() => {
  // --- 基础检测 ---
  const textareas = document.querySelectorAll('textarea');
  const hasTextarea = textareas.length > 0;
  const textareaNames = Array.from(textareas).map(t => (t.name || t.id || t.placeholder || '').toLowerCase());

  // URL 字段检测
  const urlInputs = document.querySelectorAll('input[type="url"], input[name*="url" i], input[name*="website" i], input[name*="link" i]');
  const hasUrlField = urlInputs.length > 0;

  // 作者字段检测
  const authorInputs = document.querySelectorAll('input[name*="author" i], input[name*="name" i], input[name*="user" i], input[name*="nick" i]');
  const hasAuthorField = authorInputs.length > 0;

  // 邮箱字段检测
  const emailInputs = document.querySelectorAll('input[type="email"], input[name*="email" i], input[name*="mail" i]');
  const hasEmailField = emailInputs.length > 0;

  // --- 表单检测 ---
  const forms = document.querySelectorAll('form');
  const formActions = Array.from(forms).map(f => (f.action || f.id || '').toLowerCase());

  // 查找包含 textarea 或 comment 相关的表单
  const commentForms = Array.from(forms).filter(form => {
    const html = form.innerHTML.toLowerCase();
    return html.includes('comment') || form.querySelector('textarea') !== null;
  });
  const hasCommentForm = commentForms.length > 0;

  // --- WordPress 检测 ---
  const wpMeta = document.querySelector('meta[name="generator"][content*="WordPress"]');
  const wpBody = document.body.className.includes('wordpress') || document.body.id === 'wordpress';
  const wpContent = document.querySelector('.wp-comments') || document.querySelector('#comments') || document.querySelector('.comment-respond');
  const isWordPress = !!(wpMeta || wpBody || wpContent);

  // --- 评论系统检测 ---
  let commentSystem = 'none';

  // Disqus
  if (document.querySelector('#disqus_thread') || document.querySelector('.disqus-thread') ||
      document.querySelector('[data-disqus-identifier]') || document.querySelector('script[src*="disqus"]')) {
    commentSystem = 'disqus';
  }
  // Facebook Comments
  else if (document.querySelector('.fb-comments') || document.querySelector('[class*="fb-comments"]') ||
           document.querySelector('script[src*="facebook"]')) {
    commentSystem = 'facebook';
  }
  // Commento
  else if (document.querySelector('#commento') || document.querySelector('.commento') ||
           document.querySelector('script[src*="commento"]')) {
    commentSystem = 'commento';
  }
  // 原生评论
  else if (hasCommentForm || hasTextarea) {
    commentSystem = 'native';
  }

  return {
    hasTextarea,
    textareaNames: textareaNames.slice(0, 10),
    hasUrlField,
    hasAuthorField,
    hasEmailField,
    hasCommentForm,
    formActions: formActions.slice(0, 10),
    isWordPress,
    commentSystem
  };
})()
