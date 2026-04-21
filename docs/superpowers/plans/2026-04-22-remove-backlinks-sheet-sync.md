# 移除 Backlinks 表的 Google Sheets 同步 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 Google Sheets 同步中移除 backlinks 表，上传和下载时不再处理 backlinks 数据。

**Architecture:** 从 `SHEET_DEFS` 中删除 backlinks 条目，清理 `SyncPanel.tsx` 中对应的读取/写入代码。`sheets-client.ts` 和 `serializer.ts` 通过遍历 `SHEET_DEFS` 工作，无需修改。

**Tech Stack:** TypeScript, React, WXT (Chrome Extension)

---

### Task 1: 从 SHEET_DEFS 中移除 backlinks 条目

**Files:**
- Modify: `extension/src/lib/sync/types.ts:97-110`

- [ ] **Step 1: 删除 backlinks 条目**

在 `extension/src/lib/sync/types.ts` 中，删除第 97-110 行的 `backlinks` 条目（从第 97 行 `backlinks: {` 到第 110 行 `},`），使其变为：

```typescript
export const SHEET_DEFS: Record<string, SheetDef> = {
  products: {
    tabName: 'products',
    columns: [
      { header: 'id', key: 'id' },
      { header: 'name', key: 'name' },
      { header: 'url', key: 'url' },
      { header: 'tagline', key: 'tagline' },
      { header: 'shortDesc', key: 'shortDesc' },
      { header: 'longDesc', key: 'longDesc' },
      { header: 'categories', key: 'categories', encode: 'json' },
      { header: 'logoSquare', key: 'logoSquare' },
      { header: 'logoBanner', key: 'logoBanner' },
      { header: 'screenshots', key: 'screenshots', encode: 'json' },
      { header: 'founderName', key: 'founderName' },
      { header: 'founderEmail', key: 'founderEmail' },
      { header: 'socialLinks', key: 'socialLinks', encode: 'json' },
      { header: 'createdAt', key: 'createdAt', encode: 'date' },
      { header: 'updatedAt', key: 'updatedAt', encode: 'date' },
    ],
  },
  submissions: {
    tabName: 'submissions',
    columns: [
      { header: 'id', key: 'id' },
      { header: 'siteName', key: 'siteName' },
      { header: 'productId', key: 'productId' },
      { header: 'status', key: 'status' },
      { header: 'rewrittenDesc', key: 'rewrittenDesc' },
      { header: 'submittedAt', key: 'submittedAt', encode: 'date' },
      { header: 'notes', key: 'notes' },
      { header: 'error', key: 'error' },
      { header: 'failedAt', key: 'failedAt', encode: 'date' },
      { header: 'createdAt', key: 'createdAt', encode: 'date' },
      { header: 'updatedAt', key: 'updatedAt', encode: 'date' },
    ],
  },
  sites: {
    tabName: 'sites',
    columns: [
      { header: 'name', key: 'name' },
      { header: 'submit_url', key: 'submit_url' },
      { header: 'category', key: 'category' },
      { header: 'lang', key: 'lang' },
      { header: 'dr', key: 'dr' },
      { header: 'status', key: 'status' },
      { header: 'createdAt', key: 'createdAt', encode: 'date' },
      { header: 'updatedAt', key: 'updatedAt', encode: 'date' },
    ],
  },
}
```

- [ ] **Step 2: 运行构建验证**

Run: `cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent && npm run build`
Expected: 构建成功（可能有 SyncPanel 的未使用 import 警告，下一步修复）

- [ ] **Step 3: 提交**

```bash
git add extension/src/lib/sync/types.ts
git commit -m "refactor: 从 SHEET_DEFS 中移除 backlinks 同步定义"
```

---

### Task 2: 清理 SyncPanel.tsx 中的 backlinks 相关代码

**Files:**
- Modify: `extension/src/components/SyncPanel.tsx`

- [ ] **Step 1: 清理 import 语句**

将第 5 行的 import 从：
```typescript
import { listProducts, listSubmissions, listSites, listBacklinks } from '@/lib/db'
```
改为：
```typescript
import { listProducts, listSubmissions, listSites } from '@/lib/db'
```

