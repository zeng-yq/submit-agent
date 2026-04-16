#!/usr/bin/env node
// CSV 导入脚本 — 解析 Semrush 导出的 CSV，去重后直接写入 SQLite
// 用法: node import-csv.mjs <csv-file-path>

import { readFileSync } from 'node:fs'
import db from './db.mjs'

const csvPath = process.argv[2]

if (!csvPath) {
  console.error('用法: node import-csv.mjs <csv-file-path>')
  process.exit(1)
}

// --- CSV 解析器 ---

function parseCsvLine(line) {
  const fields = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === ',') {
        fields.push(current)
        current = ''
      } else {
        current += char
      }
    }
  }
  fields.push(current)
  return fields
}

function parseCsv(csvText) {
  const lines = csvText.split(/\r?\n/)
  if (lines.length < 2) return []

  const headers = parseCsvLine(lines[0])
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const values = parseCsvLine(line)
    const row = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? ''
    }
    rows.push(row)
  }
  return rows
}

// --- 主逻辑 ---

const csvText = readFileSync(csvPath, 'utf-8')
const rows = parseCsv(csvText)

const insertStmt = db.prepare(`
  INSERT INTO backlinks (id, source_url, source_title, domain, page_ascore, status, analysis, added_at)
  VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
  ON CONFLICT(source_url) DO NOTHING
`)

let imported = 0
let skipped = 0

const batchInsert = db.transaction((rows) => {
  const baseTs = Date.now()
  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx]
    const sourceUrl = row['Source url']?.trim()
    if (!sourceUrl) continue

    const ascore = parseInt(row['Page ascore'] ?? '0', 10)
    let domain
    try {
      domain = new URL(sourceUrl).hostname.replace(/^www\./, '')
    } catch {
      domain = sourceUrl
    }

    const now = new Date().toISOString()
    const id = `bl-${baseTs}-${idx.toString(16).padStart(4, '0')}`

    const result = insertStmt.run(
      id,
      sourceUrl,
      row['Source title']?.trim() ?? '',
      domain,
      isNaN(ascore) ? 0 : ascore,
      'pending',
      now,
    )

    if (result.changes > 0) {
      imported++
    } else {
      skipped++
    }
  }
})

batchInsert(rows)

console.log(JSON.stringify({ imported, skipped }))

db.close()
