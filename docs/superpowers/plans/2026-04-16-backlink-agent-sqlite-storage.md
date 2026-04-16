# Backlink Agent SQLite 存储层升级 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 backlink-agent 的数据存储从 JSON 文件迁移到 SQLite (better-sqlite3)，提升数据可靠性、查询性能和并发安全。

**Architecture:** 在 `.claude/skills/backlink-agent/` 下新增 `package.json`、`scripts/db.mjs`（数据库初始化）、`scripts/db-ops.mjs`（CRUD + CLI），改造 `import-csv.mjs` 直接写 SQLite。更新 skill 定义和 workflow 文档，将数据操作指令从"Read/Write JSON"改为"node scripts 调用"。最后删除旧的 JSON 数据文件。

**Tech Stack:** Node.js 22+ (ESM), better-sqlite3, node:test (内置测试框架)

---

## 文件结构

```
.claude/skills/backlink-agent/
├── package.json               -- 新建: better-sqlite3 依赖
├── scripts/
│   ├── db.mjs                 -- 新建: 数据库初始化 + schema
│   ├── db-ops.mjs             -- 新建: CRUD 函数 + CLI 入口
│   ├── db.test.mjs            -- 新建: 所有操作的测试
│   └── import-csv.mjs         -- 修改: 改为写 SQLite
├── data/
│   ├── backlink.db            -- 新建: SQLite 数据库文件（运行时生成）
│   ├── products.json          -- 删除
│   ├── backlinks.json         -- 删除
│   ├── sites.json             -- 删除
│   ├── submissions.json       -- 删除
│   └── site-experience.json   -- 删除
├── SKILL.md                   -- 修改: 更新数据操作指令
└── references/
    ├── data-formats.md        -- 修改: 更新为 SQLite 说明
    ├── workflow-import.md     -- 修改: 更新导入流程
    ├── workflow-analyze.md    -- 修改: 更新分析流程
    └── workflow-submit.md     -- 修改: 更新提交流程
```

### 命名约定

JSON 使用 camelCase，SQL 使用 snake_case。`db-ops.mjs` 负责双向转换：

```js
const camelToSnake = s => s.replace(/[A-Z]/g, c => '_' + c.toLowerCase())
const snakeToCamel = s => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
```

---

## Task 1: 项目初始化

**Files:**
- Create: `.claude/skills/backlink-agent/package.json`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "backlink-agent-data",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test scripts/db.test.mjs",
    "build": "node scripts/db.mjs"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0"
  }
}
```

- [ ] **Step 2: 安装依赖**

Run: `cd .claude/skills/backlink-agent && npm install`
Expected: `node_modules/` 和 `package-lock.json` 生成，无报错

- [ ] **Step 3: 验证安装**

Run: `cd .claude/skills/backlink-agent && node -e "import Database from 'better-sqlite3'; const db = new Database(':memory:'); console.log('ok:', db.open); db.close()"`
Expected: `ok: true`

- [ ] **Step 4: 提交**

```bash
cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent
git add .claude/skills/backlink-agent/package.json .claude/skills/backlink-agent/package-lock.json
git commit -m "chore(backlink-agent): 添加 package.json 和 better-sqlite3 依赖"
```

---

## Task 2: 数据库初始化模块

**Files:**
- Create: `.claude/skills/backlink-agent/scripts/db.mjs`
- Create: `.claude/skills/backlink-agent/scripts/db.test.mjs`（初始框架）

- [ ] **Step 1: 编写数据库初始化失败的测试**

在 `scripts/db.test.mjs` 中：

```js
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { createDb } from './db.mjs'

