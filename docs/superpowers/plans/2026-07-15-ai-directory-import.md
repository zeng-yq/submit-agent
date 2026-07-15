# AI 目录外链 CSV 导入 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在「外链提交」面板新增「导入 CSV」入口，把 `名称,url,价格,需要登录` 格式的 AI 目录站点批量导入 IndexedDB `sites` store（`category=ai_directory`、默认未提交），并为 `SiteData` 补齐结构化的 `pricing_type` 与 `requires_login` 两个字段（含卡片展示与编辑支持）。

**Architecture:** 在当前 IndexedDB 代码上实现（不接 Supabase）。新增 `importAiDirectoryFromCsv`（`lib/sites.ts`），复用 `backlinks.ts` 的 `parseCsv`（改 export）；按 `domain` 去重——不存在则新建 ai_directory 站点（无 submission → 天然未提交），已存在则 `updateSite` 仅补两个新字段、保留原分类与其余字段。`SiteData` 加 `pricing_type?: 'free'|'paid'|'mixed'` 与 `requires_login?: boolean`（不动现有 `pricing` 自由文本）。Dashboard 工具栏加导入按钮，SiteCard 展示标签并在编辑表单补两字段。

**Tech Stack:** TypeScript + WXT（MV3 扩展）+ React + Vitest（jsdom + fake-indexeddb）+ IndexedDB（idb）。

## Global Constraints

- 提交信息用中文，清晰说明「原因」，关联本计划。
- 每个任务结束运行 `npm --prefix extension run build`，报错则修复（CLAUDE.md 强制）。
- 绝不通过 `--no-verify` 跳过钩子；绝不禁用测试来规避错误。
- 测试框架：vitest，环境 jsdom；单测放 `extension/src/__tests__/*.test.ts`，命令 `npm --prefix extension run test`（单文件加 `-- src/__tests__/xxx.test.ts`）。
- 依赖 IndexedDB 的单测用 `fake-indexeddb/auto`（参照 `backlink-dedup.test.ts`），跑真实 `db.ts` 代码，不 mock db 函数。
- 不新增浏览器权限；不接入 Supabase；不改 Backlink 模型 / 外链分析面板 / 自动提交流程。
- 数据模型改动遵循既有 `SITE_CATEGORIES`/`getCategoryLabel` 模式（枚举 + label 映射）。

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `extension/src/lib/types.ts` | 数据模型 + 枚举 | 改：`SiteData` 加 `pricing_type`/`requires_login`；新增 `SitePricing`/`SITE_PRICINGS`/`getPricingLabel` |
| `extension/src/lib/backlinks.ts` | CSV 解析 | 改：`parseCsv` 加 `export`（1 行） |
| `extension/src/lib/sites.ts` | Site 数据辅助 + 导入 | 改：新增 `importAiDirectoryFromCsv` + `SiteImportResult` + 两个映射纯函数 |
| `extension/src/components/Dashboard.tsx` | 外链提交面板 | 改：`DashboardProps` 加 `onImportCsv`；工具栏加「导入 CSV」按钮 + 结果提示 |
| `extension/src/entrypoints/sidepanel/App.tsx` | sidepanel 主界面 | 改：`handleImportAiDirectory` 接线 + 传 prop |
| `extension/src/components/SiteCard.tsx` | 站点卡片 + 编辑 | 改：卡片显示价格/需登录标签；编辑 Dialog 加两字段 |
| `extension/src/__tests__/pricing-label.test.ts` | `getPricingLabel` 纯函数 | 新建 |
| `extension/src/__tests__/ai-directory-import.test.ts` | 导入流程（fake-indexeddb） | 新建 |

**接口契约（跨任务共用，后续任务只看自己任务也需知道这些名字/类型）：**

