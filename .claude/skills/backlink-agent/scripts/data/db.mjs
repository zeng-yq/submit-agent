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