describe('db.mjs', () => {
  it('应创建所有 5 张表', () => {
    const db = createDb(':memory:')
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all().map(r => r.name)
    assert.deepStrictEqual(tables, [
      'backlinks', 'products', 'site_experience', 'sites', 'submissions'
    ])
    db.close()
  })

  it('应创建必要的索引', () => {
    const db = createDb(':memory:')
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name"
    ).all().map(r => r.name)
    assert.ok(indexes.length >= 8, `应有至少 8 个索引，实际 ${indexes.length}: ${indexes.join(', ')}`)
    assert.ok(indexes.includes('idx_backlinks_status'))
    assert.ok(indexes.includes('idx_backlinks_domain'))
    assert.ok(indexes.includes('idx_backlinks_source_url'))
    assert.ok(indexes.includes('idx_sites_domain'))
    assert.ok(indexes.includes('idx_sites_product_id'))
    assert.ok(indexes.includes('idx_submissions_product_id'))
    assert.ok(indexes.includes('idx_submissions_status'))
    db.close()
  })

  it('应启用 WAL 模式', () => {
    const db = createDb(':memory:')
    // 内存数据库无法启用 WAL，只验证函数不报错
    assert.ok(db.open)
    db.close()
  })

  it('应启用外键约束', () => {
    const db = createDb(':memory:')
    const [{ foreign_keys }] = db.pragma('foreign_keys')
    assert.strictEqual(foreign_keys, 1)
    db.close()
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd .claude/skills/backlink-agent && node --test scripts/db.test.mjs`
Expected: FAIL — `createDb` 不存在

- [ ] **Step 3: 实现 db.mjs**

在 `scripts/db.mjs` 中：

```js
import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS products (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  url          TEXT NOT NULL,
  tagline      TEXT NOT NULL DEFAULT '',
  short_desc   TEXT NOT NULL DEFAULT '',
  long_desc    TEXT NOT NULL DEFAULT '',
  categories   TEXT NOT NULL DEFAULT '[]',
  anchor_texts TEXT NOT NULL DEFAULT '[]',
  logo_url     TEXT NOT NULL DEFAULT '',
  social_links TEXT NOT NULL DEFAULT '{}',
  founder_name  TEXT NOT NULL DEFAULT '',
  founder_email TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS backlinks (
  id           TEXT PRIMARY KEY,
  source_url   TEXT NOT NULL,
  source_title TEXT NOT NULL DEFAULT '',
  domain       TEXT NOT NULL,
  page_ascore  INTEGER,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK(status IN ('pending','publishable','not_publishable','skipped','error')),
  analysis     TEXT,
  added_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_backlinks_status ON backlinks(status);
CREATE INDEX IF NOT EXISTS idx_backlinks_domain ON backlinks(domain);
CREATE UNIQUE INDEX IF NOT EXISTS idx_backlinks_source_url ON backlinks(source_url);

CREATE TABLE IF NOT EXISTS sites (
  id              TEXT PRIMARY KEY,
  domain          TEXT NOT NULL,
  url             TEXT NOT NULL,
  submit_url      TEXT NOT NULL DEFAULT '',
  category        TEXT NOT NULL DEFAULT '',
  comment_system  TEXT NOT NULL DEFAULT '',
  antispam        TEXT NOT NULL DEFAULT '[]',
  rel_attribute   TEXT NOT NULL DEFAULT '',
  product_id      TEXT NOT NULL DEFAULT '',
  pricing         TEXT NOT NULL DEFAULT 'free',
  monthly_traffic TEXT NOT NULL DEFAULT '',
  lang            TEXT NOT NULL DEFAULT 'en',
  dr              INTEGER,
  notes           TEXT NOT NULL DEFAULT '',
  added_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_sites_domain ON sites(domain);
CREATE INDEX IF NOT EXISTS idx_sites_product_id ON sites(product_id);

CREATE TABLE IF NOT EXISTS submissions (
  id           TEXT PRIMARY KEY,
  site_name    TEXT NOT NULL,
  site_url     TEXT NOT NULL,
  product_id   TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'submitted'
               CHECK(status IN ('submitted','failed','skipped')),
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  result       TEXT NOT NULL DEFAULT '',
  fields       TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_submissions_product_id ON submissions(product_id);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);

CREATE TABLE IF NOT EXISTS site_experience (
  domain               TEXT PRIMARY KEY,
  aliases              TEXT NOT NULL DEFAULT '[]',
  updated              TEXT NOT NULL DEFAULT (datetime('now')),
  submit_type          TEXT NOT NULL DEFAULT '',
  form_framework       TEXT NOT NULL DEFAULT '',
  antispam             TEXT NOT NULL DEFAULT '',
  fill_strategy        TEXT NOT NULL DEFAULT '',
  post_submit_behavior TEXT NOT NULL DEFAULT '',
  effective_patterns   TEXT NOT NULL DEFAULT '[]',
  known_traps          TEXT NOT NULL DEFAULT '[]'
);
`

/**
 * 创建并初始化数据库连接
 * @param {string} dbPath - 数据库文件路径，或 ':memory:' 用于测试
 * @returns {import('better-sqlite3').Database}
 */
export function createDb(dbPath) {
  const db = new Database(dbPath)
  if (dbPath !== ':memory:') {
    db.pragma('journal_mode = WAL')
  }
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA_SQL)
  return db
}

// 默认导出：生产环境数据库（单例）
const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = resolve(__dirname, '../data/backlink.db')
export default createDb(DB_PATH)
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd .claude/skills/backlink-agent && node --test scripts/db.test.mjs`
Expected: 4 tests PASS

- [ ] **Step 5: 运行 `npm run build`，验证生产数据库文件生成**

Run: `cd .claude/skills/backlink-agent && npm run build`
Expected: `data/backlink.db` 文件生成，无报错

- [ ] **Step 6: 提交**

```bash
cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent
git add .claude/skills/backlink-agent/scripts/db.mjs .claude/skills/backlink-agent/scripts/db.test.mjs .claude/skills/backlink-agent/data/backlink.db
git commit -m "feat(backlink-agent): 添加 SQLite 数据库初始化模块和 schema"
```

---

## Task 3: 产品 CRUD 操作

**Files:**
- Create: `.claude/skills/backlink-agent/scripts/db-ops.mjs`
- Modify: `.claude/skills/backlink-agent/scripts/db.test.mjs`

- [ ] **Step 1: 在 db.test.mjs 末尾追加产品操作测试**

```js
describe('产品操作', () => {
  let db
  let ops

  beforeEach(() => {
    db = createDb(':memory:')
    ops = createOps(db)
  })

  afterEach(() => { db.close() })

  it('addProduct 应插入产品并返回 camelCase 字段', () => {
    const product = ops.addProduct({
      id: 'prod-001',
      name: 'ExcelCompare',
      url: 'https://excelcompare.org/',
      tagline: 'Compare Excel files',
      categories: ['Productivity'],
      anchorTexts: ['ExcelCompare'],
    })
    assert.strictEqual(product.id, 'prod-001')
    assert.strictEqual(product.name, 'ExcelCompare')
    assert.deepStrictEqual(product.categories, ['Productivity'])
    assert.ok(product.createdAt)
  })

  it('getProduct 应通过 id 查询产品', () => {
    ops.addProduct({ id: 'prod-001', name: 'Test', url: 'https://test.com' })
    const found = ops.getProduct('prod-001')
    assert.strictEqual(found.name, 'Test')
    assert.strictEqual(found.url, 'https://test.com')
  })

  it('getProduct 在 id 不存在时应返回 null', () => {
    assert.strictEqual(ops.getProduct('nonexistent'), null)
  })

  it('listProducts 应返回所有产品', () => {
    ops.addProduct({ id: 'prod-001', name: 'A', url: 'https://a.com' })
    ops.addProduct({ id: 'prod-002', name: 'B', url: 'https://b.com' })
    const list = ops.listProducts()
    assert.strictEqual(list.length, 2)
  })

  it('addProduct 重复 name 应抛出错误', () => {
    ops.addProduct({ id: 'prod-001', name: 'Same', url: 'https://a.com' })
    assert.throws(() => {
      ops.addProduct({ id: 'prod-002', name: 'Same', url: 'https://b.com' })
    })
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd .claude/skills/backlink-agent && node --test scripts/db.test.mjs`
Expected: FAIL — `createOps` 不存在

- [ ] **Step 3: 创建 db-ops.mjs 基础框架 + 产品操作**

在 `scripts/db-ops.mjs` 中：

```js
import db from './db.mjs'

// --- 字段映射工具 ---

const camelToSnake = s => s.replace(/[A-Z]/g, c => '_' + c.toLowerCase())
const snakeToCamel = s => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase())

/** 将 camelCase 对象转为 snake_case */
function toRow(obj) {
  const row = {}
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v) || (v && typeof v === 'object' && !(v instanceof Date))) {
      row[camelToSnake(k)] = JSON.stringify(v)
    } else {
      row[camelToSnake(k)] = v
    }
  }
  return row
}

/** 将 snake_case 数据库行转为 camelCase */
function toCamel(row) {
  if (!row) return null
  const obj = {}
  for (const [k, v] of Object.entries(row)) {
    const camelKey = snakeToCamel(k)
    // 尝试解析 JSON 字段
    if (typeof v === 'string' && (v.startsWith('[') || v.startsWith('{'))) {
      try { obj[camelKey] = JSON.parse(v); continue } catch { /* 不是 JSON，原样返回 */ }
    }
    obj[camelKey] = v
  }
  return obj
}

// --- 产品操作 ---

const PRODUCT_COLUMNS = [
  'id', 'name', 'url', 'tagline', 'short_desc', 'long_desc',
  'categories', 'anchor_texts', 'logo_url', 'social_links',
  'founder_name', 'founder_email', 'created_at'
]

const insertProduct = /* @__PURE__ */ (() => {
  const cols = PRODUCT_COLUMNS.join(', ')
  const placeholders = PRODUCT_COLUMNS.map(() => '?').join(', ')
  return (db, product) => {
    const row = toRow(product)
    const values = PRODUCT_COLUMNS.map(c => row[c] ?? (c.endsWith('_desc') || c.endsWith('_text') || c.endsWith('_links') || c.endsWith('_texts') || c.endsWith('_name') || c.endsWith('_email') || c.endsWith('_url') ? '' : c === 'categories' || c === 'anchor_texts' ? '[]' : c === 'social_links' ? '{}' : null))
    db.prepare(`INSERT INTO products (${cols}) VALUES (${placeholders})`).run(...values)
    return toCamel(db.prepare('SELECT * FROM products WHERE id = ?').get(product.id))
  }
})()

// --- CRUD 操作工厂 ---

export function createOps(db) {
  return {
    // === 产品 ===
    addProduct(product) {
      return insertProduct(db, product)
    },

    getProduct(id) {
      return toCamel(db.prepare('SELECT * FROM products WHERE id = ?').get(id))
    },

    listProducts() {
      return db.prepare('SELECT * FROM products ORDER BY created_at').all().map(toCamel)
    },

    // === 外链候选 ===
    // (Task 4 实现)

    // === 站点 ===
    // (Task 5 实现)

    // === 提交记录 ===
    // (Task 6 实现)

    // === 站点经验 ===
    // (Task 6 实现)

    // === 事务操作 ===
    // (Task 7 实现)

    // 内部访问
    _db: db,
  }
}

// 默认操作实例（生产环境）
export default createOps(db)
```

- [ ] **Step 4: 在 db.test.mjs 顶部添加 import**

在文件顶部的 import 区域添加：

```js
import { createOps } from './db-ops.mjs'
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `cd .claude/skills/backlink-agent && node --test scripts/db.test.mjs`
Expected: 所有产品测试 PASS，db.mjs 测试也 PASS

- [ ] **Step 6: 提交**

```bash
cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent
git add .claude/skills/backlink-agent/scripts/db-ops.mjs .claude/skills/backlink-agent/scripts/db.test.mjs
git commit -m "feat(backlink-agent): 添加产品 CRUD 操作和测试"
```

---

## Task 4: 外链候选 CRUD 操作

**Files:**
- Modify: `.claude/skills/backlink-agent/scripts/db-ops.mjs`
- Modify: `.claude/skills/backlink-agent/scripts/db.test.mjs`

- [ ] **Step 1: 在 db.test.mjs 末尾追加外链候选测试**

```js
describe('外链候选操作', () => {
  let db, ops

  beforeEach(() => {
    db = createDb(':memory:')
    ops = createOps(db)
  })
  afterEach(() => { db.close() })

  it('addBacklinks 应批量插入并返回插入数量', () => {
    const count = ops.addBacklinks([
      { id: 'bl-1', sourceUrl: 'https://a.com/p1', domain: 'a.com', pageAscore: 50 },
      { id: 'bl-2', sourceUrl: 'https://b.com/p2', domain: 'b.com', pageAscore: 30 },
    ])
    assert.strictEqual(count, 2)
  })

  it('addBacklinks 应跳过重复的 sourceUrl', () => {
    ops.addBacklinks([
      { id: 'bl-1', sourceUrl: 'https://a.com/p1', domain: 'a.com' },
    ])
    const count = ops.addBacklinks([
      { id: 'bl-2', sourceUrl: 'https://a.com/p1', domain: 'a.com' },
      { id: 'bl-3', sourceUrl: 'https://b.com/p2', domain: 'b.com' },
    ])
    assert.strictEqual(count, 1) // 第二条插入，第一条跳过
  })

  it('getBacklinksByStatus 应按状态过滤', () => {
    ops.addBacklinks([
      { id: 'bl-1', sourceUrl: 'https://a.com', domain: 'a.com', status: 'pending' },
      { id: 'bl-2', sourceUrl: 'https://b.com', domain: 'b.com', status: 'publishable' },
    ])
    const pending = ops.getBacklinksByStatus('pending')
    assert.strictEqual(pending.length, 1)
    assert.strictEqual(pending[0].id, 'bl-1')
  })

  it('updateBacklinkStatus 应更新状态和分析结果', () => {
    ops.addBacklinks([
      { id: 'bl-1', sourceUrl: 'https://a.com', domain: 'a.com' },
    ])
    ops.updateBacklinkStatus('bl-1', 'publishable', { score: 80 })
    const updated = ops.getBacklinksByStatus('publishable')
    assert.strictEqual(updated.length, 1)
    assert.deepStrictEqual(updated[0].analysis, { score: 80 })
  })

  it('无效 status 应被 CHECK 约束拒绝', () => {
    assert.throws(() => {
      ops.addBacklinks([
        { id: 'bl-1', sourceUrl: 'https://a.com', domain: 'a.com', status: 'invalid' },
      ])
    })
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd .claude/skills/backlink-agent && node --test scripts/db.test.mjs`
Expected: FAIL — backlink 方法不存在

- [ ] **Step 3: 在 db-ops.mjs 的 createOps 中实现外链候选操作**

替换 `createOps` 中的 `// === 外链候选 ===` 注释块为：

```js
    // === 外链候选 ===
    addBacklinks(records) {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO backlinks (id, source_url, source_title, domain, page_ascore, status, analysis, added_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      let count = 0
      for (const r of records) {
        const row = toRow(r)
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
    },

    getBacklinksByStatus(status) {
      return db.prepare('SELECT * FROM backlinks WHERE status = ? ORDER BY added_at')
        .all(status).map(toCamel)
    },

    updateBacklinkStatus(id, status, analysis = null) {
      if (analysis !== null) {
        db.prepare('UPDATE backlinks SET status = ?, analysis = ? WHERE id = ?')
          .run(status, JSON.stringify(analysis), id)
      } else {
        db.prepare('UPDATE backlinks SET status = ? WHERE id = ?')
          .run(status, id)
      }
    },
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd .claude/skills/backlink-agent && node --test scripts/db.test.mjs`
Expected: 外链候选测试全部 PASS

- [ ] **Step 5: 提交**

```bash
cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent
git add .claude/skills/backlink-agent/scripts/db-ops.mjs .claude/skills/backlink-agent/scripts/db.test.mjs
git commit -m "feat(backlink-agent): 添加外链候选 CRUD 操作和测试"
```

---

## Task 5: 站点 CRUD 操作

**Files:**
- Modify: `.claude/skills/backlink-agent/scripts/db-ops.mjs`
- Modify: `.claude/skills/backlink-agent/scripts/db.test.mjs`

- [ ] **Step 1: 在 db.test.mjs 末尾追加站点测试**

```js
describe('站点操作', () => {
  let db, ops

  beforeEach(() => {
    db = createDb(':memory:')
    ops = createOps(db)
    ops.addProduct({ id: 'prod-001', name: 'Test', url: 'https://test.com' })
  })
  afterEach(() => { db.close() })

  it('addSite 应插入站点', () => {
    const site = ops.addSite({
      id: 'site-001', domain: 'example.com', url: 'https://example.com/submit',
      productId: 'prod-001', dr: 50,
    })
    assert.strictEqual(site.domain, 'example.com')
    assert.strictEqual(site.productId, 'prod-001')
    assert.strictEqual(site.dr, 50)
  })

  it('getSiteByDomain 应通过域名精确查找', () => {
    ops.addSite({ id: 'site-001', domain: 'example.com', url: 'https://example.com', productId: 'prod-001' })
    const found = ops.getSiteByDomain('example.com')
    assert.strictEqual(found.id, 'site-001')
  })

  it('getSiteByDomain 在域名不存在时应返回 null', () => {
    assert.strictEqual(ops.getSiteByDomain('nope.com'), null)
  })

  it('listSitesByProductId 应按产品过滤', () => {
    ops.addSite({ id: 'site-001', domain: 'a.com', url: 'https://a.com', productId: 'prod-001' })
    ops.addSite({ id: 'site-002', domain: 'b.com', url: 'https://b.com', productId: '' })
    const list = ops.listSitesByProductId('prod-001')
    assert.strictEqual(list.length, 1)
    assert.strictEqual(list[0].domain, 'a.com')
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd .claude/skills/backlink-agent && node --test scripts/db.test.mjs`
Expected: FAIL — site 方法不存在

- [ ] **Step 3: 在 db-ops.mjs 的 createOps 中实现站点操作**

替换 `// === 站点 ===` 注释块为：

```js
    // === 站点 ===
    addSite(site) {
      const row = toRow(site)
      const columns = [
        'id', 'domain', 'url', 'submit_url', 'category', 'comment_system',
        'antispam', 'rel_attribute', 'product_id', 'pricing', 'monthly_traffic',
        'lang', 'dr', 'notes', 'added_at'
      ]
      const values = columns.map(c => row[c] ?? (
        c === 'added_at' ? new Date().toISOString() :
        c === 'lang' ? 'en' :
        c === 'pricing' ? 'free' :
        c.endsWith('_system') || c.endsWith('_attribute') || c.endsWith('_notes') ||
        c === 'category' || c === 'monthly_traffic' ? '' :
        c === 'antispam' ? '[]' :
        c === 'dr' ? null :
        ''
      ))
      const placeholders = columns.map(() => '?').join(', ')
      db.prepare(`INSERT INTO sites (${columns.join(', ')}) VALUES (${placeholders})`).run(...values)
      return toCamel(db.prepare('SELECT * FROM sites WHERE id = ?').get(site.id))
    },

    getSiteByDomain(domain) {
      return toCamel(db.prepare('SELECT * FROM sites WHERE domain = ?').get(domain))
    },

    listSitesByProductId(productId) {
      return db.prepare('SELECT * FROM sites WHERE product_id = ? ORDER BY added_at')
        .all(productId).map(toCamel)
    },
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd .claude/skills/backlink-agent && node --test scripts/db.test.mjs`
Expected: 站点测试全部 PASS

- [ ] **Step 5: 提交**

```bash
cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent
git add .claude/skills/backlink-agent/scripts/db-ops.mjs .claude/skills/backlink-agent/scripts/db.test.mjs
git commit -m "feat(backlink-agent): 添加站点 CRUD 操作和测试"
```

---

## Task 6: 提交记录 + 站点经验 CRUD 操作

**Files:**
- Modify: `.claude/skills/backlink-agent/scripts/db-ops.mjs`
- Modify: `.claude/skills/backlink-agent/scripts/db.test.mjs`

- [ ] **Step 1: 在 db.test.mjs 末尾追加提交记录和站点经验测试**

```js
describe('提交记录操作', () => {
  let db, ops

  beforeEach(() => {
    db = createDb(':memory:')
    ops = createOps(db)
    ops.addProduct({ id: 'prod-001', name: 'Test', url: 'https://test.com' })
  })
  afterEach(() => { db.close() })

  it('addSubmission 应插入提交记录', () => {
    const sub = ops.addSubmission({
      id: 'sub-001', siteName: 'a.com', siteUrl: 'https://a.com/submit',
      productId: 'prod-001', status: 'submitted', result: '成功提交',
    })
    assert.strictEqual(sub.siteName, 'a.com')
    assert.strictEqual(sub.status, 'submitted')
  })

  it('getSubmissionsByProduct 应按产品过滤', () => {
    ops.addSubmission({ id: 'sub-001', siteName: 'a.com', siteUrl: 'https://a.com', productId: 'prod-001' })
    ops.addSubmission({ id: 'sub-002', siteName: 'b.com', siteUrl: 'https://b.com', productId: 'prod-001' })
    const list = ops.getSubmissionsByProduct('prod-001')
    assert.strictEqual(list.length, 2)
  })
})

describe('站点经验操作', () => {
  let db, ops

  beforeEach(() => {
    db = createDb(':memory:')
    ops = createOps(db)
  })
  afterEach(() => { db.close() })

  it('upsertSiteExperience 应插入新经验', () => {
    ops.upsertSiteExperience('example.com', {
      submitType: 'directory', formFramework: 'native',
    })
    const exp = ops.getSiteExperience('example.com')
    assert.strictEqual(exp.submitType, 'directory')
    assert.strictEqual(exp.formFramework, 'native')
  })

  it('upsertSiteExperience 应更新已有经验', () => {
    ops.upsertSiteExperience('example.com', { submitType: 'directory' })
    ops.upsertSiteExperience('example.com', { submitType: 'blog_comment', formFramework: 'disqus' })
    const exp = ops.getSiteExperience('example.com')
    assert.strictEqual(exp.submitType, 'blog_comment')
    assert.strictEqual(exp.formFramework, 'disqus')
  })

  it('getSiteExperience 在域名不存在时应返回 null', () => {
    assert.strictEqual(ops.getSiteExperience('nope.com'), null)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd .claude/skills/backlink-agent && node --test scripts/db.test.mjs`
Expected: FAIL — 方法不存在

- [ ] **Step 3: 在 db-ops.mjs 的 createOps 中实现提交记录和站点经验操作**

替换 `// === 提交记录 ===` 和 `// === 站点经验 ===` 注释块为：

```js
    // === 提交记录 ===
    addSubmission(submission) {
      const row = toRow(submission)
      db.prepare(`
        INSERT INTO submissions (id, site_name, site_url, product_id, status, submitted_at, result, fields)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        submission.id,
        submission.siteName,
        submission.siteUrl,
        submission.productId,
        submission.status ?? 'submitted',
        submission.submittedAt ?? new Date().toISOString(),
        submission.result ?? '',
        JSON.stringify(submission.fields ?? {}),
      )
      return toCamel(db.prepare('SELECT * FROM submissions WHERE id = ?').get(submission.id))
    },

    getSubmissionsByProduct(productId) {
      return db.prepare('SELECT * FROM submissions WHERE product_id = ? ORDER BY submitted_at')
        .all(productId).map(toCamel)
    },

    // === 站点经验 ===
    upsertSiteExperience(domain, experience) {
      const row = toRow(experience)
      db.prepare(`
        INSERT INTO site_experience (domain, aliases, updated, submit_type, form_framework, antispam, fill_strategy, post_submit_behavior, effective_patterns, known_traps)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(domain) DO UPDATE SET
          aliases = excluded.aliases,
          updated = excluded.updated,
          submit_type = excluded.submit_type,
          form_framework = excluded.form_framework,
          antispam = excluded.antispam,
          fill_strategy = excluded.fill_strategy,
          post_submit_behavior = excluded.post_submit_behavior,
          effective_patterns = excluded.effective_patterns,
          known_traps = excluded.known_traps
      `).run(
        domain,
        JSON.stringify(experience.aliases ?? []),
        new Date().toISOString(),
        experience.submitType ?? '',
        experience.formFramework ?? '',
        experience.antispam ?? '',
        experience.fillStrategy ?? '',
        experience.postSubmitBehavior ?? '',
        JSON.stringify(experience.effectivePatterns ?? []),
        JSON.stringify(experience.knownTraps ?? []),
      )
    },

    getSiteExperience(domain) {
      return toCamel(db.prepare('SELECT * FROM site_experience WHERE domain = ?').get(domain))
    },
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd .claude/skills/backlink-agent && node --test scripts/db.test.mjs`
Expected: 所有测试 PASS

- [ ] **Step 5: 提交**

```bash
cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent
git add .claude/skills/backlink-agent/scripts/db-ops.mjs .claude/skills/backlink-agent/scripts/db.test.mjs
git commit -m "feat(backlink-agent): 添加提交记录和站点经验 CRUD 操作和测试"
```

---

## Task 7: 事务操作 + 测试

**Files:**
- Modify: `.claude/skills/backlink-agent/scripts/db-ops.mjs`
- Modify: `.claude/skills/backlink-agent/scripts/db.test.mjs`

- [ ] **Step 1: 在 db.test.mjs 末尾追加事务操作测试**

```js
describe('事务操作', () => {
  let db, ops

  beforeEach(() => {
    db = createDb(':memory:')
    ops = createOps(db)
    ops.addProduct({ id: 'prod-001', name: 'Test', url: 'https://test.com' })
    ops.addBacklinks([
      { id: 'bl-1', sourceUrl: 'https://a.com/p1', domain: 'a.com' },
    ])
  })
  afterEach(() => { db.close() })

  it('addPublishableSite 应在同一事务中更新 backlink 和插入 site', () => {
    ops.addPublishableSite('bl-1', {
      id: 'site-001', domain: 'a.com', url: 'https://a.com', productId: 'prod-001',
    })
    // backlink 状态应更新
    const bls = ops.getBacklinksByStatus('publishable')
    assert.strictEqual(bls.length, 1)
    // site 应插入
    const site = ops.getSiteByDomain('a.com')
    assert.strictEqual(site.id, 'site-001')
  })

  it('addPublishableSite 在 site 插入失败时应回滚整个事务', () => {
    // 先插入一个同 id 的 site，制造主键冲突
    ops.addSite({ id: 'site-001', domain: 'x.com', url: 'https://x.com', productId: 'prod-001' })
    // 尝试用相同 id 再插入，应失败并回滚
    assert.throws(() => {
      ops.addPublishableSite('bl-1', {
        id: 'site-001', domain: 'a.com', url: 'https://a.com', productId: 'prod-001',
      })
    })
    // backlink 状态应保持不变（未更新）
    const pending = ops.getBacklinksByStatus('pending')
    assert.strictEqual(pending.length, 1, '事务回滚后 backlink 应保持 pending')
  })

  it('addSubmissionWithExperience 应在同一事务中写入提交和经验', () => {
    ops.addSubmissionWithExperience(
      { id: 'sub-001', siteName: 'a.com', siteUrl: 'https://a.com', productId: 'prod-001', status: 'submitted' },
      { submitType: 'directory', formFramework: 'native' },
    )
    // submission 应写入
    const subs = ops.getSubmissionsByProduct('prod-001')
    assert.strictEqual(subs.length, 1)
    // experience 应写入
    const exp = ops.getSiteExperience('a.com')
    assert.strictEqual(exp.submitType, 'directory')
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd .claude/skills/backlink-agent && node --test scripts/db.test.mjs`
Expected: FAIL — 事务方法不存在

- [ ] **Step 3: 在 db-ops.mjs 的 createOps 中实现事务操作**

替换 `// === 事务操作 ===` 注释块为：

```js
    // === 事务操作 ===
    addPublishableSite(backlinkId, site) {
      const tx = db.transaction(() => {
        this.updateBacklinkStatus(backlinkId, 'publishable')
        this.addSite(site)
      })
      tx()
    },

    addSubmissionWithExperience(submission, experience) {
      const domain = submission.siteName
      const tx = db.transaction(() => {
        this.addSubmission(submission)
        this.upsertSiteExperience(domain, experience)
      })
      tx()
    },
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd .claude/skills/backlink-agent && node --test scripts/db.test.mjs`
Expected: 所有测试 PASS（包括前面所有 Task 的测试）

- [ ] **Step 5: 提交**

```bash
cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent
git add .claude/skills/backlink-agent/scripts/db-ops.mjs .claude/skills/backlink-agent/scripts/db.test.mjs
git commit -m "feat(backlink-agent): 添加事务操作（publishable + submission）和测试"
```

---

## Task 8: CLI 入口

**Files:**
- Modify: `.claude/skills/backlink-agent/scripts/db-ops.mjs`

- [ ] **Step 1: 在 db-ops.mjs 末尾追加 CLI 入口**

```js
// --- CLI 入口 ---
// 用法:
//   node db-ops.mjs products                        -- 列出所有产品
//   node db-ops.mjs product <id>                     -- 查询单个产品
//   node db-ops.mjs backlinks [status]               -- 按状态查询外链（默认 pending）
//   node db-ops.mjs site <domain>                    -- 按域名查询站点
//   node db-ops.mjs sites [productId]                -- 列出站点（可按产品过滤）
//   node db-ops.mjs submissions <productId>          -- 按产品查询提交记录
//   node db-ops.mjs experience <domain>              -- 查询站点经验
//   node db-ops.mjs stats                            -- 统计数据概览

import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)

// 只在直接运行时执行 CLI（被 import 时不执行）
if (process.argv[1] === __filename) {
  const ops = createOps(db)
  const command = process.argv[2]
  const arg = process.argv[3]

  try {
    let result
    switch (command) {
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
        result = arg ? ops.listSitesByProductId(arg) : ops._db.prepare('SELECT * FROM sites ORDER BY added_at').all().map(toCamel)
        break
      case 'submissions':
        result = ops.getSubmissionsByProduct(arg)
        break
      case 'experience':
        result = ops.getSiteExperience(arg)
        break
      case 'stats':
        result = {
          products: ops._db.prepare('SELECT COUNT(*) as count FROM products').get().count,
          backlinks: {
            total: ops._db.prepare('SELECT COUNT(*) as count FROM backlinks').get().count,
            byStatus: Object.fromEntries(
              ops._db.prepare("SELECT status, COUNT(*) as count FROM backlinks GROUP BY status").all()
                .map(r => [r.status, r.count])
            ),
          },
          sites: ops._db.prepare('SELECT COUNT(*) as count FROM sites').get().count,
          submissions: {
            total: ops._db.prepare('SELECT COUNT(*) as count FROM submissions').get().count,
            byStatus: Object.fromEntries(
              ops._db.prepare("SELECT status, COUNT(*) as count FROM submissions GROUP BY status").all()
                .map(r => [r.status, r.count])
            ),
          },
          siteExperience: ops._db.prepare('SELECT COUNT(*) as count FROM site_experience').get().count,
        }
        break
      default:
        console.error(`未知命令: ${command}`)
        console.error('用法: node db-ops.mjs <products|product|backlinks|site|sites|submissions|experience|stats> [arg]')
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

- [ ] **Step 2: 手动验证 CLI 命令**

```bash
cd .claude/skills/backlink-agent

# 应返回空数组
node scripts/db-ops.mjs products

# 应返回 null
node scripts/db-ops.mjs product prod-001

# 应返回空数组
node scripts/db-ops.mjs backlinks pending

# 应返回统计概览
node scripts/db-ops.mjs stats
```

Expected: 每条命令输出合法 JSON，无报错

- [ ] **Step 3: 提交**

```bash
cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent
git add .claude/skills/backlink-agent/scripts/db-ops.mjs
git commit -m "feat(backlink-agent): 添加 db-ops.mjs CLI 入口用于 Claude 交互"
```

---

## Task 9: 改造 import-csv.mjs

**Files:**
- Modify: `.claude/skills/backlink-agent/scripts/import-csv.mjs`

- [ ] **Step 1: 重写 import-csv.mjs，直接写入 SQLite**

完整替换 `scripts/import-csv.mjs`：

```js
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
  INSERT OR IGNORE INTO backlinks (id, source_url, source_title, domain, page_ascore, status, analysis, added_at)
  VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
`)

let imported = 0
let skipped = 0

const batchInsert = db.transaction((rows) => {
  for (const row of rows) {
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
    const randomHex = Math.random().toString(16).slice(2, 6)
    const id = `bl-${Date.now()}-${randomHex}`

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
```

- [ ] **Step 2: 用现有 CSV 文件手动验证**

创建一个临时测试 CSV：

```bash
cd .claude/skills/backlink-agent
cat > /tmp/test-backlinks.csv << 'EOF'
Source url,Source title,Page ascore
https://example.com/page1,Test Page 1,50
https://example.com/page2,Test Page 2,30
EOF
node scripts/import-csv.mjs /tmp/test-backlinks.csv
```

Expected: `{"imported":2,"skipped":0}`

- [ ] **Step 3: 验证去重 — 重复运行应跳过已有 URL**

Run: `node scripts/import-csv.mjs /tmp/test-backlinks.csv`
Expected: `{"imported":0,"skipped":2}`

- [ ] **Step 4: 验证数据已写入数据库**

Run: `node scripts/db-ops.mjs backlinks pending`
Expected: 输出 2 条 pending 记录的 JSON

- [ ] **Step 5: 清理测试数据，重建空数据库**

```bash
rm .claude/skills/backlink-agent/data/backlink.db
cd .claude/skills/backlink-agent && npm run build
```

- [ ] **Step 6: 提交**

```bash
cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent
git add .claude/skills/backlink-agent/scripts/import-csv.mjs
git commit -m "refactor(backlink-agent): 改造 import-csv.mjs 直接写入 SQLite"
```

---

## Task 10: 更新 Skill 文档

**Files:**
- Modify: `.claude/skills/backlink-agent/SKILL.md`
- Modify: `.claude/skills/backlink-agent/references/data-formats.md`
- Modify: `.claude/skills/backlink-agent/references/workflow-import.md`
- Modify: `.claude/skills/backlink-agent/references/workflow-analyze.md`
- Modify: `.claude/skills/backlink-agent/references/workflow-submit.md`

> **注意**: 此 Task 需要读取每个文件的当前内容，找到涉及 JSON 文件读写的具体段落，将其替换为对应的 `node db-ops.mjs` 命令调用。由于每个文件的具体位置不同，实施时应先 Read 文件内容，定位需要修改的段落，再用 Edit 工具精确替换。

- [ ] **Step 1: 读取并更新 data-formats.md**

将数据格式说明从"5 个 JSON 文件"改为"SQLite 数据库 5 张表"。保留字段列表，但说明存储介质已变更。

关键修改点：
- 标题改为"SQLite 数据表格式"
- 文件路径从 `${SKILL_DIR}/data/*.json` 改为 `${SKILL_DIR}/data/backlink.db`
- 数据访问方式从"Read/Write 工具"改为"`node ${SKILL_DIR}/scripts/db-ops.mjs`"
- 保留每个表的字段说明（字段名改为 snake_case，添加映射说明）

- [ ] **Step 2: 读取并更新 workflow-import.md**

关键修改点：
- 删除"读取 backlinks.json 构建去重 Set"步骤
- 改为：`node "${SKILL_DIR}/scripts/import-csv.mjs" <csv-path>` 直接导入
- 删除"Claude 合并记录并写回 backlinks.json"步骤
- 保留 CSV 解析和字段映射的参考信息

- [ ] **Step 3: 读取并更新 workflow-analyze.md**

关键修改点：
- 读取 pending 记录：`node "${SKILL_DIR}/scripts/db-ops.mjs backlinks pending`
- 域名去重检查：`node "${SKILL_DIR}/scripts/db-ops.mjs site <domain>`
- 更新记录状态：不再手动写回 JSON 文件，改为调用 `node "${SKILL_DIR}/scripts/db-ops.mjs"` 的对应操作（需在 db-ops.mjs 中补充 update 操作的 CLI 入口）
- publishable 处理：调用事务操作，一个命令完成 backlink 更新 + site 插入

- [ ] **Step 4: 读取并更新 workflow-submit.md**

关键修改点：
- subagent 读取数据改为通过 `db-ops.mjs` 脚本
- 写入提交记录和站点经验改为调用 `db-ops.mjs`
- 保留 CDP 操控、表单填写等浏览器操作不变

- [ ] **Step 5: 读取并更新 SKILL.md**

关键修改点：
- 环境依赖部分：添加 `npm install` 步骤（在 `check-deps.mjs` 前运行）
- 数据操作部分：所有 Read/Write JSON 指令改为 `node scripts/db-ops.mjs` 调用
- 命令速查表：添加 `db-ops.mjs` 的所有可用命令

- [ ] **Step 6: 补充 db-ops.mjs 的 update CLI 命令**

在 Task 8 的 CLI switch 中添加缺失的写操作入口：

```js
case 'update-backlink':
  // node db-ops.mjs update-backlink <id> <status> [analysis-json]
  ops.updateBacklinkStatus(arg, process.argv[4], process.argv[5] ? JSON.parse(process.argv[5]) : undefined)
  result = { ok: true }
  break
case 'add-publishable':
  // node db-ops.mjs add-publishable <backlinkId> <site-json>
  ops.addPublishableSite(arg, JSON.parse(process.argv[4]))
  result = { ok: true }
  break
case 'add-submission':
  // node db-ops.mjs add-submission <submission-json> <experience-json>
  ops.addSubmissionWithExperience(JSON.parse(arg), JSON.parse(process.argv[4]))
  result = { ok: true }
  break
case 'upsert-experience':
  ops.upsertSiteExperience(arg, JSON.parse(process.argv[4]))
  result = { ok: true }
  break
```

- [ ] **Step 7: 运行全部测试确认无回归**

Run: `cd .claude/skills/backlink-agent && npm test`
Expected: 所有测试 PASS

- [ ] **Step 8: 提交**

```bash
cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent
git add .claude/skills/backlink-agent/SKILL.md .claude/skills/backlink-agent/references/ .claude/skills/backlink-agent/scripts/db-ops.mjs
git commit -m "docs(backlink-agent): 更新 Skill 文档，数据操作从 JSON 改为 SQLite"
```

---

## Task 11: 清理旧 JSON 文件

**Files:**
- Delete: `.claude/skills/backlink-agent/data/products.json`
- Delete: `.claude/skills/backlink-agent/data/backlinks.json`
- Delete: `.claude/skills/backlink-agent/data/sites.json`
- Delete: `.claude/skills/backlink-agent/data/submissions.json`
- Delete: `.claude/skills/backlink-agent/data/site-experience.json`

- [ ] **Step 1: 确认所有测试通过**

Run: `cd .claude/skills/backlink-agent && npm test`
Expected: 所有测试 PASS

- [ ] **Step 2: 运行 build 确认数据库正常**

Run: `cd .claude/skills/backlink-agent && npm run build && node scripts/db-ops.mjs stats`
Expected: 输出合理的统计 JSON

- [ ] **Step 3: 删除旧 JSON 文件**

```bash
rm .claude/skills/backlink-agent/data/products.json
rm .claude/skills/backlink-agent/data/backlinks.json
rm .claude/skills/backlink-agent/data/sites.json
rm .claude/skills/backlink-agent/data/submissions.json
rm .claude/skills/backlink-agent/data/site-experience.json
```

- [ ] **Step 4: 在项目根目录运行 build 确认无影响**

Run: `cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent && npm run build`
Expected: 构建成功，无报错

- [ ] **Step 5: 提交**

```bash
cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent
git add -A .claude/skills/backlink-agent/data/
git commit -m "chore(backlink-agent): 删除旧 JSON 数据文件，数据存储已迁移至 SQLite"
```