- `SitePricing = 'free' | 'paid' | 'mixed'`（types.ts）
- `SITE_PRICINGS: { value: SitePricing; label: string }[]`（types.ts）= 免费/付费/混合
- `getPricingLabel(pricing: string): string`（types.ts）—— 已知值返回中文，未知/空返回 `''`
- `SiteData.pricing_type?: SitePricing`、`SiteData.requires_login?: boolean`（types.ts）
- `SiteImportResult = { imported: number; updated: number; skipped: number; errors: number }`（sites.ts）
- `importAiDirectoryFromCsv(csvText: string): Promise<SiteImportResult>`（sites.ts）
- `parseCsv(csvText: string): Record<string, string>[]`（backlinks.ts，改 export 后）
- `Dashboard` 新增可选 prop `onImportCsv?: (csvText: string) => Promise<SiteImportResult>`

---

### Task 1: `types.ts` 数据模型 + `pricing_type`/`requires_login` 字段 + 枚举

**Files:**
- Modify: `extension/src/lib/types.ts:47-71`
- Test: `extension/src/__tests__/pricing-label.test.ts`（新建）

**Interfaces:**
- Produces: `SitePricing`、`SITE_PRICINGS`、`getPricingLabel`；`SiteData` 增加 `pricing_type`/`requires_login`。被 Task 2（导入映射）、Task 4（SiteCard 展示/编辑）消费。

- [ ] **Step 1: 写失败测试（新建 `extension/src/__tests__/pricing-label.test.ts`）**

```ts
import { describe, it, expect } from 'vitest'
import { getPricingLabel, SITE_PRICINGS } from '@/lib/types'

describe('getPricingLabel', () => {
	it('已知价格返回中文标签', () => {
		expect(getPricingLabel('free')).toBe('免费')
		expect(getPricingLabel('paid')).toBe('付费')
		expect(getPricingLabel('mixed')).toBe('混合')
	})

	it('未知/空值返回空串（卡片不渲染标签）', () => {
		expect(getPricingLabel('')).toBe('')
		expect(getPricingLabel('unknown')).toBe('')
	})

	it('SITE_PRICINGS 恰为 3 项', () => {
		expect(SITE_PRICINGS).toHaveLength(3)
	})
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix extension run test -- src/__tests__/pricing-label.test.ts`
Expected: FAIL —— `getPricingLabel`/`SITE_PRICINGS` 未导出。

- [ ] **Step 3: 改 `types.ts` —— 加枚举与 label（在 `getCategoryLabel` 函数之后，即 `:59` 之后插入）**

```ts
/** Site pricing — structured enum for the price tier (CSV 免费/付费/混合) */
export type SitePricing = 'free' | 'paid' | 'mixed'

export const SITE_PRICINGS: { value: SitePricing; label: string }[] = [
  { value: 'free', label: '免费' },
  { value: 'paid', label: '付费' },
  { value: 'mixed', label: '混合' },
]

/** Get display label for a pricing value; unknown/empty → '' (不渲染标签). */
export function getPricingLabel(pricing: string): string {
  return SITE_PRICINGS.find((p) => p.value === pricing)?.label ?? ''
}
```

- [ ] **Step 4: 改 `types.ts` —— `SiteData`（`:62-71`）加两字段**

把：
```ts
export interface SiteData {
    name: string
    submit_url: string | null
    category: SiteCategory
    dr: number | null
    status?: string
    monthly_traffic?: number
    pricing?: string
    notes?: string
}
```
改为：
```ts
export interface SiteData {
    name: string
    submit_url: string | null
    category: SiteCategory
    dr: number | null
    status?: string
    monthly_traffic?: number
    pricing?: string
    notes?: string
    pricing_type?: SitePricing
    requires_login?: boolean
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm --prefix extension run test -- src/__tests__/pricing-label.test.ts`
Expected: PASS（3 用例）。

- [ ] **Step 6: build 门禁**

Run: `npm --prefix extension run build`
Expected: 成功（`SiteRecord extends SiteData` 自动获得新字段，下游无不兼容引用）。

- [ ] **Step 7: 提交**

