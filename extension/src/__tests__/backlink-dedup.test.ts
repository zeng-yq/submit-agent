import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { getExistingDomains, bulkPutSites, clearSites } from '@/lib/db'
import type { SiteRecord } from '@/lib/types'

describe('getExistingDomains', () => {
  beforeEach(async () => {
    await clearSites()
  })

  it('空数据库时返回空 Set', async () => {
    const domains = await getExistingDomains()
    expect(domains.size).toBe(0)
    expect(domains instanceof Set).toBe(true)
  })

  it('返回所有已存在的域名', async () => {
    const records: SiteRecord[] = [
      {
        name: 'Site A',
        submit_url: 'https://www.example-a.com/page',
        domain: 'example-a.com',
        category: 'blog_comment',
        dr: null,
        status: 'alive',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        name: 'Site B',
        submit_url: 'https://example-b.com/post',
        domain: 'example-b.com',
        category: 'blog_comment',
        dr: null,
        status: 'alive',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]
    await bulkPutSites(records)

    const domains = await getExistingDomains()
    expect(domains.has('example-a.com')).toBe(true)
    expect(domains.has('example-b.com')).toBe(true)
    expect(domains.size).toBe(2)
  })

  it('不包含 domain 为 undefined 的记录', async () => {
    const records: SiteRecord[] = [
      {
        name: 'No Domain',
        submit_url: 'https://nodomain.com/page',
        category: 'blog_comment',
        dr: null,
        status: 'alive',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as SiteRecord,
    ]
    await bulkPutSites(records)

    const domains = await getExistingDomains()
    expect(domains.has('undefined')).toBe(false)
    expect(domains.has('')).toBe(false)
  })

  it('bulkPutSites 为缺少 domain 的记录自动回填', async () => {
    const records: SiteRecord[] = [
      {
        name: 'Missing Domain',
        submit_url: 'https://www.auto-fill.com/page',
        category: 'blog_comment',
        dr: null,
        status: 'alive',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as SiteRecord,
      {
        name: 'Has Domain',
        submit_url: 'https://has-domain.com/page',
        domain: 'has-domain.com',
        category: 'blog_comment',
        dr: null,
        status: 'alive',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]
    await bulkPutSites(records)

    const domains = await getExistingDomains()
    expect(domains.has('auto-fill.com')).toBe(true)
    expect(domains.has('has-domain.com')).toBe(true)
    expect(domains.size).toBe(2)
  })

  it('bulkPutSites 对 submit_url 为 null 的记录不崩溃', async () => {
    const records: SiteRecord[] = [
      {
        name: 'Null URL',
        submit_url: null,
        category: 'blog_comment',
        dr: null,
        status: 'alive',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as SiteRecord,
    ]
    await expect(bulkPutSites(records)).resolves.not.toThrow()
  })
})
