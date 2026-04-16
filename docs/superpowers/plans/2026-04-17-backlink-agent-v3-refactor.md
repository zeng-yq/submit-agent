# Backlink Agent v3.0 重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 backlink-agent 从平铺结构重构为三层架构，SKILL.md 瘦身为极简入口，数据层改为声明式 Schema + 自动 CRUD。

**Architecture:** 脚本按职责分为 data（纯数据处理）、browser（CDP 交互）、injection（页面注入）三层。db.mjs 用声明式 TABLES 配置替代手写 SQL。db-ops.mjs 用通用 CRUD 引擎替代逐表手写操作。SKILL.md 从 370 行瘦身为 ~130 行，操作流程移入 references 按需加载。

**Tech Stack:** Node.js 22+, better-sqlite3, CDP (Chrome DevTools Protocol)

**Design Spec:** `docs/superpowers/specs/2026-04-17-backlink-agent-refactor-design.md`

---

### Task 1: 创建目录结构 + 迁移文件 + 修复引用路径

**Files:**
- Move: `scripts/db.mjs` → `scripts/data/db.mjs`
- Move: `scripts/db-ops.mjs` → `scripts/data/db-ops.mjs`
- Move: `scripts/db.test.mjs` → `scripts/data/db.test.mjs`
- Move: `scripts/import-csv.mjs` → `scripts/data/import-csv.mjs`
- Move: `scripts/cdp-proxy.mjs` → `scripts/browser/cdp-proxy.mjs`
- Move: `scripts/check-deps.mjs` → `scripts/browser/check-deps.mjs`
- Move: `scripts/page-extractor.mjs` → `scripts/browser/page-extractor.mjs`
- Move: `scripts/product-generator.mjs` → `scripts/browser/product-generator.mjs`
- Move: `scripts/form-analyzer.js` → `scripts/injection/form-analyzer.js`
- Move: `scripts/form-filler.js` → `scripts/injection/form-filler.js`
- Move: `scripts/detect-comment-form.js` → `scripts/injection/detect-comment-form.js`
- Move: `scripts/detect-antispam.js` → `scripts/injection/detect-antispam.js`
- Move: `scripts/honeypot-detector.js` → `scripts/injection/honeypot-detector.js`
- Move: `scripts/comment-expander.js` → `scripts/injection/comment-expander.js`
- Modify: `package.json`
- Modify: `scripts/browser/check-deps.mjs`
- Modify: `scripts/data/db.mjs`

- [ ] **Step 1: 创建子目录**

```bash
cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent/.claude/skills/backlink-agent
mkdir -p scripts/data scripts/browser scripts/injection
```

- [ ] **Step 2: 迁移文件到新目录**

```bash
cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent/.claude/skills/backlink-agent

# data 层
git mv scripts/db.mjs scripts/data/db.mjs
git mv scripts/db-ops.mjs scripts/data/db-ops.mjs
git mv scripts/db.test.mjs scripts/data/db.test.mjs
git mv scripts/import-csv.mjs scripts/data/import-csv.mjs

# browser 层
git mv scripts/cdp-proxy.mjs scripts/browser/cdp-proxy.mjs
git mv scripts/check-deps.mjs scripts/browser/check-deps.mjs
git mv scripts/page-extractor.mjs scripts/browser/page-extractor.mjs
git mv scripts/product-generator.mjs scripts/browser/product-generator.mjs

# injection 层
git mv scripts/form-analyzer.js scripts/injection/form-analyzer.js
git mv scripts/form-filler.js scripts/injection/form-filler.js
git mv scripts/detect-comment-form.js scripts/injection/detect-comment-form.js
git mv scripts/detect-antispam.js scripts/injection/detect-antispam.js
git mv scripts/honeypot-detector.js scripts/injection/honeypot-detector.js
git mv scripts/comment-expander.js scripts/injection/comment-expander.js
```

- [ ] **Step 3: 修复 db.mjs 的 DB_PATH**

文件 `scripts/data/db.mjs`，将第 102 行：

```javascript
const DB_PATH = resolve(__dirname, '../data/backlink.db')
```

改为：

```javascript
const DB_PATH = resolve(__dirname, '../../data/backlink.db')
```

原因：db.mjs 从 `scripts/` 移到了 `scripts/data/`，需要多回退一层。

- [ ] **Step 4: 修复 check-deps.mjs 的 PROXY_SCRIPT 路径**

文件 `scripts/browser/check-deps.mjs`，将第 12 行：

```javascript
const PROXY_SCRIPT = path.join(ROOT, 'scripts', 'cdp-proxy.mjs');
```

改为：

```javascript
const PROXY_SCRIPT = path.join(ROOT, 'scripts', 'browser', 'cdp-proxy.mjs');
```

- [ ] **Step 5: 修复 package.json 路径**

文件 `package.json`，将：

```json
"scripts": {
  "test": "node --test scripts/db.test.mjs",
  "build": "node scripts/db.mjs"
}
```

改为：

```json
"scripts": {
  "test": "node --test scripts/data/db.test.mjs",
  "build": "node scripts/data/db.mjs"
}
```

- [ ] **Step 6: 运行测试确认迁移未破坏功能**

```bash
cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent/.claude/skills/backlink-agent && npm test
```

Expected: 所有测试通过（与迁移前相同）。

- [ ] **Step 7: 提交**

