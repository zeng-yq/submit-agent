#!/usr/bin/env node
// CSV 导入脚本 — 解析 Semrush 导出的 CSV，按去重规则输出 JSON
// 用法: node import-csv.mjs <csv-file-path> [backlinks-json-path]

import { readFileSync, existsSync } from 'node:fs';

const csvPath = process.argv[2];
const backlinksPath = process.argv[3];

if (!csvPath) {
  console.error('用法: node import-csv.mjs <csv-file-path> [backlinks-json-path]');
  process.exit(1);
}

// --- CSV 解析器 ---

/** 解析单行 CSV（处理引号包裹字段） */
function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        fields.push(current);
        current = '';
      } else {
        current += char;
      }
    }
  }
  fields.push(current);
  return fields;
}

/** 解析 CSV 文本为行数组 */
function parseCsv(csvText) {
  const lines = csvText.split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCsvLine(line);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? '';
    }
    rows.push(row);
  }
  return rows;
}

// --- 去重集 ---

/** 从 backlinks.json 加载已有 sourceUrl 集合 */
function loadExistingUrls() {
  if (!backlinksPath || !existsSync(backlinksPath)) return new Set();
  try {
    const data = JSON.parse(readFileSync(backlinksPath, 'utf-8'));
    return new Set((Array.isArray(data) ? data : []).map(b => b.sourceUrl));
  } catch {
    return new Set();
  }
}

// --- 主逻辑 ---

const csvText = readFileSync(csvPath, 'utf-8');
const rows = parseCsv(csvText);
const existingUrls = loadExistingUrls();
const records = [];
let imported = 0;
let skipped = 0;

for (const row of rows) {
  const sourceUrl = row['Source url']?.trim();
  if (!sourceUrl) continue;

  if (existingUrls.has(sourceUrl)) {
    skipped++;
    continue;
  }

  const ascore = parseInt(row['Page ascore'] ?? '0', 10);
  let domain;
  try {
    domain = new URL(sourceUrl).hostname.replace(/^www\./, '');
  } catch {
    domain = sourceUrl;
  }

  const now = new Date().toISOString();
  const randomHex = Math.random().toString(16).slice(2, 6);
  const id = `bl-${Date.now()}-${randomHex}`;

  records.push({
    id,
    sourceUrl,
    sourceTitle: row['Source title']?.trim() ?? '',
    domain,
    pageAscore: isNaN(ascore) ? 0 : ascore,
    status: 'pending',
    analysis: null,
    addedAt: now,
  });

  existingUrls.add(sourceUrl);
  imported++;
}

const result = { imported, skipped, records };
console.log(JSON.stringify(result));
