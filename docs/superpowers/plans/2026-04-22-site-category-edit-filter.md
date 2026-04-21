# Site Category Edit & Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Dashboard 的站点卡片列表增加分类内联编辑和分类筛选下拉功能。

**Architecture:** 新增 `SiteCategory` 类型（3 个固定值），在 `useSites` hook 中增加 `updateSiteCategory` 方法，Dashboard 增加筛选下拉，SiteCard 将 category 文字改为可点击的内联编辑器。

**Tech Stack:** React, TypeScript, Tailwind CSS, IndexedDB (idb), Vitest

---

### Task 1: Types & Constants

**Files:**
- Modify: `extension/src/lib/types.ts:53-56`

- [ ] **Step 1: 添加 SiteCategory 类型和 SITE_CATEGORIES 常量**

在 `types.ts` 的 `SiteData` 接口之前（第 52 行 `/** One entry from sites.json */` 之前）插入：

```typescript
/** Site category — fixed set of 3 categories for the submit dashboard */
export type SiteCategory = 'blog_comment' | 'ai_directory' | 'others'

export const SITE_CATEGORIES: { value: SiteCategory; label: string }[] = [
  { value: 'blog_comment', label: '博客评论' },
  { value: 'ai_directory', label: 'AI 目录' },
  { value: 'others', label: '其他' },
]

/** Get display label for a category value; unknown values map to '其他'. */
export function getCategoryLabel(category: string): string {
  return SITE_CATEGORIES.find((c) => c.value === category)?.label ?? category
}
```

然后将 `SiteData.category` 从 `string` 改为 `SiteCategory`：

```typescript
export interface SiteData {
  name: string
  submit_url: string | null
  category: SiteCategory
  lang?: string
  dr: number | null
  status?: string
  monthly_traffic?: number
  pricing?: string
  notes?: string
}
```

- [ ] **Step 2: 编写 getCategoryLabel 测试**

创建 `extension/src/__tests__/category-label.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { getCategoryLabel, SITE_CATEGORIES } from '@/lib/types'

describe('getCategoryLabel', () => {
  it('returns label for known categories', () => {
    expect(getCategoryLabel('blog_comment')).toBe('博客评论')
    expect(getCategoryLabel('ai_directory')).toBe('AI 目录')
    expect(getCategoryLabel('others')).toBe('其他')
  })

  it('returns raw value for unknown categories', () => {
    expect(getCategoryLabel('Non-Blog Comment')).toBe('Non-Blog Comment')
  })

  it('SITE_CATEGORIES has exactly 3 entries', () => {
    expect(SITE_CATEGORIES).toHaveLength(3)
  })
})
```

- [ ] **Step 3: 运行测试验证**

Run: `cd extension && npx vitest run src/__tests__/category-label.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add extension/src/lib/types.ts extension/src/__tests__/category-label.test.ts
git commit -m "feat: 添加 SiteCategory 类型和 getCategoryLabel 工具函数"
```

---

### Task 2: DB Layer — updateSiteCategory + seedSites 映射

**Files:**
- Modify: `extension/src/lib/db.ts:1-2` (imports), `:203-219` (seedSites), 新增函数

- [ ] **Step 1: 更新 db.ts imports**

在 `db.ts` 第 2 行的 import 中添加 `SiteCategory`：

```typescript
import type { ProductProfile, SiteRecord, SiteData, SubmissionRecord, BacklinkRecord, BacklinkStatus, SiteCategory } from './types'
```

- [ ] **Step 2: 更新 seedSites 映射**

在 `seedSites` 函数中（约第 208-218 行），将 category 映射逻辑改为：

```typescript
export async function seedSites(sites: SiteData[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('sites', 'readwrite')
  const now = Date.now()
  for (const site of sites) {
    const existing = await tx.store.get(site.name)
    if (!existing) {
      const category: SiteCategory =
        site.category === 'Non-Blog Comment' ? 'others' : site.category
      const record: SiteRecord = {
        ...site,
        category,
        domain: site.submit_url ? extractDomain(site.submit_url) : undefined,
        createdAt: now,
        updatedAt: now,
      }
      await tx.store.put(record)
    }
  }
  await tx.done
}
```