```bash
cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent
git add .claude/skills/backlink-agent/
git commit -m "refactor(backlink-agent): 重组脚本目录为 data/browser/injection 三层结构"
```

---

### Task 2: 重写 db.mjs — 声明式 Schema

**Files:**
- Rewrite: `scripts/data/db.mjs`
- Modify: `scripts/data/db.test.mjs` (仅更新 import 路径，已在同目录无需改)

- [ ] **Step 1: 重写 db.mjs**

用声明式 `TABLES` 配置替代手写 `SCHEMA_SQL`。保持完全相同的建表结果。

完整替换 `scripts/data/db.mjs` 内容为：

```javascript
import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// --- 声明式 Schema 定义 ---
// 每个表的字段、约束、索引都通过配置对象声明。
// 新增表只需在此处添加配置，即可自动获得建表 SQL 和 CRUD 支持。

export const TABLES = {
  products: {
    columns: {
      id:            { type: 'TEXT', pk: true },
      name:          { type: 'TEXT', notNull: true, unique: true },
      url:           { type: 'TEXT', notNull: true },
      tagline:       { type: 'TEXT', notNull: true, default: "''" },
      short_desc:    { type: 'TEXT', notNull: true, default: "''" },
      long_desc:     { type: 'TEXT', notNull: true, default: "''" },
      categories:    { type: 'TEXT', notNull: true, default: "'[]'", json: true },
      anchor_texts:  { type: 'TEXT', notNull: true, default: "'[]'", json: true },
      logo_url:      { type: 'TEXT', default: "''" },
      social_links:  { type: 'TEXT', default: "'{}'", json: true },
      founder_name:  { type: 'TEXT', default: "''" },
      founder_email: { type: 'TEXT', default: "''" },
      created_at:    { type: 'TEXT', notNull: true, default: "datetime('now')" },
    },
  },
  backlinks: {
    columns: {
      id:           { type: 'TEXT', pk: true },
      source_url:   { type: 'TEXT', notNull: true, unique: true },
      source_title: { type: 'TEXT', default: "''" },
      domain:       { type: 'TEXT', notNull: true },
      page_ascore:  { type: 'INTEGER' },
      status:       { type: 'TEXT', notNull: true, default: "'pending'", check: "'pending','publishable','not_publishable','skipped','error'" },
      analysis:     { type: 'TEXT', json: true },
      added_at:     { type: 'TEXT', notNull: true, default: "datetime('now')" },
    },
    indexes: [
      { name: 'idx_backlinks_status', columns: ['status'] },
      { name: 'idx_backlinks_domain', columns: ['domain'] },
    ],
  },
  sites: {
    columns: {
      id:              { type: 'TEXT', pk: true },
      domain:          { type: 'TEXT', notNull: true },
      url:             { type: 'TEXT', notNull: true },
      submit_url:      { type: 'TEXT', default: "''" },
      category:        { type: 'TEXT', default: "''" },
      comment_system:  { type: 'TEXT', default: "''" },
      antispam:        { type: 'TEXT', default: "'[]'", json: true },
      rel_attribute:   { type: 'TEXT', default: "''" },
      product_id:      { type: 'TEXT', notNull: true, default: "''", fk: 'products(id)' },
      pricing:         { type: 'TEXT', default: "'free'" },
      monthly_traffic: { type: 'TEXT', default: "''" },
      lang:            { type: 'TEXT', default: "'en'" },
      dr:              { type: 'INTEGER' },
      notes:           { type: 'TEXT', default: "''" },
      added_at:        { type: 'TEXT', notNull: true, default: "datetime('now')" },
    },
    indexes: [
      { name: 'idx_sites_domain', columns: ['domain'] },
      { name: 'idx_sites_product_id', columns: ['product_id'] },
    ],
  },
  submissions: {
    columns: {
      id:           { type: 'TEXT', pk: true },
      site_name:    { type: 'TEXT', notNull: true },
      site_url:     { type: 'TEXT', notNull: true },
      product_id:   { type: 'TEXT', notNull: true, fk: 'products(id)' },
      status:       { type: 'TEXT', notNull: true, default: "'submitted'", check: "'submitted','failed','skipped'" },
      submitted_at: { type: 'TEXT', notNull: true, default: "datetime('now')" },
      result:       { type: 'TEXT', default: "''" },
      fields:       { type: 'TEXT', default: "'{}'", json: true },
    },
    indexes: [
      { name: 'idx_submissions_product_id', columns: ['product_id'] },
      { name: 'idx_submissions_status', columns: ['status'] },
    ],
  },
  site_experience: {
    columns: {
      domain:               { type: 'TEXT', pk: true },
      aliases:              { type: 'TEXT', default: "'[]'", json: true },
      updated:              { type: 'TEXT', notNull: true, default: "datetime('now')" },
      submit_type:          { type: 'TEXT', default: "''" },
      form_framework:       { type: 'TEXT', default: "''" },
      antispam:             { type: 'TEXT', default: "''" },
      fill_strategy:        { type: 'TEXT', default: "''" },
      post_submit_behavior: { type: 'TEXT', default: "''" },
      effective_patterns:   { type: 'TEXT', default: "'[]'", json: true },
      known_traps:          { type: 'TEXT', default: "'[]'", json: true },
    },
  },
}

// --- Schema → SQL 生成 ---

function buildCreateTableSQL(name, tableDef) {
  const cols = []
  const fks = []
  for (const [colName, colDef] of Object.entries(tableDef.columns)) {
    let sql = `  ${colName} ${colDef.type}`
    if (colDef.pk) sql += ' PRIMARY KEY'
    if (colDef.notNull) sql += ' NOT NULL'
    if (colDef.unique) sql += ' UNIQUE'
    if (colDef.default !== undefined) sql += ` DEFAULT (${colDef.default})`
    if (colDef.check) sql += ` CHECK(${colName} IN (${colDef.check}))`
    if (colDef.fk) fks.push(`  FOREIGN KEY (${colName}) REFERENCES ${colDef.fk}`)
    cols.push(sql)
  }
  let sql = `CREATE TABLE IF NOT EXISTS ${name} (\n${cols.join(',\n')}`
  if (fks.length) sql += `,\n${fks.join(',\n')}`
  sql += '\n)'
  return sql
}

function buildIndexSQL(name, tableDef) {
  const sqls = []
  // 为 unique 列生成命名索引（保持与旧 schema 一致的索引名）
  for (const [colName, colDef] of Object.entries(tableDef.columns)) {
    if (colDef.unique && !colDef.pk) {
      sqls.push(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${name}_${colName} ON ${name}(${colName})`)
    }
  }
  for (const idx of (tableDef.indexes || [])) {
    sqls.push(`CREATE INDEX IF NOT EXISTS ${idx.name} ON ${name}(${idx.columns.join(', ')})`)
  }
  return sqls
}

