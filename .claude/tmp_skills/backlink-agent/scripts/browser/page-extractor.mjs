#!/usr/bin/env node
// 页面内容提取脚本 — 通过 CDP Proxy 获取页面 HTML，提取文本和评论信号
// 用法: node page-extractor.mjs <targetId>

const CDP_PROXY = 'http://localhost:3457';
const MAX_TEXT_LENGTH = 8000;

const targetId = process.argv[2];
if (!targetId) {
  console.error('用法: node page-extractor.mjs <targetId>');
  process.exit(1);
}

// --- CDP Proxy 交互 ---

async function evalJs(target, expression) {
  const res = await fetch(`${CDP_PROXY}/eval?target=${encodeURIComponent(target)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/plain' },
    body: expression,
  });
  return res.json();
}

async function getInfo(target) {
  const res = await fetch(`${CDP_PROXY}/info?target=${encodeURIComponent(target)}`);
  return res.json();
}

// --- HTML 处理函数（从插件 backlink-analyzer.ts 移植） ---

/** 提取 <title> 标签内容 */
function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].trim() : '';
}

/** HTML 转纯文本 */
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 检测评论信号（从插件 backlink-analyzer.ts 移植） */
function detectCommentSignals(html) {
  const signals = [];

  if (/<textarea[^>]*>/i.test(html)) {
    const textareaCtx = html.match(/.{0,80}<textarea[\s\S]{0,200}/gi);
    if (textareaCtx) {
      const first = textareaCtx[0].toLowerCase();
      if (first.includes('comment') || first.includes('reply') || first.includes('message') || first.includes('respond')) {
        signals.push('textarea with comment context');
      } else {
        signals.push('textarea element found');
      }
    } else {
      signals.push('textarea element found');
    }
  }

  if (/id\s*=\s*["'][^"']*(?:respond|comment-?form|commentform|replytocom)/i.test(html)) {
    signals.push('comment form container (id)');
  }
  if (/class\s*=\s*["'][^"']*(?:comment-?form|comment-?respond|comments-?area|reply-?form)/i.test(html)) {
    signals.push('comment form container (class)');
  }
  if (/<input[^>]*name\s*=\s*["'](?:url|website|site)/i.test(html)) {
    signals.push('URL/Website input field');
  }
  if (/id\s*=\s*["']comments["']/i.test(html) || /class\s*=\s*["'][^"']*comments[\s"']/i.test(html)) {
    signals.push('comments section');
  }

  return {
    found: signals.length > 0,
    details: signals.join('; '),
  };
}

// --- 主逻辑 ---

async function main() {
  // 获取页面 URL
  const info = await getInfo(targetId);
  const pageUrl = info.url || '';

  // 获取页面 HTML（通过 CDP 在页面内执行 JS）
  const htmlResult = await evalJs(targetId, 'document.documentElement.outerHTML');
  if (htmlResult.error) {
    console.error('获取页面 HTML 失败:', htmlResult.error);
    process.exit(1);
  }

  const html = String(htmlResult.value || '');
  const title = extractTitle(html);
  let textContent = htmlToText(html);
  const commentSignals = detectCommentSignals(html);

  // 截断文本
  if (textContent.length > MAX_TEXT_LENGTH) {
    textContent = textContent.slice(0, MAX_TEXT_LENGTH) + '\n...[truncated]';
  }

  const result = {
    title,
    textContent,
    commentSignals,
    url: pageUrl,
  };

  console.log(JSON.stringify(result));
}

main().catch(err => {
  console.error('页面提取失败:', err.message);
  process.exit(1);
});
