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

function upsertRow(db, table, key, record) {
  const row = toRow(table, record)
  // 确保 key 字段存在
  const keyValue = record[key] ?? record[snakeToCamel(key)] ?? null
  row[key] = keyValue

  // 只包含有值的列，让数据库 DEFAULT 处理缺失列
  const finalRow = {}
  for (const [c, v] of Object.entries(row)) {
    if (v !== undefined) finalRow[c] = v
  }

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
    addProduct: (p) => insert(db, 'products', p),
    getProduct: (id) => getById(db, 'products', id),
    listProducts: () => listAll(db, 'products'),

    addBacklinks: (r) => addBacklinks(db, r),
    getBacklinksByStatus: (s) => listAll(db, 'backlinks', { status: s }),
    updateBacklinkStatus: (id, s, a) => updateBacklinkStatus(db, id, s, a),

    addSite: (s) => insert(db, 'sites', s),
    getSiteByDomain: (d) => getBy(db, 'sites', 'domain', d),
    listSitesByProductId: (p) => listAll(db, 'sites', { productId: p }),

    addSubmission: (s) => insert(db, 'submissions', s),
    getSubmissionsByProduct: (p) => listAll(db, 'submissions', { productId: p }),

    upsertSiteExperience: (d, e) => upsertRow(db, 'site_experience', 'domain', { domain: d, ...e }),
    getSiteExperience: (d) => getBy(db, 'site_experience', 'domain', d),

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
