#!/usr/bin/env node
// Google Sheets 双向同步脚本 — 上传/下载 JSON 数据到 Google Sheets
// 用法: node sheets-sync.mjs <upload|download> --config <path> --data <path>

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { webcrypto as crypto } from 'node:crypto';

// --- 常量 ---

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const CHUNK_SIZE = 500;
const MAX_RETRIES = 3;
const FETCH_TIMEOUT = 30_000;

// --- Sheet 定义 ---
// 与 Chrome 扩展保持一致的列定义，适配 Node.js 脚本使用场景

const SHEET_DEFS = {
  products: {
    tabName: 'products',
    columns: [
      'id', 'name', 'url', 'tagline', 'shortDesc', 'longDesc',
      'categories', 'logoSquare', 'logoBanner', 'screenshots',
      'founderName', 'founderEmail', 'socialLinks', 'createdAt', 'updatedAt',
    ],
    jsonFields: new Set(['categories', 'screenshots', 'socialLinks']),
    dateFields: new Set(['createdAt', 'updatedAt']),
  },
  submissions: {
    tabName: 'submissions',
    columns: [
      'id', 'siteName', 'siteUrl', 'productId', 'status',
      'fields', 'submittedAt', 'result',
      'createdAt', 'updatedAt',
    ],
    jsonFields: new Set(['fields']),
    dateFields: new Set(['submittedAt', 'createdAt', 'updatedAt']),
  },
  sites: {
    tabName: 'sites',
    columns: [
      'id', 'domain', 'url', 'submitUrl', 'category', 'commentSystem',
      'antispam', 'relAttribute', 'productId', 'pricing',
      'monthlyTraffic', 'lang', 'addedAt', 'createdAt', 'updatedAt',
    ],
    jsonFields: new Set(['antispam']),
    dateFields: new Set(['addedAt', 'createdAt', 'updatedAt']),
  },
  backlinks: {
    tabName: 'backlinks',
    columns: [
      'id', 'sourceUrl', 'sourceTitle', 'pageAscore', 'status',
      'analysisLog', 'domain', 'addedAt', 'createdAt', 'updatedAt',
    ],
    jsonFields: new Set(['analysisLog']),
    dateFields: new Set(['addedAt', 'createdAt', 'updatedAt']),
  },
};

// --- Token 缓存 ---

let cachedToken = null;
let cachedExpiresAt = 0;

// --- CLI 参数解析 ---

function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (command !== 'upload' && command !== 'download') {
    console.error('用法: node sheets-sync.mjs <upload|download> --config <path> --data <path>');
    process.exit(1);
  }

  let configPath = null;
  let dataDir = null;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--config' && args[i + 1]) {
      configPath = resolve(args[++i]);
    } else if (args[i] === '--data' && args[i + 1]) {
      dataDir = resolve(args[++i]);
    }
  }

  if (!configPath || !dataDir) {
    console.error('错误: 必须指定 --config 和 --data 参数');
    process.exit(1);
  }

  return { command, configPath, dataDir };
}

// --- 编码工具 ---

/** Buffer 转 base64url 字符串 */
function base64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

/** PEM 私钥转 DER Buffer */
function pemToDer(pem) {
  const b64 = pem
    .replace(/-----BEGIN.*?-----/g, '')
    .replace(/-----END.*?-----/g, '')
    .replace(/\s/g, '');
  return Buffer.from(b64, 'base64');
}

// --- JWT 认证 ---

/** 创建 RS256 签名的 JWT */
async function createJwt(serviceAccount, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    scope,
    aud: TOKEN_ENDPOINT,
    iat: now,
    exp: now + 3600,
  };

  const headerB64 = base64url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload)));
  const unsigned = `${headerB64}.${payloadB64}`;

  const derKey = pemToDer(serviceAccount.private_key);

  const key = await crypto.subtle.importKey(
    'pkcs8',
    derKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  );

  return `${unsigned}.${base64url(new Uint8Array(signature))}`;
}

/** 获取/缓存/刷新 access token */
async function getAuthToken(serviceAccount) {
  // 使用 60 秒安全缓冲
  if (cachedToken && Date.now() < cachedExpiresAt - 60_000) {
    return cachedToken;
  }

  const jwt = await createJwt(serviceAccount, SCOPES);
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token 请求失败: ${res.status} ${body}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  cachedExpiresAt = Date.now() + data.expires_in * 1000;
  return cachedToken;
}

