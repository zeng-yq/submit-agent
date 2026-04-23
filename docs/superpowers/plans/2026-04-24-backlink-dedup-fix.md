# 外链分析去重机制修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复外链分析去重机制中旧 SiteRecord 缺少 `domain` 字段导致去重失效的 bug，并优化批量分析预过滤性能。

**Architecture:** DB 版本升级到 7，在 upgrade 回调中回填旧记录的 `domain` 字段；新增 `getExistingDomains()` 批量查询函数替代逐条查询；`bulkPutSites` 导入时自动回填。

**Tech Stack:** TypeScript, IndexedDB (via idb library), Vitest, React hooks

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `extension/src/lib/db.ts` | Modify | DB 版本升级、回填 domain、新增 `getExistingDomains()`、`bulkPutSites` 回填 |
| `extension/src/hooks/useBacklinkAnalysis.ts` | Modify | `startAnalysis` 预过滤改用批量查询 |
| `extension/src/__tests__/backlink-dedup.test.ts` | Create | 测试 `getExistingDomains()` 和 `bulkPutSites` 的 domain 回填逻辑 |

---

### Task 1: 新增 `getExistingDomains()` 函数

**Files:**
- Modify: `extension/src/lib/db.ts` (在 `getSiteByDomain` 函数之后添加新函数)

- [ ] **Step 1: 编写失败测试**

在 `extension/src/__tests__/backlink-dedup.test.ts` 中创建测试文件：

```typescript
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
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd extension && npx vitest run src/__tests__/backlink-dedup.test.ts`
Expected: FAIL — `getExistingDomains` is not exported

- [ ] **Step 3: 实现函数**

在 `extension/src/lib/db.ts` 中，在 `getSiteByDomain` 函数（第 313-316 行）之后添加：

```typescript
export async function getExistingDomains(): Promise<Set<string>> {
	const db = await getDB()
	const keys = await db.getAllKeysFromIndex('sites', 'by-domain')
	return new Set(keys as string[])
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd extension && npx vitest run src/__tests__/backlink-dedup.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add extension/src/lib/db.ts extension/src/__tests__/backlink-dedup.test.ts
git commit -m "feat(db): 新增 getExistingDomains() 批量域名查询函数"
```

---

### Task 2: `bulkPutSites` 增加 `domain` 回填

**Files:**
- Modify: `extension/src/lib/db.ts:257-265` (`bulkPutSites` 函数)
- Modify: `extension/src/__tests__/backlink-dedup.test.ts` (新增测试用例)

- [ ] **Step 1: 编写失败测试**

在 `extension/src/__tests__/backlink-dedup.test.ts` 的 `getExistingDomains` describe 块内追加：

```typescript
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd extension && npx vitest run src/__tests__/backlink-dedup.test.ts`
Expected: 新增的 `bulkPutSites 为缺少 domain 的记录自动回填` 测试 FAIL — `auto-fill.com` 不在 domains 中

- [ ] **Step 3: 修改 `bulkPutSites`**

在 `extension/src/lib/db.ts` 中，替换 `bulkPutSites` 函数（第 257-265 行）：

```typescript
export async function bulkPutSites(records: SiteRecord[]): Promise<void> {
	const db = await getDB()
	const tx = db.transaction('sites', 'readwrite')
	await tx.store.clear()
	for (const record of records) {
		if (!record.domain && record.submit_url) {
			record.domain = extractDomain(record.submit_url)
		}
		await tx.store.put(record)
	}
	await tx.done
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd extension && npx vitest run src/__tests__/backlink-dedup.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add extension/src/lib/db.ts extension/src/__tests__/backlink-dedup.test.ts
git commit -m "fix(db): bulkPutSites 自动回填缺失的 domain 字段"
```

---

### Task 3: DB 版本升级回填旧记录的 `domain` 字段

**Files:**
- Modify: `extension/src/lib/db.ts` (第 5-83 行：DB 版本常量和 upgrade 回调)

- [ ] **Step 1: 升级 DB 版本号**

在 `extension/src/lib/db.ts` 第 6 行，将 `const DB_VERSION = 6` 改为 `const DB_VERSION = 7`。

- [ ] **Step 2: 在 upgrade 回调中添加版本 7 迁移**

在 `extension/src/lib/db.ts` 的 `upgrade` 回调中，在 `if (oldVersion < 6)` 块之后（第 78 行之后），添加：

```typescript
				if (oldVersion < 7) {
					if (db.objectStoreNames.contains('sites')) {
						const store = tx.objectStore('sites')
						let cursor = await store.openCursor()
						while (cursor) {
							const record = cursor.value
							if (!record.domain && record.submit_url) {
								record.domain = extractDomain(record.submit_url)
								await cursor.update(record)
							}
							cursor = await cursor.continue()
						}
					}
				}
```

