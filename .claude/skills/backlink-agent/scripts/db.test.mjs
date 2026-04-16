import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
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
    assert.ok(indexes.length >= 7, `应有至少 7 个索引，实际 ${indexes.length}`)
    assert.ok(indexes.includes('idx_backlinks_status'))
    assert.ok(indexes.includes('idx_backlinks_domain'))
    assert.ok(indexes.includes('idx_backlinks_source_url'))
    assert.ok(indexes.includes('idx_sites_domain'))
    assert.ok(indexes.includes('idx_sites_product_id'))
    assert.ok(indexes.includes('idx_submissions_product_id'))
    assert.ok(indexes.includes('idx_submissions_status'))
    db.close()
  })

  it('应启用外键约束', () => {
    const db = createDb(':memory:')
    const [{ foreign_keys }] = db.pragma('foreign_keys')
    assert.strictEqual(foreign_keys, 1)
    db.close()
  })
})