/** 清除缓存的 token */
function clearCachedToken() {
  cachedToken = null;
  cachedExpiresAt = 0;
}

// --- HTTP 请求（带重试） ---

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 带 auth + 重试逻辑的 fetch
 * - 401: 清除 token, 重试一次
 * - 429: 等待 Retry-After 秒后重试
 * - 5xx: 指数退避 (1s, 2s, 4s)，最多 MAX_RETRIES 次
 * - 其他 4xx: 直接抛出
 */
async function sheetsFetch(url, options, serviceAccount) {
  const maxRetries = MAX_RETRIES;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const token = await getAuthToken(serviceAccount);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
      const res = await fetch(url, {
        ...options,
        signal: options?.signal ?? controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      });
      clearTimeout(timeoutId);

      // 401: 清除 token，重试一次
      if (res.status === 401) {
        clearCachedToken();
        if (attempt < maxRetries) continue;
        const body = await res.text();
        throw new Error(`HTTP 401: ${body}`);
      }

      // 429: 读取 Retry-After 后等待
      if (res.status === 429) {
        if (attempt < maxRetries) {
          const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10);
          console.log(`  速率限制，等待 ${retryAfter}s 后重试...`);
          await sleep(retryAfter * 1000);
          continue;
        }
        const body = await res.text();
        throw new Error(`HTTP 429: ${body}`);
      }

      // 5xx: 指数退避
      if (res.status >= 500) {
        if (attempt < maxRetries) {
          const delay = 1000 * Math.pow(2, attempt);
          console.log(`  服务器错误 ${res.status}，${delay}ms 后重试 (${attempt + 1}/${maxRetries})...`);
          await sleep(delay);
          continue;
        }
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body}`);
      }

      // 其他 4xx: 直接抛出
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body}`);
      }

      return res;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof TypeError || err.name === 'AbortError') {
        if (attempt < maxRetries) {
          await sleep(1000 * Math.pow(2, attempt));
          continue;
        }
      }
      throw err;
    }
  }

  throw new Error('超过最大重试次数');
}

// --- 工具函数 ---

/** 从 Google Sheets URL 中提取 spreadsheet ID */
function extractSheetId(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// --- 序列化 ---

/** 将对象转换为按列序排列的行数组 */
function serializeRow(obj, def) {
  return def.columns.map(col => {
    const raw = obj[col];
    if (raw === undefined || raw === null) return '';
    if (def.jsonFields.has(col)) return JSON.stringify(raw);
    // 日期字段：保持 ISO 字符串或时间戳转 ISO
    if (def.dateFields.has(col)) {
      if (typeof raw === 'number') return new Date(raw).toISOString();
      return String(raw);
    }
    return String(raw);
  });
}

/** 将原始行数据反序列化为对象数组 */
function deserializeRows(rows, def) {
  if (!rows || rows.length <= 1) return [];

  const headerRow = rows[0];

  // 建立 header 文本 -> 列索引映射
  const headerIndex = new Map();
  for (let i = 0; i < headerRow.length; i++) {
    headerIndex.set(headerRow[i]?.trim(), i);
  }

  const colIndexMap = new Map();
  def.columns.forEach((col, ci) => {
    const ri = headerIndex.get(col);
    if (ri !== undefined) colIndexMap.set(ci, ri);
  });

  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const obj = {};
    for (let ci = 0; ci < def.columns.length; ci++) {
      const col = def.columns[ci];
      const ri = colIndexMap.get(ci);
      if (ri === undefined) continue;
      const val = row[ri] ?? '';
      if (val === '') continue;

      if (def.jsonFields.has(col)) {
        try {
          obj[col] = JSON.parse(val);
        } catch {
          obj[col] = val;
        }
      } else if (def.dateFields.has(col)) {
        const ts = new Date(val).getTime();
        if (!Number.isNaN(ts)) obj[col] = ts;
      } else {
        obj[col] = val;
      }
    }
    records.push(obj);
  }

  return records;
}

