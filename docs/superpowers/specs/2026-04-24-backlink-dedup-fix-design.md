# 外链分析去重机制修复设计

## 问题概述

外链分析面板中，CSV 导入、批量 URL 输入和分析流程存在去重不完善的问题：

1. **DB 升级后旧 SiteRecord 缺少 `domain` 字段**：DB 版本 6 新增了 `by-domain` 索引，但没有回填旧记录的 `domain` 字段。从 Google Sheets 导入的站点数据同样可能缺少 `domain`。`getSiteByDomain()` 查不到这些记录，导致域名去重失效。
2. **批量分析预过滤性能差**：`startAnalysis` 中逐条调用 `getSiteByDomain()`，每条都是一次 IndexedDB 查询，pending 列表大时（如 1000 条）性能低下。

## 修复方案

### 变更 1：DB 迁移回填 `domain` 字段

**文件**：`extension/src/lib/db.ts`

在 `upgrade` 回调中，当 `oldVersion < 7` 时，遍历 `sites` store 所有记录，对缺少 `domain` 的记录从 `submit_url` 中提取并回填。

DB 版本号从 6 升到 7。新增一个 upgrade 分支处理回填。

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

注意：版本 6 的 `createIndex('by-domain', 'domain')` 保留在 `oldVersion < 6` 分支中不变。版本 7 只负责回填数据。

### 变更 2：新增 `getExistingDomains()` 函数

**文件**：`extension/src/lib/db.ts`

新增一个函数，一次性获取 sites 表中所有已有域名的 `Set<string>`，用于批量预过滤。

```typescript
export async function getExistingDomains(): Promise<Set<string>> {
    const db = await getDB()
    const keys = await db.getAllKeysFromIndex('sites', 'by-domain')
    return new Set(keys as string[])
}
```

使用 `getAllKeysFromIndex` 而非 `getAllFromIndex`，只获取 domain 值，不加载完整 SiteRecord，节省内存。

### 变更 3：`bulkPutSites` 增加 `domain` 回填

**文件**：`extension/src/lib/db.ts`

从 Google Sheets 导入站点时，如果记录缺少 `domain`，自动从 `submit_url` 提取回填。

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

### 变更 4：优化 `startAnalysis` 预过滤

**文件**：`extension/src/hooks/useBacklinkAnalysis.ts`

将预过滤中的逐条 `getSiteByDomain()` 调用替换为一次 `getExistingDomains()` 查询。

```typescript
// 改前：N 次串行 IndexedDB 查询
for (const bl of pending) {
    const domain = extractDomain(bl.sourceUrl)
    const exists = await getSiteByDomain(domain)
    ...
}

// 改后：1 次 IndexedDB 查询
const existingDomains = await getExistingDomains()
for (const bl of pending) {
    const domain = extractDomain(bl.sourceUrl)
    if (existingDomains.has(domain)) {
        toSkip.push(bl)
    } else {
        filtered.push(bl)
    }
}
```

`analyzeOne` 内部的单条 `getSiteByDomain()` 检查保持不变，因为它是单次执行且需要实时检查最新状态。

## 变更文件清单

| 文件 | 变更 |
|------|------|
| `extension/src/lib/db.ts` | DB 版本升至 7；版本 7 迁移回填 `domain`；新增 `getExistingDomains()`；`bulkPutSites` 回填 `domain` |
| `extension/src/hooks/useBacklinkAnalysis.ts` | `startAnalysis` 预过滤改用 `getExistingDomains()` |

## 不在范围内

- `analyzeOne` 内部的单条 `getSiteByDomain()` 调用保持不变（需要实时性）
- 不引入内存域名缓存（增加复杂度，当前方案已足够）
- 不修改 `addSite` 的 upsert 逻辑（保持现有行为）