将第 6 行的 import 从：
```typescript
import { bulkPutProducts, bulkPutSubmissions, bulkPutSites, bulkPutBacklinks } from '@/lib/db'
```
改为：
```typescript
import { bulkPutProducts, bulkPutSubmissions, bulkPutSites } from '@/lib/db'
```

- [ ] **Step 2: 清理上传流程中的 backlinks 数据读取**

将第 169-173 行的 `Promise.all` 从：
```typescript
const [products, submissions, sites, backlinks] = await Promise.all([
  listProducts(),
  listSubmissions(),
  listSites(),
  listBacklinks(),
])
```
改为：
```typescript
const [products, submissions, sites] = await Promise.all([
  listProducts(),
  listSubmissions(),
  listSites(),
])
```

将第 176-183 行的 `exportToSheets` 调用从：
```typescript
const result = await exportToSheets(
  sheetUrl,
  {
    products: products as unknown as Record<string, unknown>[],
    submissions: submissions as unknown as Record<string, unknown>[],
    sites: sites as unknown as Record<string, unknown>[],
    backlinks: backlinks as unknown as Record<string, unknown>[],
  },
  handleExportProgress,
  abortController.signal,
)
```
改为：
```typescript
const result = await exportToSheets(
  sheetUrl,
  {
    products: products as unknown as Record<string, unknown>[],
    submissions: submissions as unknown as Record<string, unknown>[],
    sites: sites as unknown as Record<string, unknown>[],
  },
  handleExportProgress,
  abortController.signal,
)
```

将第 189 行的成功消息从：
```typescript
const detail = `产品: ${result.counts['products'] ?? 0}, 提交记录: ${result.counts['submissions'] ?? 0}, 站点: ${result.counts['sites'] ?? 0}, 外链: ${result.counts['backlinks'] ?? 0}`
```
改为：
```typescript
const detail = `产品: ${result.counts['products'] ?? 0}, 提交记录: ${result.counts['submissions'] ?? 0}, 站点: ${result.counts['sites'] ?? 0}`
```

- [ ] **Step 3: 清理下载流程中的 backlinks 数据处理**

删除第 228-238 行的 backlinks 校验逻辑（`VALID_STATUS` 常量和 `backlinks` 变量赋值），以及第 244 行的 `bulkPutBacklinks(backlinks as any)` 调用。

将第 228-244 行的 `await Promise.all([...])` 块从：
```typescript
const now = Date.now()
const VALID_STATUS = new Set(['pending', 'publishable', 'not_publishable', 'skipped', 'error'])
const backlinks = (result.data.backlinks as Record<string, unknown>[]).map(r => ({
  ...r,
  id: r.id || crypto.randomUUID(),
  pageAscore: Number(r.pageAscore) || 0,
  status: VALID_STATUS.has(r.status as string) ? r.status : 'pending',
  analysisLog: Array.isArray(r.analysisLog) ? r.analysisLog : [],
  createdAt: typeof r.createdAt === 'number' ? r.createdAt : now,
  updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : now,
}))

await Promise.all([
  bulkPutProducts(products as any),
  bulkPutSubmissions(submissions as any),
  bulkPutSites(result.data.sites as any),
  bulkPutBacklinks(backlinks as any),
])
```
改为：
```typescript
await Promise.all([
  bulkPutProducts(products as any),
  bulkPutSubmissions(submissions as any),
  bulkPutSites(result.data.sites as any),
])
```

将第 247 行的导入详情从：
```typescript
let detail = `产品: ${result.counts['products'] ?? 0}, 提交记录: ${result.counts['submissions'] ?? 0}, 站点: ${result.counts['sites'] ?? 0}, 外链: ${result.counts['backlinks'] ?? 0}`
```
改为：
```typescript
let detail = `产品: ${result.counts['products'] ?? 0}, 提交记录: ${result.counts['submissions'] ?? 0}, 站点: ${result.counts['sites'] ?? 0}`
```

- [ ] **Step 4: 运行构建验证**

Run: `cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent && npm run build`
Expected: 构建成功，无错误

- [ ] **Step 5: 提交**

```bash
git add extension/src/components/SyncPanel.tsx
git commit -m "refactor: 从 Google Sheets 同步中移除 backlinks 表的读写"
```
