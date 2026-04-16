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

describe('外链候选操作', () => {
  let db, ops
  beforeEach(() => { db = createDb(':memory:'); ops = createOps(db) })
  afterEach(() => { db.close() })

  it('addBacklinks 应批量插入并返回插入数量', () => {
    const count = ops.addBacklinks([
      { id: 'bl-1', sourceUrl: 'https://a.com/p1', domain: 'a.com', pageAscore: 50 },
      { id: 'bl-2', sourceUrl: 'https://b.com/p2', domain: 'b.com', pageAscore: 30 },
    ])
    assert.strictEqual(count, 2)
  })

  it('addBacklinks 应跳过重复的 sourceUrl', () => {
    ops.addBacklinks([{ id: 'bl-1', sourceUrl: 'https://a.com/p1', domain: 'a.com' }])
    const count = ops.addBacklinks([
      { id: 'bl-2', sourceUrl: 'https://a.com/p1', domain: 'a.com' },
      { id: 'bl-3', sourceUrl: 'https://b.com/p2', domain: 'b.com' },
    ])
    assert.strictEqual(count, 1)
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
    ops.addBacklinks([{ id: 'bl-1', sourceUrl: 'https://a.com', domain: 'a.com' }])
    ops.updateBacklinkStatus('bl-1', 'publishable', { score: 80 })
    const updated = ops.getBacklinksByStatus('publishable')
    assert.strictEqual(updated.length, 1)
    assert.deepStrictEqual(updated[0].analysis, { score: 80 })
  })

  it('无效 status 应被 CHECK 约束拒绝', () => {
    assert.throws(() => {
      ops.addBacklinks([{ id: 'bl-1', sourceUrl: 'https://a.com', domain: 'a.com', status: 'invalid' }])
    })
  })
})

describe('站点操作', () => {
  let db, ops
  beforeEach(() => {
    db = createDb(':memory:'); ops = createOps(db)
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
    assert.strictEqual(ops.getSiteByDomain('example.com').id, 'site-001')
  })

  it('getSiteByDomain 在域名不存在时应返回 null', () => {
    assert.strictEqual(ops.getSiteByDomain('nope.com'), null)
  })

  it('listSitesByProductId 应按产品过滤', () => {
    ops.addProduct({ id: 'prod-002', name: 'Other', url: 'https://other.com' })
    ops.addSite({ id: 'site-001', domain: 'a.com', url: 'https://a.com', productId: 'prod-001' })
    ops.addSite({ id: 'site-002', domain: 'b.com', url: 'https://b.com', productId: 'prod-002' })
    assert.strictEqual(ops.listSitesByProductId('prod-001').length, 1)
  })
})

describe('提交记录操作', () => {
  let db, ops
  beforeEach(() => {
    db = createDb(':memory:'); ops = createOps(db)
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
    assert.strictEqual(ops.getSubmissionsByProduct('prod-001').length, 2)
  })
})

describe('站点经验操作', () => {
  let db, ops
  beforeEach(() => { db = createDb(':memory:'); ops = createOps(db) })
  afterEach(() => { db.close() })

  it('upsertSiteExperience 应插入新经验', () => {
    ops.upsertSiteExperience('example.com', { submitType: 'directory', formFramework: 'native' })
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

describe('事务操作', () => {
  let db, ops
  beforeEach(() => {
    db = createDb(':memory:'); ops = createOps(db)
    ops.addProduct({ id: 'prod-001', name: 'Test', url: 'https://test.com' })
    ops.addBacklinks([{ id: 'bl-1', sourceUrl: 'https://a.com/p1', domain: 'a.com' }])
  })
  afterEach(() => { db.close() })

  it('addPublishableSite 应在同一事务中更新 backlink 和插入 site', () => {
    ops.addPublishableSite('bl-1', {
      id: 'site-001', domain: 'a.com', url: 'https://a.com', productId: 'prod-001',
    })
    assert.strictEqual(ops.getBacklinksByStatus('publishable').length, 1)
    assert.strictEqual(ops.getSiteByDomain('a.com').id, 'site-001')
  })

  it('addPublishableSite 在 site 插入失败时应回滚整个事务', () => {
    ops.addSite({ id: 'site-001', domain: 'x.com', url: 'https://x.com', productId: 'prod-001' })
    assert.throws(() => {
      ops.addPublishableSite('bl-1', {
        id: 'site-001', domain: 'a.com', url: 'https://a.com', productId: 'prod-001',
      })
    })
    assert.strictEqual(ops.getBacklinksByStatus('pending').length, 1, '事务回滚后 backlink 应保持 pending')
  })

  it('addSubmissionWithExperience 应在同一事务中写入提交和经验', () => {
    ops.addSubmissionWithExperience(
      { id: 'sub-001', siteName: 'a.com', siteUrl: 'https://a.com', productId: 'prod-001', status: 'submitted' },
      { submitType: 'directory', formFramework: 'native' },
    )
    assert.strictEqual(ops.getSubmissionsByProduct('prod-001').length, 1)
    assert.strictEqual(ops.getSiteExperience('a.com').submitType, 'directory')
  })
})