```bash
git add extension/src/lib/types.ts extension/src/__tests__/pricing-label.test.ts
git commit -m "feat(types): SiteData 新增 pricing_type/requires_login 字段与价格枚举"
```

---

### Task 2: 导出 `parseCsv` + `importAiDirectoryFromCsv`

**Files:**
- Modify: `extension/src/lib/backlinks.ts:5`（`parseCsv` 加 export）
- Modify: `extension/src/lib/sites.ts`（新增导入函数）
- Test: `extension/src/__tests__/ai-directory-import.test.ts`（新建）

**Interfaces:**
- Consumes: `parseCsv`、`extractDomain`（backlinks.ts）；`addSite`、`updateSite`、`getSiteByDomain`（db.ts）；`SiteRecord`、`SitePricing`（types.ts，Task 1）。
- Produces: `importAiDirectoryFromCsv(csvText): Promise<SiteImportResult>`、`SiteImportResult`。被 Task 3（App 接线）消费。

- [ ] **Step 1: 写失败测试（新建 `extension/src/__tests__/ai-directory-import.test.ts`）**

```ts
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { importAiDirectoryFromCsv } from '@/lib/sites'
import { bulkPutSites, clearSites, getSiteByDomain } from '@/lib/db'
import type { SiteRecord } from '@/lib/types'

describe('importAiDirectoryFromCsv', () => {
	beforeEach(async () => {
		await clearSites()
	})

	it('新建：domain 不存在 → 插入 ai_directory 站点（dr=null、默认未提交、字段正确）', async () => {
		const csv = '名称,url,价格,需要登录\nProduct Hunt,https://producthunt.com/,免费,是\n'
		const result = await importAiDirectoryFromCsv(csv)
		expect(result.imported).toBe(1)
		expect(result.updated).toBe(0)

		const site = await getSiteByDomain('producthunt.com')
		expect(site).toBeDefined()
		expect(site!.category).toBe('ai_directory')
		expect(site!.dr).toBeNull()
		expect(site!.pricing_type).toBe('free')
		expect(site!.requires_login).toBe(true)
		expect(site!.submit_url).toBe('https://producthunt.com/')
	})

	it('价格/登录中文映射：混合→mixed、否→false', async () => {
		const csv = '名称,url,价格,需要登录\nGoodFirms,https://goodfirms.co/,混合,否\n'
		await importAiDirectoryFromCsv(csv)
		const site = await getSiteByDomain('goodfirms.co')
		expect(site!.pricing_type).toBe('mixed')
		expect(site!.requires_login).toBe(false)
	})

	it('更新去重：domain 已存在 → 仅补两字段，保留原分类/dr/pricing/notes', async () => {
		const existing: SiteRecord = {
			name: 'Product Hunt',
			submit_url: 'https://producthunt.com/old',
			domain: 'producthunt.com',
			category: 'blog_comment',
			dr: 90,
			pricing: 'Free',
			notes: 'keep me',
			createdAt: 1000,
			updatedAt: 1000,
		}
		await bulkPutSites([existing])

		const csv = '名称,url,价格,需要登录\nProduct Hunt,https://producthunt.com/,付费,是\n'
		const result = await importAiDirectoryFromCsv(csv)
		expect(result.updated).toBe(1)
		expect(result.imported).toBe(0)

		const site = await getSiteByDomain('producthunt.com')
		expect(site!.category).toBe('blog_comment')   // 原分类保留
		expect(site!.dr).toBe(90)                       // 原 dr 保留
		expect(site!.pricing).toBe('Free')              // 原 pricing 文本保留
		expect(site!.notes).toBe('keep me')             // 原 notes 保留
		expect(site!.pricing_type).toBe('paid')         // 新字段补充
		expect(site!.requires_login).toBe(true)         // 新字段补充
	})

	it('同 domain 多行：首行新建，后续行更新（按 domain 去重）', async () => {
		const csv = [
			'名称,url,价格,需要登录',
			'Site One,https://example.com/a,免费,是',
			'Site Two,https://example.com/b,付费,否',
		].join('\n')
		const result = await importAiDirectoryFromCsv(csv)
		expect(result.imported).toBe(1)
		expect(result.updated).toBe(1)
		const site = await getSiteByDomain('example.com')
		expect(site!.pricing_type).toBe('paid')        // 被第二行更新
		expect(site!.requires_login).toBe(false)
	})

	it('空 url 行被跳过', async () => {
		const csv = '名称,url,价格,需要登录\n,,免费,是\nReal,https://realsite.com/,免费,否\n'
		const result = await importAiDirectoryFromCsv(csv)
		expect(result.imported).toBe(1)
		expect(result.skipped).toBe(1)
	})

	it('非标准价格/登录值 → 对应字段 undefined', async () => {
		const csv = '名称,url,价格,需要登录\nWeird,https://weird.com/,unknown,maybe\n'
		await importAiDirectoryFromCsv(csv)
		const site = await getSiteByDomain('weird.com')
		expect(site!.pricing_type).toBeUndefined()
		expect(site!.requires_login).toBeUndefined()
	})
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix extension run test -- src/__tests__/ai-directory-import.test.ts`
Expected: FAIL —— `importAiDirectoryFromCsv` 未导出。

