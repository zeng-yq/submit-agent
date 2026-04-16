import { fileURLToPath } from 'node:url'
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

    // === 外链候选 ===
    addBacklinks(records) {
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

    // === 站点 ===
    addSite(site) {
      const row = toRow(site)
      const columns = [
        'id', 'domain', 'url', 'submit_url', 'category', 'comment_system',
        'antispam', 'rel_attribute', 'product_id', 'pricing', 'monthly_traffic',
        'lang', 'dr', 'notes', 'added_at'
      ]
      const defaults = {
        id: undefined, domain: undefined, url: undefined,
        submit_url: '', category: '', comment_system: '',
        antispam: '[]', rel_attribute: '', product_id: '',
        pricing: 'free', monthly_traffic: '',
        lang: 'en', dr: null, notes: '',
        added_at: new Date().toISOString(),
      }
      const values = columns.map(c => row[c] ?? defaults[c])
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

    // === 提交记录 ===
    addSubmission(submission) {
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

    _db: db,
  }
}

// 默认操作实例（生产环境）
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
        console.error('用法: node db-ops.mjs <products|product|add-product|backlinks|site|sites|submissions|experience|stats|update-backlink|add-publishable|add-submission|upsert-experience> [arg]')
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