function buildSchemaSQL() {
  const parts = []
  for (const [name, tableDef] of Object.entries(TABLES)) {
    parts.push(buildCreateTableSQL(name, tableDef))
    for (const idxSQL of buildIndexSQL(name, tableDef)) {
      parts.push(idxSQL)
    }
  }
  return parts.join(';\n\n') + ';'
}

// --- Schema 元数据查询 API ---
// 供 db-ops.mjs 的通用 CRUD 引擎使用

export function getJsonColumns(table) {
  if (!TABLES[table]) return []
  return Object.entries(TABLES[table].columns)
    .filter(([, def]) => def.json)
    .map(([name]) => name)
}

export function getPkColumn(table) {
  if (!TABLES[table]) return null
  for (const [name, def] of Object.entries(TABLES[table].columns)) {
    if (def.pk) return name
  }
  return null
}

export function getColumnNames(table) {
  if (!TABLES[table]) return []
  return Object.keys(TABLES[table].columns)
}

export function hasTable(table) {
  return table in TABLES
}

// --- 数据库创建 ---

export function createDb(dbPath) {
  const db = new Database(dbPath)
  if (dbPath !== ':memory:') {
    db.pragma('journal_mode = WAL')
    db.pragma('busy_timeout = 5000')
  }
  db.pragma('foreign_keys = ON')
  db.exec(buildSchemaSQL())
  return db
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = resolve(__dirname, '../../data/backlink.db')
export default createDb(DB_PATH)
```

- [ ] **Step 2: 运行测试确认声明式 Schema 生成的 SQL 与旧版完全一致**

```bash
cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent/.claude/skills/backlink-agent && npm test
```

Expected: 所有测试通过。声明式 Schema 生成的表结构、索引、约束与手写 SQL 完全相同。

- [ ] **Step 3: 提交**

```bash
cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent
git add .claude/skills/backlink-agent/scripts/data/db.mjs
git commit -m "refactor(backlink-agent): db.mjs 改为声明式 Schema 定义"
```

---

### Task 3: 重写 db-ops.mjs — 通用 CRUD 引擎

**Files:**
- Rewrite: `scripts/data/db-ops.mjs`

- [ ] **Step 1: 重写 db-ops.mjs**

用通用 CRUD 引擎替代逐表手写。保持完全相同的 CLI 接口和返回格式。

完整替换 `scripts/data/db-ops.mjs` 内容为：

```javascript
import { fileURLToPath } from 'node:url'
import db from './db.mjs'
import { getJsonColumns, getPkColumn, getColumnNames } from './db.mjs'

// --- 字段映射工具（schema 驱动） ---

const camelToSnake = s => s.replace(/[A-Z]/g, c => '_' + c.toLowerCase())
const snakeToCamel = s => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase())

/** camelCase 对象 → snake_case 数据库行，JSON 字段自动序列化 */
function toRow(table, obj) {
  const jsonCols = new Set(getJsonColumns(table))
  const row = {}
  for (const [k, v] of Object.entries(obj)) {
    const snakeKey = camelToSnake(k)
    if (jsonCols.has(snakeKey)) {
      row[snakeKey] = v != null ? JSON.stringify(v) : null
    } else if (Array.isArray(v) || (v && typeof v === 'object' && !(v instanceof Date))) {
      row[snakeKey] = JSON.stringify(v)
    } else {
      row[snakeKey] = v
    }
  }
  return row
}

/** snake_case 数据库行 → camelCase 对象，JSON 字段自动反序列化 */
function toCamel(table, row) {
  if (!row) return null
  const jsonCols = new Set(getJsonColumns(table))
  const obj = {}
  for (const [k, v] of Object.entries(row)) {
    const camelKey = snakeToCamel(k)
    if (jsonCols.has(k) && typeof v === 'string') {
      try { obj[camelKey] = JSON.parse(v); continue } catch { /* not JSON */ }
    }
    obj[camelKey] = v
  }
  return obj
}