// --- Sheets 操作 ---

/** 确保 Sheet tab 存在，不存在则创建 */
async function ensureSheetTab(spreadsheetId, tabName, serviceAccount) {
  const url = `${SHEETS_BASE}/${spreadsheetId}?fields=sheets.properties.title`;
  const res = await sheetsFetch(url, {}, serviceAccount);
  const body = await res.json();
  const existingTitles = new Set(
    (body.sheets ?? []).map(s => s.properties?.title).filter(Boolean),
  );

  if (existingTitles.has(tabName)) return;

  await sheetsFetch(`${SHEETS_BASE}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title: tabName } } }],
    }),
  }, serviceAccount);

  console.log(`  创建 tab: ${tabName}`);
}

/** 备份 tab 内容 */
async function backupTab(spreadsheetId, tabName, serviceAccount) {
  try {
    const range = encodeURIComponent(`${tabName}!A1:Z`);
    const res = await sheetsFetch(`${SHEETS_BASE}/${spreadsheetId}/values/${range}`, {}, serviceAccount);
    const body = await res.json();
    return body.values ?? [];
  } catch {
    return [];
  }
}

/** 清除 tab 内容 */
async function clearTab(spreadsheetId, tabName, serviceAccount) {
  try {
    await sheetsFetch(
      `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(tabName)}:clear`,
      { method: 'POST' },
      serviceAccount,
    );
  } catch {
    // tab 可能不存在，忽略清除错误
  }
}

/** 分块上传行数据 */
async function uploadChunked(spreadsheetId, tabName, rows, serviceAccount) {
  if (rows.length === 0) return true;

  const chunks = [];
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    chunks.push(rows.slice(i, i + CHUNK_SIZE));
  }

  for (let c = 0; c < chunks.length; c++) {
    const startRow = c * CHUNK_SIZE + 1;
    const range = encodeURIComponent(`${tabName}!A${startRow}`);

    await sheetsFetch(
      `${SHEETS_BASE}/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        body: JSON.stringify({ values: chunks[c] }),
      },
      serviceAccount,
    );

    if (chunks.length > 1) {
      console.log(`  上传分块 ${c + 1}/${chunks.length} (${chunks[c].length} 行)`);
    }
  }

  return true;
}

// --- 上传流程 ---

async function upload(config, dataDir) {
  const spreadsheetId = extractSheetId(config.sheetUrl);
  if (!spreadsheetId) {
    throw new Error(`无效的 Google Sheet URL: ${config.sheetUrl}`);
  }

  const serviceAccount = config.serviceAccountKey;
  const results = {};
  const failedTabs = [];
  const backups = new Map();

  // 阶段 1: 确保 tab 存在 + 备份
  console.log('[1/3] 准备 tab 并备份...');
  for (const [dataType, def] of Object.entries(SHEET_DEFS)) {
    await ensureSheetTab(spreadsheetId, def.tabName, serviceAccount);
    const backup = await backupTab(spreadsheetId, def.tabName, serviceAccount);
    backups.set(def.tabName, backup);
    console.log(`  备份 ${def.tabName}: ${backup.length} 行`);
  }

  // 阶段 2: 分块上传
  console.log('[2/3] 上传数据...');
  for (const [dataType, def] of Object.entries(SHEET_DEFS)) {
    const filePath = join(dataDir, `${dataType}.json`);
    let records = [];

    if (existsSync(filePath)) {
      try {
        records = JSON.parse(readFileSync(filePath, 'utf-8'));
      } catch (err) {
        console.error(`  读取 ${dataType}.json 失败: ${err.message}`);
        failedTabs.push(def.tabName);
        continue;
      }
    }

    if (!Array.isArray(records)) {
      console.error(`  ${dataType}.json 不是数组，跳过`);
      failedTabs.push(def.tabName);
      continue;
    }

    const header = [...def.columns];
    const dataRows = records.map(r => serializeRow(r, def));
    const allRows = [header, ...dataRows];

    try {
      await clearTab(spreadsheetId, def.tabName, serviceAccount);
      await uploadChunked(spreadsheetId, def.tabName, allRows, serviceAccount);
      results[dataType] = records.length;
      console.log(`  ${def.tabName}: ${records.length} 条记录已上传`);
    } catch (err) {
      console.error(`  上传 ${def.tabName} 失败: ${err.message}`);
      failedTabs.push(def.tabName);
    }
  }

  // 阶段 3: 回滚失败的 tab
  if (failedTabs.length > 0) {
    console.log('[3/3] 回滚失败的 tab...');
    for (const tabName of failedTabs) {
      const backup = backups.get(tabName);
      if (!backup || backup.length === 0) {
        try {
          await clearTab(spreadsheetId, tabName, serviceAccount);
          console.log(`  ${tabName}: 已清除（无备份数据）`);
        } catch {
          console.error(`  ${tabName}: 清除失败`);
        }
        continue;
      }

      try {
        const range = encodeURIComponent(`${tabName}!A1`);
        await sheetsFetch(
          `${SHEETS_BASE}/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`,
          {
            method: 'PUT',
            body: JSON.stringify({ values: backup }),
          },
          serviceAccount,
        );
        console.log(`  ${tabName}: 已从备份恢复 (${backup.length} 行)`);
      } catch (err) {
        console.error(`  ${tabName}: 回滚失败 — ${err.message}`);
      }
    }
  } else {
    console.log('[3/3] 无需回滚');
  }

  console.log('\n上传完成:');
  for (const [key, count] of Object.entries(results)) {
    console.log(`  ${key}: ${count} 条`);
  }
  if (failedTabs.length > 0) {
    console.log(`  失败的 tab: ${failedTabs.join(', ')}`);
  }
}