注意：虽然 `SiteData.category` 已声明为 `SiteCategory`，但 `sites.json` 中的旧数据仍是 `"Non-Blog Comment"`，运行时 JSON.parse 不受 TS 类型约束。这个映射确保旧数据被正确转换。

- [ ] **Step 3: 添加 updateSiteCategory 函数**

在 `db.ts` 的 `updateSite` 函数之后（约第 242 行后）添加：

```typescript
export async function updateSiteCategory(name: string, category: SiteCategory): Promise<SiteRecord> {
  const db = await getDB()
  const site = await db.get('sites', name)
  if (!site) throw new Error(`Site not found: ${name}`)
  const updated = { ...site, category, updatedAt: Date.now() }
  await db.put('sites', updated)
  return updated
}
```

- [ ] **Step 4: 更新 sites.ts 的 filterByCategory 类型**

在 `extension/src/lib/sites.ts` 中更新 imports 和函数签名：

```typescript
import type { SiteData, SitesDatabase, SiteCategory } from './types'
```

将 `filterByCategory` 的参数类型从 `string` 改为 `SiteCategory`：

```typescript
export function filterByCategory(sites: SiteData[], category: SiteCategory): SiteData[] {
  return sites.filter((s) => s.category === category)
}
```

- [ ] **Step 5: 运行 build 验证**

Run: `cd extension && npm run build`
Expected: 成功

- [ ] **Step 6: Commit**

```bash
git add extension/src/lib/db.ts extension/src/lib/sites.ts
git commit -m "feat: 添加 updateSiteCategory 并更新 seedSites 分类映射"
```

---

### Task 3: useSites Hook — 添加 updateSiteCategory 方法

**Files:**
- Modify: `extension/src/hooks/useSites.ts:1-4` (imports), `:6-17` (interface), `:125-146` (return)

- [ ] **Step 1: 添加 import**

在 `useSites.ts` 第 4 行的 import 中添加 `updateSiteCategory`：

```typescript
import { listSubmissionsByProduct, saveSubmission, updateSubmission, deleteSubmission, deleteSite, deleteSubmissionsBySite, updateSiteCategory } from '@/lib/db'
```

同时添加 `SiteCategory` 类型 import：

```typescript
import type { SiteData, SubmissionRecord, SiteCategory } from '@/lib/types'
```

- [ ] **Step 2: 更新 UseSitesResult 接口**

在 `UseSitesResult` 接口中添加：

```typescript
updateSiteCategory: (siteName: string, category: SiteCategory) => Promise<void>
```

- [ ] **Step 3: 实现 updateSiteCategory 方法**

在 `handleDeleteSite` 回调之后、`return` 之前添加：

```typescript
const handleUpdateSiteCategory = useCallback(
  async (siteName: string, category: SiteCategory) => {
    await updateSiteCategory(siteName, category)
    await refresh()
  },
  [refresh]
)
```

- [ ] **Step 4: 更新 return 对象**

在 return 对象中添加 `updateSiteCategory: handleUpdateSiteCategory`：

```typescript
return {
  sites,
  submissions,
  loading,
  refresh,
  markSubmitted,
  markSkipped,
  markFailed,
  resetSubmission,
  updateStatus,
  deleteSite: handleDeleteSite,
  updateSiteCategory: handleUpdateSiteCategory,
}
```

- [ ] **Step 5: 运行 build 验证**

Run: `cd extension && npm run build`
Expected: 成功

- [ ] **Step 6: Commit**

```bash
git add extension/src/hooks/useSites.ts
git commit -m "feat: useSites hook 添加 updateSiteCategory 方法"
```

---

### Task 4: SiteCard — 内联分类编辑器

**Files:**
- Modify: `extension/src/components/SiteCard.tsx`

- [ ] **Step 1: 更新 imports 和 props**

替换 `SiteCard.tsx` 开头的 imports：

```typescript
import { useState, useRef, useEffect } from 'react'
import { Play, Trash2, Loader2 } from 'lucide-react'
import type { SiteData, SubmissionStatus, SiteCategory } from '@/lib/types'
import { SITE_CATEGORIES, getCategoryLabel } from '@/lib/types'
```

更新 `SiteCardProps` 接口，添加 `onCategoryChange`：

