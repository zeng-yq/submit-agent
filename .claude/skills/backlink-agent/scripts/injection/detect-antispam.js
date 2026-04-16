(() => {
  const detected = [];

  // --- Akismet ---
  // WordPress 默认反垃圾，检查加载的脚本和隐藏字段
  const akismetScript = document.querySelector('script[src*="akismet"]');
  const akismetInput = document.querySelector('input[name*="akismet" i]');
  const akismetComment = document.querySelector('#akismet_comment_nonce') ||
                         document.querySelector('input[name="akismet_comment_nonce"]');
  if (akismetScript || akismetInput || akismetComment) {
    detected.push({
      name: 'akismet',
      bypassable: true,
      evidence: akismetScript ? 'script' : (akismetInput ? 'input' : 'nonce_field')
    });
  }

  // --- Anti-spam Bee ---
  // WordPress 插件，生成隐藏的 honeypot 字段
  const asbInput = document.querySelector('input[name*="antispam_bee" i]') ||
                   document.querySelector('.antispam-group') ||
                   document.querySelector('input[data-is-spam]');
  const asbScript = document.querySelector('script[src*="antispam"]') &&
                    !document.querySelector('script[src*="akismet"]');
  if (asbInput || asbScript) {
    detected.push({
      name: 'antispam_bee',
      bypassable: true,
      evidence: asbInput ? 'honeypot_field' : 'script'
    });
  }

  // --- WP Anti-Spam (原 Growmap Anti-Spambot) ---
  // 在评论表单中添加必填的隐藏 checkbox
  const wpasCheckbox = document.querySelector('input[name="mg-gasp-checkbox" i]') ||
                       document.querySelector('input[id*="gasp" i]') ||
                       document.querySelector('.gasp-checkbox');
  const wpasScript = document.querySelector('script[src*="gasp"]') ||
                     Array.from(document.querySelectorAll('script')).some(s => s.textContent.includes('gasp'));
  if (wpasCheckbox) {
    detected.push({
      name: 'wpantispam',
      bypassable: 'depends_on_config',
      evidence: 'checkbox_field',
      note: '需要确认该 checkbox 是否可被 JS 自动勾选'
    });
  }

  // --- CleanTalk ---
  // 云端反垃圾服务，使用 JS 指纹采集
  const cleantalkScript = document.querySelector('script[src*="cleantalk"]') ||
                          document.querySelector('script[src*="ct_bot_detector"]') ||
                          document.querySelector('input[name*="ct_checkjs" i]');
  const cleantalkHidden = document.querySelector('#cleantalk_hidden_field') ||
                          document.querySelector('input[name="ct_checkjs"]');
  if (cleantalkScript || cleantalkHidden) {
    detected.push({
      name: 'cleantalk',
      bypassable: false,
      evidence: cleantalkScript ? 'script' : 'hidden_field',
      note: '依赖浏览器指纹，难以绕过'
    });
  }

  // --- hCaptcha ---
  // 验证码服务
  const hcaptchaFrame = document.querySelector('iframe[src*="hcaptcha"]') ||
                        document.querySelector('.h-captcha') ||
                        document.querySelector('[data-hcaptcha-widget-id]');
  const hcaptchaScript = document.querySelector('script[src*="hcaptcha"]');
  if (hcaptchaFrame || hcaptchaScript) {
    detected.push({
      name: 'hcaptcha',
      bypassable: false,
      evidence: hcaptchaFrame ? 'iframe' : 'script',
      note: '需要人工解决验证码或使用第三方服务'
    });
  }

  // --- Jetpack Protect / Jetpack Comment Form ---
  // Jetpack 的反垃圾模块
  const jetpackComment = document.querySelector('.jetpack-comment-form') ||
                         document.querySelector('input[name*="jetpack" i]') ||
                         document.querySelector('script[src*="jetpack"]');
  const jetpackProtect = document.querySelector('.jp-jetpack-contact-form') ||
                         document.querySelector('[data-jetpack-protect]');
  if (jetpackComment || jetpackProtect) {
    detected.push({
      name: 'jetpack',
      bypassable: false,
      evidence: jetpackComment ? 'comment_form' : 'protect',
      note: 'Jetpack 反垃圾依赖后端 token，无法前端绕过'
    });
  }

  return {
    detected,
    hasBypassable: detected.some(d => d.bypassable === true),
    hasUnbypassable: detected.some(d => d.bypassable === false),
    count: detected.length
  };
})()
