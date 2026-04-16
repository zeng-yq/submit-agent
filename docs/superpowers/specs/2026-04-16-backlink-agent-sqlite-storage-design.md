# Backlink Agent: JSON → SQLite 存储层升级设计

**日期**: 2026-04-16
**状态**: Draft

## 背景与动机

当前 backlink-agent 将所有持久化数据存储在 5 个 JSON 文件中（products/backlinks/sites/submissions/site-experience）。随着数据量增长（sites.json 已达 375+ 条、58K+ tokens），以下问题日益突出：

1. **数据可靠性差**：每次更新需全文件重写，写入中途崩溃可能导致文件损坏
2. **查询性能低**：域名去重等操作依赖线性扫描 O(n)
3. **并发不安全**：多个 Claude 会话同时操作可能导致数据覆盖
4. **无事务性**：分析流程中需同时更新 backlinks.json 和 sites.json，中断后数据不一致
5. **无 Schema 校验**：ID 无唯一性保证，status 值无约束

## 方案选择

对比了 3 种方案后选定 **SQLite + better-sqlite3**：

| 方案 | 优点 | 缺点 |
|------|------|------|
| **A: SQLite (better-sqlite3)** | ACID 事务、索引、WAL 并发、单文件 | Claude 不能直接 Read 数据文件 |
| B: SQLite (sql.js) | 零编译 | 需手动持久化，性能略低 |
| C: JSON + 原子写入 + 索引 | Claude 可直接读写 | 本质是手工数据库，复杂度高 |

## 数据库设计

### 文件位置

`.claude/skills/backlink-agent/data/backlink.db`

### Schema

#### products 表

```sql
CREATE TABLE products (
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
```

#### backlinks 表

```sql
CREATE TABLE backlinks (
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

CREATE INDEX idx_backlinks_status ON backlinks(status);
CREATE INDEX idx_backlinks_domain ON backlinks(domain);
CREATE UNIQUE INDEX idx_backlinks_source_url ON backlinks(source_url);
```

#### sites 表

```sql
CREATE TABLE sites (
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

CREATE INDEX idx_sites_domain ON sites(domain);
CREATE INDEX idx_sites_product_id ON sites(product_id);
```

#### submissions 表

```sql
CREATE TABLE submissions (
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

CREATE INDEX idx_submissions_product_id ON submissions(product_id);
CREATE INDEX idx_submissions_status ON submissions(status);
```

#### site_experience 表

```sql
CREATE TABLE site_experience (
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
```

### Schema 设计要点

- 5 表一一对应原 5 个 JSON 文件，降低迁移认知负担
- `status` 字段用 `CHECK` 约束强制枚举值，阻止脏数据
- `source_url` 唯一索引从数据库层面防止重复导入
- `domain` 索引加速 ANALYZE 流程中的去重查询
- JSON 数组/对象字段（categories、antispam 等）存为 TEXT，因为无需在这些字段上做 SQL 查询

## 数据访问层

### 文件结构

```
.claude/skills/backlink-agent/scripts/
├── db.mjs            -- 数据库初始化 + schema 建表
├── db-ops.mjs        -- 业务操作函数（CRUD）
└── import-csv.mjs    -- 现有脚本，改为写 SQLite
```

### db.mjs — 数据库初始化

```js
import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = path.resolve(import.meta.dirname, '../data/backlink.db')
const db = new Database(DB_PATH)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// 建表语句（上述 Schema）
db.exec(SCHEMA_SQL)

export default db
```

### db-ops.mjs — 核心接口

```js
// 产品操作
addProduct(product) → product
getProduct(id) → product | null
listProducts() → product[]

// 外链候选操作
addBacklinks(records[]) → count          -- 批量插入，INSERT OR IGNORE 自动去重
getBacklinksByStatus(status) → backlink[]
updateBacklinkStatus(id, status, analysis?) → void

// 站点操作
addSite(site) → site
getSiteByDomain(domain) → site | null    -- 索引加速
listSitesByProductId(productId) → site[]

// 提交记录操作
addSubmission(submission) → submission
getSubmissionsByProduct(productId) → submission[]

// 站点经验操作
upsertSiteExperience(domain, experience) → void
getSiteExperience(domain) → experience | null

// 事务操作
addPublishableSite(backlinkId, site) → void
  -- 单事务内：updateBacklinkStatus + addSite

addSubmissionWithExperience(submission, experience) → void
  -- 单事务内：addSubmission + upsertSiteExperience
```

### Claude 交互方式

Claude 通过 Bash 工具调用脚本，输出 JSON 格式供解析：

```bash
# 查询 pending 外链
node db-ops.mjs backlinks pending

# 查看某站点经验
node db-ops.mjs experience example.com

# 统计提交结果
node db-ops.mjs stats

# 导入 CSV
node import-csv.mjs data.csv
```

## 工作流集成

### IMPORT 流程改造

- `import-csv.mjs` 改为直接批量 `INSERT OR IGNORE` 到 SQLite
- 不再需要"先读 JSON 构建 Set 去重"的步骤

### ANALYZE 流程改造

- 读取 pending：`SELECT * FROM backlinks WHERE status = 'pending'`（索引查询）
- 域名去重：`SELECT 1 FROM sites WHERE domain = ?`（索引查询，O(log n)）
- 每条记录分析完成后：**一个事务** 内同时更新 backlink 状态 + 插入 site
- 不再需要"即时写回整个文件"

### SUBMIT 流程改造

- subagent 通过 `db-ops.mjs` 读取产品信息、站点经验等
- 提交完成后：一个事务内写入 submission + 更新 site_experience
- 多 subagent 串行调度不变，WAL 模式提供额外安全网

## 数据安全性对比

| 场景 | 原来 JSON | SQLite |
|------|----------|--------|
| 写入中途崩溃 | 文件可能损坏 | WAL 原子性，自动回滚 |
| 两步写中间崩溃 | 数据不一致 | 事务包裹，全成功或全回滚 |
| 多会话并发写 | 后写覆盖前写 | WAL 串行化写入 |
| 磁盘空间不足 | 文件可能截断 | SQLite 检测并报错 |

## 改造范围

### 新建文件

1. `scripts/db.mjs` — 数据库初始化 + schema
2. `scripts/db-ops.mjs` — 业务操作函数

### 修改文件

3. `scripts/import-csv.mjs` — 改为写 SQLite
4. skill 定义文件 — 更新数据操作指令
5. workflow 文档 — 更新操作步骤

### 删除文件

6. `data/products.json`
7. `data/backlinks.json`
8. `data/sites.json`
9. `data/submissions.json`
10. `data/site-experience.json`

### 不变的部分

- CDP 操控逻辑
- 产品分析逻辑
- 提交流程的浏览器自动化部分

## 依赖

新增 1 个 npm 包：`better-sqlite3`