- [ ] **Step 3: 改 `backlinks.ts` —— `parseCsv` 加 export（`:5`）**

把：
```ts
function parseCsv(csvText: string): Record<string, string>[] {
```
改为：
```ts
export function parseCsv(csvText: string): Record<string, string>[] {
```

- [ ] **Step 4: 改 `sites.ts` —— 顶部 import 扩展**

把：
```ts
import type { SiteData, SitesDatabase, SiteCategory } from './types'
import { seedSites, listSites } from './db'
```
改为：
```ts
import type { SiteData, SitesDatabase, SiteCategory, SitePricing, SiteRecord } from './types'
import { seedSites, listSites, addSite, updateSite, getSiteByDomain } from './db'
import { parseCsv, extractDomain } from './backlinks'
```

- [ ] **Step 5: 在 `sites.ts` 末尾追加导入函数**

```ts
export interface SiteImportResult {
	imported: number
	updated: number
	skipped: number
	errors: number
}

/** CSV「价格」中文 → 结构化枚举；非标准值 → undefined */
function mapPricingType(raw: string | undefined): SitePricing | undefined {
	const v = raw?.trim()
	if (v === '免费') return 'free'
	if (v === '付费') return 'paid'
	if (v === '混合') return 'mixed'
	return undefined
}

/** CSV「需要登录」中文 → boolean；非标准值 → undefined */
function mapRequiresLogin(raw: string | undefined): boolean | undefined {
	const v = raw?.trim()
	if (v === '是') return true
	if (v === '否') return false
	return undefined
}

/**
 * 导入 AI 目录外链 CSV（表头：名称,url,价格,需要登录）到 sites store。
 * - 按 domain 去重：已存在 → 仅补 pricing_type/requires_login（保留原分类与其余字段）；
 *   不存在 → 新建 category='ai_directory'、dr=null、无 submission（默认未提交）。
 * - 单行异常计入 errors 并继续。
 */
export async function importAiDirectoryFromCsv(csvText: string): Promise<SiteImportResult> {
	const rows = parseCsv(csvText)
	let imported = 0
	let updated = 0
	let skipped = 0
	let errors = 0

	for (const row of rows) {
		try {
			const url = row['url']?.trim()
			if (!url) {
				skipped++
				continue
			}
			const name = row['名称']?.trim() || url
			const domain = extractDomain(url)
			const pricing_type = mapPricingType(row['价格'])
			const requires_login = mapRequiresLogin(row['需要登录'])

			const existing = await getSiteByDomain(domain)
			if (existing) {
				await updateSite({ ...existing, pricing_type, requires_login })
				updated++
			} else {
				const now = Date.now()
				await addSite({
					name,
					submit_url: url,
					category: 'ai_directory',
					dr: null,
					pricing_type,
					requires_login,
					domain,
					createdAt: now,
					updatedAt: now,
				})
				imported++
			}
		} catch {
			errors++
		}
	}

	return { imported, updated, skipped, errors }
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npm --prefix extension run test -- src/__tests__/ai-directory-import.test.ts`
Expected: PASS（6 用例）。