// --- 通用 CRUD 操作 ---

function insert(db, table, record) {
  const row = toRow(table, record)
  const columns = Object.keys(row)
  const values = Object.values(row)
  const placeholders = columns.map(() => '?').join(', ')
  const pk = getPkColumn(table)
  db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`).run(...values)
  return toCamel(table, db.prepare(`SELECT * FROM ${table} WHERE ${pk} = ?`).get(row[pk]))
}

function getById(db, table, id) {
  const pk = getPkColumn(table)
  return toCamel(table, db.prepare(`SELECT * FROM ${table} WHERE ${pk} = ?`).get(id))
}

function getBy(db, table, column, value) {
  return toCamel(table, db.prepare(`SELECT * FROM ${table} WHERE ${column} = ?`).get(value))
}

function listAll(db, table, filters) {
  if (filters && Object.keys(filters).length > 0) {
    const where = Object.entries(filters).map(([k, v]) => `${camelToSnake(k)} = ?`).join(' AND ')
    return db.prepare(`SELECT * FROM ${table} WHERE ${where} ORDER BY rowid`)
      .all(...Object.values(filters)).map(r => toCamel(table, r))
  }
  return db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(r => toCamel(table, r))
}

function updateFields(db, table, id, data) {
  const row = toRow(table, data)
  const pk = getPkColumn(table)
  const sets = Object.keys(row).map(k => `${k} = ?`)
  const values = [...Object.values(row), id]
  db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE ${pk} = ?`).run(...values)
}