// --- 下载流程 ---

async function download(config, dataDir) {
  const spreadsheetId = extractSheetId(config.sheetUrl);
  if (!spreadsheetId) {
    throw new Error(`无效的 Google Sheet URL: ${config.sheetUrl}`);
  }

  const serviceAccount = config.serviceAccountKey;

  // 确保数据目录存在
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const results = {};

  console.log('从 Google Sheets 下载数据...');
  for (const [dataType, def] of Object.entries(SHEET_DEFS)) {
    const range = encodeURIComponent(`${def.tabName}!A1:Z`);
    try {
      const res = await sheetsFetch(
        `${SHEETS_BASE}/${spreadsheetId}/values/${range}`,
        {},
        serviceAccount,
      );
      const body = await res.json();
      const values = body.values;

      if (!values || values.length <= 1) {
        results[dataType] = 0;
        const filePath = join(dataDir, `${dataType}.json`);
        writeFileSync(filePath, JSON.stringify([], null, 2));
        console.log(`  ${def.tabName}: 空`);
        continue;
      }

      const records = deserializeRows(values, def);
      const filePath = join(dataDir, `${dataType}.json`);
      writeFileSync(filePath, JSON.stringify(records, null, 2));
      results[dataType] = records.length;
      console.log(`  ${def.tabName}: ${records.length} 条记录已下载`);
    } catch (err) {
      console.error(`  下载 ${def.tabName} 失败: ${err.message}`);
      results[dataType] = -1;
    }
  }

  console.log('\n下载完成:');
  for (const [key, count] of Object.entries(results)) {
    if (count >= 0) {
      console.log(`  ${key}: ${count} 条`);
    } else {
      console.log(`  ${key}: 失败`);
    }
  }
}

// --- 入口 ---

async function main() {
  const { command, configPath, dataDir } = parseArgs();

  if (!existsSync(configPath)) {
    console.error(`配置文件不存在: ${configPath}`);
    process.exit(1);
  }

  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch (err) {
    console.error(`解析配置文件失败: ${err.message}`);
    process.exit(1);
  }

  if (!config.serviceAccountKey || !config.sheetUrl) {
    console.error('配置文件缺少 serviceAccountKey 或 sheetUrl');
    process.exit(1);
  }

  if (!config.serviceAccountKey.client_email || !config.serviceAccountKey.private_key) {
    console.error('serviceAccountKey 缺少 client_email 或 private_key');
    process.exit(1);
  }

  try {
    if (command === 'upload') {
      await upload(config, dataDir);
    } else {
      await download(config, dataDir);
    }
  } catch (err) {
    console.error(`\n错误: ${err.message}`);
    process.exit(1);
  }
}

main();