- [ ] **Step 7: build 门禁**

Run: `npm --prefix extension run build`
Expected: 成功；`parseCsv` export 后 `backlinks.ts` 自身用法不变（既 import 自身定义）。

- [ ] **Step 8: 回归既有测试（parseCsv export 不破坏 backlinks 导入）**

Run: `npm --prefix extension run test`
Expected: 全绿。

- [ ] **Step 9: 提交**

```bash
git add extension/src/lib/backlinks.ts extension/src/lib/sites.ts extension/src/__tests__/ai-directory-import.test.ts
git commit -m "feat(sites): 新增 importAiDirectoryFromCsv 按 domain 去重导入 AI 目录外链"
```

---

### Task 3: Dashboard 导入入口 + App 接线

**Files:**
- Modify: `extension/src/components/Dashboard.tsx`（import / `DashboardProps` / 工具栏按钮）
- Modify: `extension/src/entrypoints/sidepanel/App.tsx`（import / `handleImportAiDirectory` / 传 prop）

**Interfaces:**
- Consumes: `importAiDirectoryFromCsv`、`SiteImportResult`（sites.ts，Task 2）；`refreshSites`（useSites）。
- Produces: Dashboard 接受 `onImportCsv` 触发导入并显示「新增/更新/跳过/失败」提示。

> UI 接线任务（无独立单测）；以 build + Task 5 手动矩阵为保证。

- [ ] **Step 1: 改 `Dashboard.tsx` import**

把：
```ts
import { Play, Trash2, Loader2, ExternalLink } from 'lucide-react'
```
改为：
```ts
import { Play, Trash2, Loader2, ExternalLink, Upload } from 'lucide-react'
```

把：
```ts
import { useMemo, useState, useEffect, useCallback } from 'react'
```
改为：
```ts
import { useMemo, useState, useEffect, useCallback, useRef, type ChangeEvent } from 'react'
```

把：
```ts
import type { SiteData, SubmissionRecord, SubmissionStatus, SiteCategory } from '@/lib/types'
```
改为：
```ts
import type { SiteData, SubmissionRecord, SubmissionStatus, SiteCategory } from '@/lib/types'
import type { SiteImportResult } from '@/lib/sites'
```

- [ ] **Step 2: 改 `Dashboard.tsx` —— `DashboardProps`（`:10-23`）加可选 prop**

在 `interface DashboardProps {` 内的 `activeSiteName: string | null` 之前新增一行：
```ts
	onImportCsv?: (csvText: string) => Promise<SiteImportResult>
```

- [ ] **Step 3: 改 `Dashboard.tsx` —— 解构参数 + 内部 state + handler**

把函数签名的解构（`:40-53`）末尾：
```ts
	llmFieldData,
	activeSiteName,
}: DashboardProps) {
```
改为：
```ts
	llmFieldData,
	activeSiteName,
	onImportCsv,
}: DashboardProps) {
```

并在 `const [opening, setOpening] = useState(false)`（`:57`）之后新增：
```ts
	const [importMsg, setImportMsg] = useState<string | null>(null)
	const fileInputRef = useRef<HTMLInputElement>(null)

	const handleImportFile = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (!file || !onImportCsv) return
		try {
			const text = await file.text()
			const r = await onImportCsv(text)
			setImportMsg(`导入完成：新增 ${r.imported} · 更新 ${r.updated} · 跳过 ${r.skipped} · 失败 ${r.errors}`)
			setTimeout(() => setImportMsg(null), 4000)
		} catch {
			setImportMsg('导入失败，请重试')
		} finally {
			if (fileInputRef.current) fileInputRef.current.value = ''
		}
	}, [onImportCsv])
```