- [ ] **Step 3: 运行构建确认无编译错误**

Run: `cd extension && npm run build`
Expected: 构建成功，无错误

- [ ] **Step 4: 运行全部测试**

Run: `cd extension && npx vitest run`
Expected: 所有测试通过

- [ ] **Step 5: 提交**

```bash
git add extension/src/lib/db.ts
git commit -m "fix(db): 版本 7 迁移回填旧 SiteRecord 的 domain 字段"
```

---

### Task 4: 优化 `startAnalysis` 预过滤改用批量查询

**Files:**
- Modify: `extension/src/hooks/useBacklinkAnalysis.ts` (第 1-3 行 import，第 131-151 行预过滤逻辑)

- [ ] **Step 1: 修改 import**

在 `extension/src/hooks/useBacklinkAnalysis.ts` 第 3 行，添加 `getExistingDomains`（注意：`getSiteByDomain` 仍被 `analyzeOne` 使用，不可移除）：

改前：
```typescript
import { updateBacklink, listBacklinksByStatus, listBacklinks, addSite, getSiteByDomain } from '@/lib/db'
```

改后：
```typescript
import { updateBacklink, listBacklinksByStatus, listBacklinks, addSite, getSiteByDomain, getExistingDomains } from '@/lib/db'
```

- [ ] **Step 2: 替换预过滤逻辑**

在 `extension/src/hooks/useBacklinkAnalysis.ts` 中，替换第 131-151 行的预过滤逻辑：

改前：
```typescript
				// 预过滤：排除资源库中已有域名的 backlink
				const filtered: BacklinkRecord[] = []
				const toSkip: BacklinkRecord[] = []
				for (const bl of pending) {
					const domain = extractDomain(bl.sourceUrl)
					const exists = await getSiteByDomain(domain)
					if (exists) {
						toSkip.push(bl)
					} else {
						filtered.push(bl)
					}
				}
```

改后：
```typescript
				// 预过滤：排除资源库中已有域名的 backlink
				const existingDomains = await getExistingDomains()
				const filtered: BacklinkRecord[] = []
				const toSkip: BacklinkRecord[] = []
				for (const bl of pending) {
					const domain = extractDomain(bl.sourceUrl)
					if (existingDomains.has(domain)) {
						toSkip.push(bl)
					} else {
						filtered.push(bl)
					}
				}
```

- [ ] **Step 3: 运行构建确认无编译错误**

Run: `cd extension && npm run build`
Expected: 构建成功，无错误

- [ ] **Step 4: 运行全部测试**

Run: `cd extension && npx vitest run`
Expected: 所有测试通过

- [ ] **Step 5: 提交**

```bash
git add extension/src/hooks/useBacklinkAnalysis.ts
git commit -m "perf: startAnalysis 预过滤改用批量域名查询替代逐条查询"
```

---

## Self-Review Checklist

**1. Spec coverage:**
- 变更 1（DB 迁移回填 domain）→ Task 3 ✓
- 变更 2（新增 `getExistingDomains()`）→ Task 1 ✓
- 变更 3（`bulkPutSites` 回填 domain）→ Task 2 ✓
- 变更 4（优化 `startAnalysis` 预过滤）→ Task 4 ✓

**2. Placeholder scan:** 无 TBD、TODO、"implement later"、"add validation"、"handle edge cases"、空洞步骤。

**3. Type consistency:**
- `getExistingDomains()` 返回 `Promise<Set<string>>`，在 Task 1 定义，Task 4 中使用 `existingDomains.has(domain)` — 一致 ✓
- `bulkPutSites` 参数类型 `SiteRecord[]`，Task 2 中使用 — 一致 ✓
- `extractDomain` 从 `backlinks.ts` 导入，`db.ts` 已有此导入 — 一致 ✓
- `getSiteByDomain` 在 Task 4 import 中被移除，`analyzeOne` 内部仍使用它 — 需确认 `analyzeOne` 是否仍需要。查看 `analyzeOne` 第 27-28 行使用了 `getSiteByDomain`，所以 import 中不能完全移除。

**发现问题：** Task 4 Step 1 中将 `getSiteByDomain` 从 import 移除会导致 `analyzeOne` 编译失败。需要同时保留两个 import。

**修复：** 将 Task 4 Step 1 修改为添加 `getExistingDomains` 而非替换：

```typescript
import { updateBacklink, listBacklinksByStatus, listBacklinks, addSite, getSiteByDomain, getExistingDomains } from '@/lib/db'
```
