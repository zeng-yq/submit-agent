import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createDb } from './db.mjs'
import { createOps } from './db-ops.mjs'

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