- [ ] **Step 4: 改 `Dashboard.tsx` —— 工具栏加导入按钮（`:189` 的 `<div className="flex items-center gap-2">` 内，搜索 `<input>` 之后）**

定位（`:200-206`）：
```tsx
						<input
							type="text"
							placeholder={'搜索站点...'}
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							className="flex-1 px-2.5 py-1.5 text-xs rounded border border-border bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
						/>
```
在其后、`{tab === 'undone' && ...}` 之前插入：
```tsx
						{onImportCsv && (
							<>
								<input
									ref={fileInputRef}
									type="file"
									accept=".csv"
									className="hidden"
									onChange={handleImportFile}
								/>
								<Button
									variant="outline"
									size="xs"
									onClick={() => fileInputRef.current?.click()}
									title="导入 AI 目录 CSV"
								>
									<Upload className="w-3 h-3" />
									{'导入'}
								</Button>
							</>
						)}
```

- [ ] **Step 5: 改 `Dashboard.tsx` —— 显示导入结果提示（`{/* Site list */}` 注释之前）**

定位（`:225`）：
```tsx
					{/* Site list */}
					<div className="flex-1 overflow-y-auto space-y-1.5">
```
在 `{/* Site list */}` 之前插入：
```tsx
					{importMsg && (
						<div className="text-[10px] text-muted-foreground px-1">{importMsg}</div>
					)}
```

- [ ] **Step 6: 改 `App.tsx` —— import + handler**

在 `import { importBacklinksFromCsv } from '@/lib/backlinks'`（`:14`）之后新增：
```ts
import { importAiDirectoryFromCsv } from '@/lib/sites'
```

在 `handleAddSite`（`:126-155`）之后新增：
```ts
	const handleImportAiDirectory = useCallback(async (csvText: string) => {
		const result = await importAiDirectoryFromCsv(csvText)
		await refreshSites()
		return result
	}, [refreshSites])
```

- [ ] **Step 7: 改 `App.tsx` —— Dashboard 渲染处传 prop（`:280-294`）**

在 `<Dashboard ... />` 的 props 中（`activeSiteName={currentEngineSite?.name ?? null}` 之后）新增一行：
```tsx
							onImportCsv={handleImportAiDirectory}
```

- [ ] **Step 8: build 门禁**

Run: `npm --prefix extension run build`
Expected: 成功；`onImportCsv` 可选，未传处（如 options 页若复用 Dashboard）不报错。

- [ ] **Step 9: 回归单测**

Run: `npm --prefix extension run test`
Expected: 全绿。

- [ ] **Step 10: 提交**

```bash
git add extension/src/components/Dashboard.tsx extension/src/entrypoints/sidepanel/App.tsx
git commit -m "feat(dashboard): 外链提交面板新增导入 AI 目录 CSV 入口"
```

---

### Task 4: SiteCard 展示价格/需登录标签 + 编辑表单补两字段

**Files:**
- Modify: `extension/src/components/SiteCard.tsx`

**Interfaces:**
- Consumes: `SITE_PRICINGS`、`getPricingLabel`、`SitePricing`（types.ts，Task 1）。
- Produces: 无新接口；卡片展示 + 编辑可写两个新字段。

> UI 任务（无独立单测）；以 build + Task 5 手动矩阵为保证。

- [ ] **Step 1: 改 `SiteCard.tsx` import（`:3-4`）**

把：
```ts
import type { SiteData, SubmissionStatus, SiteCategory } from '@/lib/types'
import { SITE_CATEGORIES, getCategoryLabel } from '@/lib/types'
```
改为：
```ts
import type { SiteData, SubmissionStatus, SiteCategory, SitePricing } from '@/lib/types'
import { SITE_CATEGORIES, getCategoryLabel, SITE_PRICINGS, getPricingLabel } from '@/lib/types'
```

