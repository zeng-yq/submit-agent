#!/usr/bin/env node
// 产品页面信息提取脚本 — 通过 CDP Proxy 打开产品页面，提取 meta 信息和正文内容
// 用法: node product-generator.mjs <product-url>

const CDP_PROXY = 'http://localhost:3457';
const POLL_INTERVAL_MS = 1000;
const MAX_WAIT_MS = 30000;

const productUrl = process.argv[2];
if (!productUrl) {
  console.error('用法: node product-generator.mjs <product-url>');
  process.exit(1);
}

// --- CDP Proxy 交互 ---

async function createTab(url) {
  const res = await fetch(`${CDP_PROXY}/new?url=${encodeURIComponent(url)}`);
  return res.json();
}

async function getInfo(target) {
  const res = await fetch(`${CDP_PROXY}/info?target=${encodeURIComponent(target)}`);
  return res.json();
}

async function evalJs(target, expression) {
  const res = await fetch(`${CDP_PROXY}/eval?target=${encodeURIComponent(target)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/plain' },
    body: expression,
  });
  return res.json();
}

async function closeTab(target) {
  try {
    await fetch(`${CDP_PROXY}/close?target=${encodeURIComponent(target)}`);
  } catch {
    // 关闭失败不阻断流程
  }
}

// --- 等待页面加载完成 ---

async function waitForPageLoad(target) {
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    const info = await getInfo(target);
    if (info.ready === 'complete') return info;
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`页面加载超时 (${MAX_WAIT_MS / 1000}s)`);
}

// --- 页面内提取脚本 ---

const EXTRACTION_SCRIPT = `(() => {
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

// --- 主逻辑 ---

async function main() {
  let target = null;

  try {
    // 1. 创建新标签页
    const tabResult = await createTab(productUrl);
    if (tabResult.error || !tabResult.id) {
      throw new Error(tabResult.error || '创建标签页失败，未返回 target ID');
    }
    target = tabResult.id;

    // 2. 等待页面加载完成
    await waitForPageLoad(target);

    // 3. 执行提取脚本
    const evalResult = await evalJs(target, EXTRACTION_SCRIPT);
    if (evalResult.error) {
      throw new Error(`提取脚本执行失败: ${evalResult.error}`);
    }

    const data = typeof evalResult.value === 'string'
      ? JSON.parse(evalResult.value)
      : evalResult.value;

    // 4. 输出 JSON 到 stdout
    console.log(JSON.stringify(data, null, 2));
  } finally {
    // 5. 无论成功或失败，始终关闭标签页
    if (target) await closeTab(target);
  }
}

main().catch(err => {
  console.error('产品页面提取失败:', err.message);
  process.exit(1);
});