function upsertRow(db, table, key, record) {
  const row = toRow(table, { ...record, [key]: record[camelToSnake(key) === key ? key : snakeToCamel(key)] })
  // 确保 key 字段在 row 中
  const allColumns = getColumnNames(table)
  const finalRow = {}
  for (const c of allColumns) {
    finalRow[c] = row[c] ?? null
  }
  // 从 record 中提取 key 值
  const keyValue = record[key] ?? record[snakeToCamel(key)] ?? null
  finalRow[key] = keyValue

  const columns = Object.keys(finalRow)
  const values = Object.values(finalRow)
  const placeholders = columns.map(() => '?').join(', ')
  const updates = columns.filter(c => c !== key).map(c => `${c} = excluded.${c}`).join(', ')
  db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT(${key}) DO UPDATE SET ${updates}`)
    .run(...values)
}

// --- 复合操作（跨表事务，不可从 schema 自动推导） ---

function addBacklinks(db, records) {
  const stmt = db.prepare(`
    INSERT INTO backlinks (id, source_url, source_title, domain, page_ascore, status, analysis, added_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_url) DO NOTHING
  `)
  let count = 0
  for (const r of records) {
    const result = stmt.run(
      r.id,
      r.sourceUrl,
      r.sourceTitle ?? '',
      r.domain,
      r.pageAscore ?? null,
      r.status ?? 'pending',
      r.analysis ? JSON.stringify(r.analysis) : null,
      r.addedAt ?? new Date().toISOString(),
    )
    count += result.changes
  }
  return count
}

function updateBacklinkStatus(db, id, status, analysis = null) {
  if (analysis !== null) {
    db.prepare('UPDATE backlinks SET status = ?, analysis = ? WHERE id = ?')
      .run(status, JSON.stringify(analysis), id)
  } else {
    db.prepare('UPDATE backlinks SET status = ? WHERE id = ?')
      .run(status, id)
  }
}

function addPublishableSite(db, backlinkId, site) {
  const tx = db.transaction(() => {
    updateBacklinkStatus(db, backlinkId, 'publishable')
    insert(db, 'sites', site)
  })
  tx()
}

function addSubmissionWithExperience(db, submission, experience) {
  const domain = submission.siteName
  const tx = db.transaction(() => {
    insert(db, 'submissions', submission)
    upsertRow(db, 'site_experience', 'domain', { domain, ...experience })
  })
  tx()
}

function getStats(db) {
  return {
    products: db.prepare('SELECT COUNT(*) as count FROM products').get().count,
    backlinks: {
      total: db.prepare('SELECT COUNT(*) as count FROM backlinks').get().count,
      byStatus: Object.fromEntries(
        db.prepare("SELECT status, COUNT(*) as count FROM backlinks GROUP BY status").all()
          .map(r => [r.status, r.count])
      ),
    },
    sites: db.prepare('SELECT COUNT(*) as count FROM sites').get().count,
    submissions: {
      total: db.prepare('SELECT COUNT(*) as count FROM submissions').get().count,
      byStatus: Object.fromEntries(
        db.prepare("SELECT status, COUNT(*) as count FROM submissions GROUP BY status").all()
          .map(r => [r.status, r.count])
      ),
    },
    siteExperience: db.prepare('SELECT COUNT(*) as count FROM site_experience').get().count,
  }
}

// --- 操作工厂（兼容现有接口） ---

export function createOps(db) {
  return {
    // 产品
    addProduct: (p) => insert(db, 'products', p),
    getProduct: (id) => getById(db, 'products', id),
    listProducts: () => listAll(db, 'products'),

    // 外链
    addBacklinks: (r) => addBacklinks(db, r),
    getBacklinksByStatus: (s) => listAll(db, 'backlinks', { status: s }),
    updateBacklinkStatus: (id, s, a) => updateBacklinkStatus(db, id, s, a),

    // 站点
    addSite: (s) => insert(db, 'sites', s),
    getSiteByDomain: (d) => getBy(db, 'sites', 'domain', d),
    listSitesByProductId: (p) => listAll(db, 'sites', { productId: p }),

    // 提交记录
    addSubmission: (s) => insert(db, 'submissions', s),
    getSubmissionsByProduct: (p) => listAll(db, 'submissions', { productId: p }),

    // 站点经验
    upsertSiteExperience: (d, e) => upsertRow(db, 'site_experience', 'domain', { domain: d, ...e }),
    getSiteExperience: (d) => getBy(db, 'site_experience', 'domain', d),

    // 复合操作
    addPublishableSite: (id, s) => addPublishableSite(db, id, s),
    addSubmissionWithExperience: (s, e) => addSubmissionWithExperience(db, s, e),

    _db: db,
  }
}

export default createOps(db)

// --- CLI 入口 ---

const __filename = fileURLToPath(import.meta.url)

if (process.argv[1] === __filename) {
  const ops = createOps(db)
  const command = process.argv[2]
  const arg = process.argv[3]

  try {
    let result
    switch (command) {
      // 读取
      case 'products':
        result = ops.listProducts()
        break
      case 'product':
        result = ops.getProduct(arg)
        break
      case 'backlinks':
        result = ops.getBacklinksByStatus(arg || 'pending')
        break
      case 'site':
        result = ops.getSiteByDomain(arg)
        break
      case 'sites':
        result = arg
          ? ops.listSitesByProductId(arg)
          : db.prepare('SELECT * FROM sites ORDER BY added_at').all().map(r => toCamel('sites', r))
        break
      case 'submissions':
        result = ops.getSubmissionsByProduct(arg)
        break
      case 'experience':
        result = ops.getSiteExperience(arg)
        break
      case 'stats':
        result = getStats(db)
        break
      // 写入
      case 'add-product':
        result = ops.addProduct(JSON.parse(arg))
        break
      case 'update-backlink':
        ops.updateBacklinkStatus(arg, process.argv[4], process.argv[5] ? JSON.parse(process.argv[5]) : undefined)
        result = { ok: true }
        break
      case 'add-publishable':
        ops.addPublishableSite(arg, JSON.parse(process.argv[4]))
        result = { ok: true }
        break
      case 'add-submission':
        ops.addSubmissionWithExperience(JSON.parse(arg), JSON.parse(process.argv[4]))
        result = { ok: true }
        break
      case 'upsert-experience':
        ops.upsertSiteExperience(arg, JSON.parse(process.argv[4]))
        result = { ok: true }
        break
      default:
        console.error(`未知命令: ${command}`)
        console.error('用法: node db-ops.mjs <command> [args]')
        console.error('命令: products, product, backlinks, sites, site, submissions, experience, stats,')
        console.error('      add-product, update-backlink, add-publishable, add-submission, upsert-experience')
        process.exit(1)
    }
    console.log(JSON.stringify(result, null, 2))
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }))
    process.exit(1)
  } finally {
    db.close()
  }
}
```

- [ ] **Step 2: 运行测试确认通用 CRUD 引擎兼容现有接口**

```bash
cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent/.claude/skills/backlink-agent && npm test
```

Expected: 所有测试通过。通用 CRUD 引擎通过 `createOps()` 暴露的接口与旧版完全兼容。

- [ ] **Step 3: 提交**

```bash
cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent
git add .claude/skills/backlink-agent/scripts/data/db-ops.mjs
git commit -m "refactor(backlink-agent): db-ops.mjs 改为声明式 CRUD 引擎"
```

---

### Task 4: 更新 import-csv.mjs 的 import 路径

**Files:**
- Modify: `scripts/data/import-csv.mjs`

- [ ] **Step 1: 确认 import 路径无需修改**

`import-csv.mjs` 和 `db.mjs` 现在都在 `scripts/data/` 目录下，`import db from './db.mjs'` 路径不变。无需修改。

- [ ] **Step 2: 验证 import-csv.mjs 可正常执行**

```bash
cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent/.claude/skills/backlink-agent
node scripts/data/import-csv.mjs 2>&1 | head -1
```

Expected: 输出用法提示 `用法: node import-csv.mjs <csv-file-path>`（因为没有传参数）。

---

### Task 5: 更新 db.test.mjs

**Files:**
- Modify: `scripts/data/db.test.mjs`

- [ ] **Step 1: 更新测试文件，适配新的 schema 导出**

当前测试的 import 已经正确（`./db.mjs` 和 `./db-ops.mjs` 在同目录）。需要做的是确认测试通过，不需要修改测试代码。

```bash
cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent/.claude/skills/backlink-agent && npm test
```

Expected: 所有现有测试通过。新 db.mjs 和 db-ops.mjs 的接口与旧版完全兼容。

- [ ] **Step 2: 提交（如有修改则提交）**

如果测试文件无需修改，跳过此步。

---

### Task 6: 重写 SKILL.md + 创建 tool-guide.md

**Files:**
- Rewrite: `SKILL.md`
- Create: `references/tool-guide.md`

- [ ] **Step 1: 重写 SKILL.md**

完整替换 `SKILL.md` 内容为设计文档中第 1 节的模板。路径使用新的三层结构路径：

```markdown
---
name: backlink-agent
description: 外链分析与入库 Agent。通过 CDP 操控浏览器，完成外链候选导入、可发布性判断和站点入库。
metadata:
  version: "3.0.0"
---

# Backlink Agent — 外链建设决策引擎

## 角色
你是外链建设决策引擎。通过 CDP 操控浏览器，完成产品管理、外链导入、可发布性分析和表单提交。

## 触发条件
- 用户要求分析外链、导入 Semrush 数据、批量检查页面可发布性
- 用户要求管理外链候选站点或提交产品

## 前置检查
根据操作类型按需检查环境：

| 操作 | 检查项 |
|------|--------|
| IMPORT | 仅 Node.js |
| PRODUCT / ANALYZE / SUBMIT | Node.js + Chrome + CDP Proxy |

需要浏览器时执行：
```bash
cd "${SKILL_DIR}" && npm install
node "${SKILL_DIR}/scripts/browser/check-deps.mjs"
```

未通过时的引导：

| 检查项 | 处理方式 |
|--------|---------|
| Node.js 版本过低 | 提示升级到 22+ |
| Chrome 未开启远程调试 | 引导打开 `chrome://inspect/#remote-debugging`，勾选 "Allow remote debugging" |
| CDP Proxy 连接超时 | 检查 Chrome 授权弹窗；查看日志 `$(getconf DARWIN_USER_TEMP_DIR)/cdp-proxy.log`（macOS）或 `/tmp/cdp-proxy.log`（Linux） |

通过后提示：
> 环境就绪。CDP Proxy 运行在 `http://localhost:3457`。
> 所有浏览器操作将在后台 tab 中执行，不会干扰你当前的工作。
> 数据存储在 SQLite 数据库 `${SKILL_DIR}/data/backlink.db`。

## 操作路由
执行对应操作时，**只加载对应的 reference 文件**：

| 操作 | 触发 | 参考 | 环境依赖 |
|------|------|------|---------|
| PRODUCT | 用户提供产品 URL | `workflow-product.md` | Chrome + CDP |
| IMPORT | 用户提供 CSV/URL 列表 | `workflow-import.md` | Node.js |
| ANALYZE | 用户要求批量分析 | `workflow-analyze.md` | Chrome + CDP |
| SUBMIT | 用户要求提交到站点 | `workflow-submit.md` | Chrome + CDP |

## 数据访问
所有数据通过 `db-ops.mjs` CLI 访问，不直接操作数据库文件。

```bash
# 读取
node "${SKILL_DIR}/scripts/data/db-ops.mjs products
node "${SKILL_DIR}/scripts/data/db-ops.mjs product <id>
node "${SKILL_DIR}/scripts/data/db-ops.mjs backlinks [status]
node "${SKILL_DIR}/scripts/data/db-ops.mjs sites [productId]
node "${SKILL_DIR}/scripts/data/db-ops.mjs site <domain>
node "${SKILL_DIR}/scripts/data/db-ops.mjs submissions <productId>
node "${SKILL_DIR}/scripts/data/db-ops.mjs experience <domain>
node "${SKILL_DIR}/scripts/data/db-ops.mjs stats

# 写入
node "${SKILL_DIR}/scripts/data/db-ops.mjs add-product '<json>'
node "${SKILL_DIR}/scripts/data/db-ops.mjs update-backlink <id> <status> [analysisJSON]
node "${SKILL_DIR}/scripts/data/db-ops.mjs add-publishable <id> '<siteJSON>'
node "${SKILL_DIR}/scripts/data/db-ops.mjs add-submission '<submissionJSON>' '<experienceJSON>'
node "${SKILL_DIR}/scripts/data/db-ops.mjs upsert-experience <domain> '<experienceJSON>'
```

完整数据格式见 `data-formats.md`。

## 行为准则

### 禁止设限
唯一跳过理由：付费墙、站已死（域名过期/404/无响应）、CF 硬封。其他"看起来难"都不是跳过理由。

### 前端不行先逆向
正常表单提交失败时：先查页面源码找隐藏 API → 检查网络请求分析提交逻辑 → 尝试直接调用后端 API。

### 去重按域名
同一域名下的不同页面视为同一个站点。去重以域名为单位。

### 查邮件必须开新标签页
查找联系邮箱时：必须用 `/new` 创建新 tab，在新 tab 中搜索，查找完毕后 `/close`。禁止在分析页面中跳转。

### rel 属性每次实测
外链的 `rel` 属性必须实际发布后检查，不依赖页面声明或他人报告。

### 先读知识库再操作
执行任何操作前，先通过 `db-ops.mjs` 查询相关数据，了解当前状态。

### 切站必须确认产品
切换到不同目标站点时，必须确认当前活跃产品。

### 邮箱失败立刻切换
自定义域名邮箱注册/提交失败时，立即切换到 Gmail 重试。

### 验证码协作先填完所有字段
遇到验证码时：先自动填写所有其他字段，最后再处理验证码。

## 错误处理
| 场景 | 处理方式 |
|------|---------|
| CDP Proxy 未启动 | 运行 `check-deps.mjs`，自动启动 Proxy |
| Chrome 未开启远程调试 | 提示用户启用远程调试 |
| 页面加载超时（>30s） | 标记 `error`，跳过继续 |
| CDP 连接断开 | Proxy 内置重连，持续失败则暂停提示 |
| 数据库操作失败 | 提示用户，检查数据库文件是否损坏 |
| 批量分析中途失败 | 已分析已写回，未分析的保持 `pending` |
| `/eval` 返回 JS 错误 | 检查 CSP 阻止，降级检测；标记 `error` 继续 |

## 任务结束
1. 关闭本次任务中创建的所有后台 tab（通过记录的 targetId 逐一 `/close`）
2. 不关闭用户原有的 tab
3. CDP Proxy 保持运行
4. 确认数据已正确写入数据库

## References 索引
| 文件 | 何时加载 |
|------|---------|
| `references/workflow-product.md` | 执行 PRODUCT 操作时 |
| `references/workflow-import.md` | 执行 IMPORT 操作时 |
| `references/workflow-analyze.md` | 执行 ANALYZE 操作时 |
| `references/workflow-submit.md` | 执行 SUBMIT 操作时 |
| `references/cdp-proxy-api.md` | 需要 CDP API 详细参考时 |
| `references/data-formats.md` | 操作数据前 |
| `references/publishability-rules.md` | 分析阶段，判断可发布性 |
| `references/tool-guide.md` | 选择工具时 |
```

- [ ] **Step 2: 创建 references/tool-guide.md**

从旧 SKILL.md 提取的工具选择决策矩阵，作为独立参考文件：

```markdown
# 工具选择指南

> 文件路径：`${SKILL_DIR}/references/tool-guide.md`

---

## 工具选择决策矩阵

根据场景选择最合适的工具，不要默认只用一种：

| 场景 | 工具 | 说明 |
|------|------|------|
| 需要页面上下文交互 | **CDP /eval** | 表单检测、DOM 查询、元素操控 |
| 需要提取页面正文供分析 | **page-extractor.mjs** | 提取纯文本 + 评论信号 |
| 需要兼容 React/Vue 填表 | **form-filler.js** | 原生 setter + _valueTracker + execCommand |
| 需要辅助信息（产品页面、元数据） | **curl / Jina** | 快速获取，无需 CDP |
| 需要从产品页面提取信息 | **product-generator.mjs** | 提取 meta、标题、正文，自动生成产品记录 |

## 脚本路径速查

| 脚本 | 路径 | 类型 |
|------|------|------|
| db-ops.mjs | `${SKILL_DIR}/scripts/data/db-ops.mjs` | CLI 工具 |
| import-csv.mjs | `${SKILL_DIR}/scripts/data/import-csv.mjs` | CLI 工具 |
| cdp-proxy.mjs | `${SKILL_DIR}/scripts/browser/cdp-proxy.mjs` | 服务 |
| check-deps.mjs | `${SKILL_DIR}/scripts/browser/check-deps.mjs` | CLI 工具 |
| page-extractor.mjs | `${SKILL_DIR}/scripts/browser/page-extractor.mjs` | CLI 工具 |
| product-generator.mjs | `${SKILL_DIR}/scripts/browser/product-generator.mjs` | CLI 工具 |
| form-analyzer.js | `${SKILL_DIR}/scripts/injection/form-analyzer.js` | 注入脚本 |
| form-filler.js | `${SKILL_DIR}/scripts/injection/form-filler.js` | 注入脚本 |
| detect-comment-form.js | `${SKILL_DIR}/scripts/injection/detect-comment-form.js` | 注入脚本 |
| detect-antispam.js | `${SKILL_DIR}/scripts/injection/detect-antispam.js` | 注入脚本 |
| honeypot-detector.js | `${SKILL_DIR}/scripts/injection/honeypot-detector.js` | 注入脚本 |
| comment-expander.js | `${SKILL_DIR}/scripts/injection/comment-expander.js` | 注入脚本 |
```

- [ ] **Step 3: 提交**

```bash
cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent
git add .claude/skills/backlink-agent/SKILL.md .claude/skills/backlink-agent/references/tool-guide.md
git commit -m "refactor(backlink-agent): SKILL.md 瘦身为极简入口，提取 tool-guide.md"
```

---

### Task 7: 更新 workflow-product.md

**Files:**
- Modify: `references/workflow-product.md`

- [ ] **Step 1: 修复过时引用 + 更新路径**

主要修改点：
1. Step 1 中 `check-deps.mjs` 路径改为 `scripts/browser/check-deps.mjs`
2. Step 2 中 `product-generator.mjs` 路径改为 `scripts/browser/product-generator.mjs`
3. Step 4 从"读取 products.json + Write 工具写回"改为通过 db-ops.mjs CLI 写入
4. Step 5 中的 ID 格式改为通过 db-ops.mjs 查询最大 ID

将 `references/workflow-product.md` 中所有 `${SKILL_DIR}/scripts/` 路径替换为新的分层路径。关键修改：

**Step 1 环境检查**：`node "${SKILL_DIR}/scripts/check-deps.mjs"` → `node "${SKILL_DIR}/scripts/browser/check-deps.mjs"`

**Step 2 提取页面信息**：`node "${SKILL_DIR}/scripts/product-generator.mjs"` → `node "${SKILL_DIR}/scripts/browser/product-generator.mjs"`

**Step 4 写入数据**：将整个"读取 products.json → 追加 → Write 工具写回"替换为：

```bash
node "${SKILL_DIR}/scripts/data/db-ops.mjs add-product '<productJSON>'
```

其中 `<productJSON>` 包含 Step 3 生成的所有字段。

**Step 5 汇报结果**：将"可选字段未填充"改为提示用户可通过 `add-product` 后再 `update` 补充。

- [ ] **Step 2: 提交**

```bash
cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent
git add .claude/skills/backlink-agent/references/workflow-product.md
git commit -m "fix(backlink-agent): 修复 workflow-product.md 过时引用，更新路径为三层结构"
```

---

### Task 8: 更新 workflow-analyze.md

**Files:**
- Modify: `references/workflow-analyze.md`

- [ ] **Step 1: 并入并行分析策略 + 更新路径**

从旧 SKILL.md 移入"并行分析策略"的全部内容（设计文档 4.2 节），包括：
- 设计原则（主 agent 是调度器、Subagent 自给自足、返回最小摘要）
- 调度循环图
- Subagent prompt 模板
- 主 Agent 职责
- 并行控制规则

同时更新所有脚本路径：
- `${SKILL_DIR}/scripts/db-ops.mjs` → `${SKILL_DIR}/scripts/data/db-ops.mjs`
- `${SKILL_DIR}/scripts/page-extractor.mjs` → `${SKILL_DIR}/scripts/browser/page-extractor.mjs`
- `${SKILL_DIR}/scripts/detect-comment-form.js` → `${SKILL_DIR}/scripts/injection/detect-comment-form.js`
- `${SKILL_DIR}/scripts/detect-antispam.js` → `${SKILL_DIR}/scripts/injection/detect-antispam.js`

优化决策树为合并版本：

```
检测结果
  ├─ bypassable=false 的反垃圾 → not_publishable
  ├─ bypassable=depends_on_config → not_publishable（保守）
  ├─ 无评论表单信号 → not_publishable
  ├─ 原生评论 + textarea + 无硬封 → publishable
  └─ 模糊信号 → Claude 综合判定（加载 publishability-rules.md）
```

- [ ] **Step 2: 提交**

```bash
cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent
git add .claude/skills/backlink-agent/references/workflow-analyze.md
git commit -m "refactor(backlink-agent): workflow-analyze.md 并入并行策略，更新路径"
```

---

### Task 9: 更新 workflow-submit.md

**Files:**
- Modify: `references/workflow-submit.md`

- [ ] **Step 1: 并入串行提交策略 + 站点经验系统 + 更新路径**

从旧 SKILL.md 移入：
- 串行提交策略（设计原则、调度循环图、Subagent prompt 模板、主 Agent 职责、上下文控制）
- 站点经验系统详细流程

同时更新所有脚本路径，与 Task 8 相同的替换规则。额外：
- `${SKILL_DIR}/scripts/form-analyzer.js` → `${SKILL_DIR}/scripts/injection/form-analyzer.js`
- `${SKILL_DIR}/scripts/form-filler.js` → `${SKILL_DIR}/scripts/injection/form-filler.js`
- `${SKILL_DIR}/scripts/honeypot-detector.js` → `${SKILL_DIR}/scripts/injection/honeypot-detector.js`
- `${SKILL_DIR}/scripts/comment-expander.js` → `${SKILL_DIR}/scripts/injection/comment-expander.js`

- [ ] **Step 2: 提交**

```bash
cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent
git add .claude/skills/backlink-agent/references/workflow-submit.md
git commit -m "refactor(backlink-agent): workflow-submit.md 并入串行策略和站点经验系统"
```

---

### Task 10: 更新 data-formats.md 和 workflow-import.md

**Files:**
- Modify: `references/data-formats.md`
- Modify: `references/workflow-import.md`

- [ ] **Step 1: 更新 data-formats.md 中的路径**

将所有 `${SKILL_DIR}/scripts/db-ops.mjs` 替换为 `${SKILL_DIR}/scripts/data/db-ops.mjs`。

- [ ] **Step 2: 更新 workflow-import.md 中的路径**

将 `${SKILL_DIR}/scripts/import-csv.mjs` 替换为 `${SKILL_DIR}/scripts/data/import-csv.mjs`。
将 `${SKILL_DIR}/scripts/db-ops.mjs` 替换为 `${SKILL_DIR}/scripts/data/db-ops.mjs`。

- [ ] **Step 3: 提交**

```bash
cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent
git add .claude/skills/backlink-agent/references/data-formats.md .claude/skills/backlink-agent/references/workflow-import.md
git commit -m "fix(backlink-agent): 更新 data-formats.md 和 workflow-import.md 中的路径引用"
```

---

### Task 11: 最终验证

- [ ] **Step 1: 运行测试**

```bash
cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent/.claude/skills/backlink-agent && npm test
```

Expected: 所有测试通过。

- [ ] **Step 2: 运行 build 确认数据库可正常初始化**

```bash
cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent/.claude/skills/backlink-agent && npm run build
```

Expected: 无报错（build 命令执行 `node scripts/data/db.mjs`，初始化数据库）。

- [ ] **Step 3: 验证 CLI 工具可用**

```bash
cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent/.claude/skills/backlink-agent
node scripts/data/db-ops.mjs stats
```

Expected: 输出 JSON 统计数据。

- [ ] **Step 4: 删除设计文档中的 IMPLEMENTATION_PLAN 引用（如有）**

确认无遗留的设计文档引用需要清理。

- [ ] **Step 5: 最终提交（如有未提交的改动）**

```bash
cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent
git status
# 如果有未提交的改动，提交它们
```