```typescript
interface SiteCardProps {
  site: SiteData
  status?: SubmissionStatus
  onSelect?: (site: SiteData) => void
  onDelete?: (siteName: string) => void
  onResetStatus?: (siteName: string) => void
  onCategoryChange?: (siteName: string, category: SiteCategory) => void
  disabled?: boolean
  isActive?: boolean
}
```

- [ ] **Step 2: 添加内联分类编辑器组件**

在 `SiteCard` 函数之前添加一个内部组件：

```typescript
/** Inline category editor — a clickable tag that opens a small dropdown. */
function CategoryEditor({
  siteName,
  category,
  onChange,
}: {
  siteName: string
  category: string
  onChange: (siteName: string, category: SiteCategory) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent/50 px-1 rounded transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        {getCategoryLabel(category)}
        <span className="ml-0.5 opacity-50">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 bg-popover border border-border/60 rounded shadow-lg z-50 py-1 min-w-[100px]">
          {SITE_CATEGORIES.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`w-full text-left px-2.5 py-1 text-[10px] hover:bg-accent transition-colors ${
                category === opt.value ? 'text-primary font-medium' : 'text-foreground'
              }`}
              onClick={() => {
                onChange(siteName, opt.value)
                setOpen(false)
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: 在 SiteCard 中使用 CategoryEditor**

更新 `SiteCard` 的 props 解构：

```typescript
export function SiteCard({ site, status = 'not_started', onSelect, onDelete, onResetStatus, onCategoryChange, disabled, isActive }: SiteCardProps) {
```

替换原来的 category 显示部分（约第 80-84 行）：

```typescript
// 替换前:
{site.category && (
  <span className="text-[10px] text-muted-foreground truncate">{site.category}</span>
)}

// 替换后:
{onCategoryChange ? (
  <CategoryEditor siteName={site.name} category={site.category} onChange={onCategoryChange} />
) : (
  <span className="text-[10px] text-muted-foreground truncate">{getCategoryLabel(site.category)}</span>
)}
```

- [ ] **Step 4: 运行 build 验证**

Run: `cd extension && npm run build`
Expected: 成功

- [ ] **Step 5: Commit**

```bash
git add extension/src/components/SiteCard.tsx
git commit -m "feat: SiteCard 添加内联分类编辑器"
```

---

### Task 5: Dashboard 分类筛选 + App.tsx 集成

**Files:**
- Modify: `extension/src/components/Dashboard.tsx`
- Modify: `extension/src/entrypoints/sidepanel/App.tsx`

- [ ] **Step 1: 更新 Dashboard imports 和 props**

更新 `Dashboard.tsx` 开头的 imports：

```typescript
import type { SiteData, SubmissionRecord, SubmissionStatus, SiteCategory } from '@/lib/types'
import { SITE_CATEGORIES, getCategoryLabel } from '@/lib/types'
```

更新 `DashboardProps` 接口，添加 `onCategoryChange`：

```typescript
interface DashboardProps {
  sites: SiteData[]
  submissions: Map<string, SubmissionRecord>
  onSelectSite: (site: SiteData) => void
  onRetrySite?: (site: SiteData) => void
  onResetStatus?: (siteName: string) => void
  onDeleteSite?: (siteName: string) => void
  onCategoryChange?: (siteName: string, category: SiteCategory) => void
  engineStatus: FillEngineStatus
  engineLogs: LogEntry[]
  onClearEngineLogs: () => void
  activeSiteName: string | null
}
```

- [ ] **Step 2: 添加 categoryFilter state**

在 Dashboard 组件函数内（`const [search, setSearch] = useState('')` 后）添加：

```typescript
const [categoryFilter, setCategoryFilter] = useState<SiteCategory | 'all'>('all')
```

- [ ] **Step 3: 更新 allSites useMemo 加入分类筛选**

修改 `allSites` 的 useMemo（约第 54-59 行），在 search 过滤之后追加 category 过滤：

```typescript
const allSites = useMemo(() => {
  const q = search.toLowerCase()
  return sites
    .filter((s) => !q || s.name.toLowerCase().includes(q) || s.category?.toLowerCase().includes(q))
    .filter((s) => categoryFilter === 'all' || s.category === categoryFilter)
    .sort((a, b) => (b.dr ?? 0) - (a.dr ?? 0))
}, [sites, search, categoryFilter])
```

- [ ] **Step 4: 在 Dashboard props 解构中添加 onCategoryChange**

```typescript
export function Dashboard({
  sites,
  submissions,
  onSelectSite,
  onRetrySite,
  onResetStatus,
  onDeleteSite,
  onCategoryChange,
  engineStatus,
  engineLogs,
  onClearEngineLogs,
  activeSiteName,
}: DashboardProps) {
```

- [ ] **Step 5: 添加分类筛选 UI**

在搜索框 `<input>` 之前（约第 132 行 `{tab === 'all' && (` 之后），添加分类下拉：

```tsx
{tab === 'all' && (
  <div className="flex items-center gap-2">
    <select
      value={categoryFilter}
      onChange={(e) => setCategoryFilter(e.target.value as SiteCategory | 'all')}
      className="shrink-0 px-2 py-1.5 text-xs rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
    >
      <option value="all">全部分类</option>
      {SITE_CATEGORIES.map((c) => (
        <option key={c.value} value={c.value}>{c.label}</option>
      ))}
    </select>
    <input
      type="text"
      placeholder={'搜索站点...'}
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      className="flex-1 px-2.5 py-1.5 text-xs rounded border border-border bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
    />
  </div>
)}
```

- [ ] **Step 6: 传递 onCategoryChange 给 SiteCard**

在 `displaySites.map` 中的 `<SiteCard>` 添加 `onCategoryChange` prop（约第 233-243 行）：

```tsx
displaySites.map((site) => (
  <SiteCard
    key={site.name}
    site={site}
    status={submissions.get(site.name)?.status ?? 'not_started'}
    onSelect={onSelectSite}
    onDelete={onDeleteSite}
    onResetStatus={onResetStatus}
    onCategoryChange={onCategoryChange}
    disabled={hasActive && site.name !== activeSiteName}
    isActive={hasActive && site.name === activeSiteName}
  />
))
```

- [ ] **Step 7: 更新 App.tsx 传递 onCategoryChange**

在 `App.tsx` 中：
1. 从 `useSites` 解构 `updateSiteCategory`（约第 22 行）：

```typescript
const { sites, submissions, loading: sitesLoading, markSubmitted, markSkipped, markFailed, resetSubmission, deleteSite, updateSiteCategory } = useSites(activeProduct?.id ?? null)
```

2. 在 `<Dashboard>` 组件调用处添加 prop（约第 205-217 行）：

```tsx
<Dashboard
  sites={sites}
  submissions={submissions}
  onSelectSite={handleStartSite}
  onRetrySite={handleStartSite}
  onResetStatus={resetSubmission}
  onDeleteSite={handleDeleteSite}
  onCategoryChange={updateSiteCategory}
  engineStatus={engineStatus}
  engineLogs={engineLogs}
  onClearEngineLogs={clearLogs}
  activeSiteName={currentEngineSite?.name ?? null}
/>
```

- [ ] **Step 8: 运行 build 验证**

Run: `cd extension && npm run build`
Expected: 成功

- [ ] **Step 9: 运行全部测试**

Run: `cd extension && npx vitest run`
Expected: 全部 PASS

- [ ] **Step 10: Commit**

```bash
git add extension/src/components/Dashboard.tsx extension/src/entrypoints/sidepanel/App.tsx
git commit -m "feat: Dashboard 添加分类筛选下拉和内联编辑集成"
```

---

### Task 6: 清理 — 更新 useBacklinkAnalysis 中的硬编码分类

**Files:**
- Modify: `extension/src/hooks/useBacklinkAnalysis.ts:71`

- [ ] **Step 1: 确认类型兼容性**

`useBacklinkAnalysis.ts` 第 71 行有 `category: 'blog_comment'`。由于 `'blog_comment'` 是 `SiteCategory` 的有效值，无需修改。此处仅需确认 build 通过。

- [ ] **Step 2: 最终 build 验证**

Run: `cd extension && npm run build`
Expected: 成功

- [ ] **Step 3: 运行全部测试**

Run: `cd extension && npx vitest run`
Expected: 全部 PASS

- [ ] **Step 4: 清理设计文档**

如果所有功能正常，删除设计文档：

```bash
rm docs/superpowers/specs/2026-04-22-site-category-edit-filter-design.md
```
