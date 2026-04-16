import db from './db.mjs'

// --- 字段映射工具 ---

const camelToSnake = s => s.replace(/[A-Z]/g, c => '_' + c.toLowerCase())
const snakeToCamel = s => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase())

/** 将 camelCase 对象转为 snake_case 行 */
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

/** 将 snake_case 数据库行转为 camelCase 对象 */
function toCamel(row) {
  if (!row) return null
  const obj = {}
  for (const [k, v] of Object.entries(row)) {
    const camelKey = snakeToCamel(k)
    if (typeof v === 'string' && (v.startsWith('[') || v.startsWith('{'))) {
      try { obj[camelKey] = JSON.parse(v); continue } catch { /* 不是 JSON */ }
    }
    obj[camelKey] = v
  }
  return obj
}

// --- CRUD 操作工厂 ---

export function createOps(db) {
  return {
    // === 产品 ===
    addProduct(product) {
      const row = toRow(product)
      const columns = [
        'id', 'name', 'url', 'tagline', 'short_desc', 'long_desc',
        'categories', 'anchor_texts', 'logo_url', 'social_links',
        'founder_name', 'founder_email', 'created_at'
      ]
      const defaults = {
        id: undefined, name: undefined, url: undefined,
        tagline: '', short_desc: '', long_desc: '',
        categories: '[]', anchor_texts: '[]',
        logo_url: '', social_links: '{}',
        founder_name: '', founder_email: '',
        created_at: new Date().toISOString(),
      }
      const values = columns.map(c => row[c] ?? defaults[c])
      const placeholders = columns.map(() => '?').join(', ')
      db.prepare(`INSERT INTO products (${columns.join(', ')}) VALUES (${placeholders})`).run(...values)
      return toCamel(db.prepare('SELECT * FROM products WHERE id = ?').get(product.id))
    },

    getProduct(id) {
      return toCamel(db.prepare('SELECT * FROM products WHERE id = ?').get(id))
    },

    listProducts() {
      return db.prepare('SELECT * FROM products ORDER BY created_at').all().map(toCamel)
    },

    _db: db,
  }
}

// 默认操作实例（生产环境）
export default createOps(db)