- [ ] **Step 2: 改 `SiteCard.tsx` —— 卡片分类标签旁加价格/登录标记（`:119-121`）**

把：
```tsx
					<div className="mt-0.5">
						<span className="text-[10px] text-muted-foreground">{getCategoryLabel(site.category)}</span>
					</div>
```
改为：
```tsx
					<div className="mt-0.5 flex items-center gap-1.5">
						<span className="text-[10px] text-muted-foreground">{getCategoryLabel(site.category)}</span>
						{site.pricing_type && (
							<span className="text-[10px] text-muted-foreground">{getPricingLabel(site.pricing_type)}</span>
						)}
						{site.requires_login && (
							<span className="text-[10px] text-amber-600 dark:text-amber-400">需登录</span>
						)}
					</div>
```

- [ ] **Step 3: 改 `SiteCard.tsx` —— 编辑 state 加两项（`:51` `formNotes` 之后）**

在 `const [formNotes, setFormNotes] = useState('')` 之后新增：
```tsx
	const [formPricing, setFormPricing] = useState<SitePricing | ''>('')
	const [formLogin, setFormLogin] = useState<'true' | 'false' | ''>('')
```

- [ ] **Step 4: 改 `SiteCard.tsx` —— `openEdit` 初始化两项（`:53-59`）**

把：
```tsx
	const openEdit = () => {
		setFormUrl(site.submit_url ?? '')
		setFormCategory(site.category)
		setFormDr(site.dr != null ? String(site.dr) : '')
		setFormNotes(site.notes ?? '')
		setEditOpen(true)
	}
```
改为：
```tsx
	const openEdit = () => {
		setFormUrl(site.submit_url ?? '')
		setFormCategory(site.category)
		setFormDr(site.dr != null ? String(site.dr) : '')
		setFormNotes(site.notes ?? '')
		setFormPricing(site.pricing_type ?? '')
		setFormLogin(site.requires_login === undefined ? '' : site.requires_login ? 'true' : 'false')
		setEditOpen(true)
	}
```

- [ ] **Step 5: 改 `SiteCard.tsx` —— `handleSave` data 增补两字段（`:63-68`）**

把：
```tsx
		const data: Partial<SiteData> = {
			submit_url: formUrl.trim() || null,
			category: formCategory,
			dr: formDr.trim() && !isNaN(Number(formDr)) ? Number(formDr) : null,
			notes: formNotes.trim() || undefined,
		}
```
改为：
```tsx
		const data: Partial<SiteData> = {
			submit_url: formUrl.trim() || null,
			category: formCategory,
			dr: formDr.trim() && !isNaN(Number(formDr)) ? Number(formDr) : null,
			notes: formNotes.trim() || undefined,
			pricing_type: formPricing || undefined,
			requires_login: formLogin === '' ? undefined : formLogin === 'true',
		}
```

- [ ] **Step 6: 改 `SiteCard.tsx` —— 编辑 Dialog 加两个 Select（DR Input 之后、备注 Textarea 之前，`:212-218`）**

定位：
```tsx
					<Input
						label="DR 分数"
						type="number"
						value={formDr}
						onChange={(e) => setFormDr(e.target.value)}
						placeholder="留空表示未知"
					/>
					<Textarea
```
在 DR `Input` 的 `/>` 与 `<Textarea` 之间插入：
```tsx
					<Select
						label="价格"
						options={[{ value: '', label: '未知' }, ...SITE_PRICINGS]}
						value={formPricing}
						onChange={(e) => setFormPricing(e.target.value as SitePricing | '')}
					/>
					<Select
						label="需要登录"
						options={[
							{ value: '', label: '未知' },
							{ value: 'true', label: '是' },
							{ value: 'false', label: '否' },
						]}
						value={formLogin}
						onChange={(e) => setFormLogin(e.target.value as 'true' | 'false' | '')}
					/>
```

- [ ] **Step 7: build 门禁**

Run: `npm --prefix extension run build`
Expected: 成功。

- [ ] **Step 8: 回归单测**

Run: `npm --prefix extension run test`
Expected: 全绿。

- [ ] **Step 9: 提交**

```bash
git add extension/src/components/SiteCard.tsx
git commit -m "feat(site-card): 卡片展示价格/需登录标签，编辑表单补两字段"
```

---

### Task 5: 全量验证 + 手动验证矩阵

**Files:** 无（验证任务）

- [ ] **Step 1: 全量单测**

Run: `npm --prefix extension run test`
Expected: 全绿（含新增 `pricing-label`、`ai-directory-import` 两文件，既有用例不破）。

- [ ] **Step 2: 全量 build**

Run: `npm --prefix extension run build`
Expected: 成功，无 TS 报错。

- [ ] **Step 3: 手动验证矩阵（加载扩展，用 `/Users/fuqian/Desktop/tmp/ai_dir_backlinks.csv`）**

| 操作 | 期望 |
|---|---|
| 「外链提交」面板点「导入」→ 选 CSV | 显示「导入完成：新增 X · 更新 Y · 跳过 Z · 失败 N」（4 秒后消失） |
| 切到「未完成」tab | 新导入的 ai_directory 站点均在此（默认未提交） |
| 分类下拉选「AI 目录」 | 列表仅显示 `ai_directory` 站点（含新导入） |
| 卡片展示 | 显示价格徽标（免费/付费/混合）与「需登录」标记（requires_login=true 时） |
| 编辑某导入站点 | Dialog 价格/需要登录回显当前值，可改可存，保存后卡片标签随之更新 |
| 重复导入同一 CSV | 新增数显著下降、更新数上升（同 domain 已存在 → 仅补字段，不重复建） |
| 导入非法/空行 CSV | 不崩溃，跳过/失败计数正确 |

- [ ] **Step 4: 验证通过后更新 spec 状态**

在 `docs/superpowers/specs/2026-07-15-ai-directory-import-design.md` 顶部把「状态：待评审」改为「状态：已实现并验证」。

---

## Self-Review

**1. Spec 覆盖：**
- §4 数据模型（`pricing_type`/`requires_login` + 枚举 + `getPricingLabel`）→ Task 1。✓
- §5 导入流程（parseCsv 复用、中文映射、domain 去重、新建 vs 更新、未提交）→ Task 2。✓
- §6.1 backlinks.ts export parseCsv → Task 2 Step 3。✓
- §6.2 sites.ts importAiDirectoryFromCsv + 映射纯函数 → Task 2。✓
- §6.3 Dashboard 导入按钮 + onImportCsv + 结果提示 → Task 3。✓
- §6.4 SiteCard 展示 + 编辑表单两字段 → Task 4。✓
- §6.5 App.tsx handleImportAiDirectory + 传 prop → Task 3。✓
- §6.6 db.ts 无改动 → 计划未触及 db.ts。✓
- §7 边界（同 domain 去重 / blog_comment 保留分类 / 空 url 跳过 / 非标准值 undefined / 单行 errors）→ Task 2 测试覆盖。✓
- §8 测试 → Task 1（pricing-label）、Task 2（ai-directory-import）、Task 5（手动矩阵）。✓
- §9 手动验证矩阵 → Task 5 Step 3。✓

**2. 占位符扫描：** 无 TBD/TODO/「适当处理」；每个代码步骤含完整代码或确切命令。✓

**3. 类型一致性：** `SitePricing`、`SITE_PRICINGS`、`getPricingLabel`、`SiteImportResult`、`importAiDirectoryFromCsv`、`parseCsv`、`onImportCsv` 签名在各任务间一致；Task 3 的 `onImportCsv` 返回 `Promise<SiteImportResult>` 与 Task 2 产出、Dashboard 内 `r.imported/updated/...` 访问一致；Task 4 的 `formPricing`/`formLogin` 与 `handleSave` 转换一致。✓

无返工项。

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-15-ai-directory-import.md`.
