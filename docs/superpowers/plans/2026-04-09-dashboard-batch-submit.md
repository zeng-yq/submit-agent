# Dashboard 批量提交与失败视图 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除 Dashboard 的"推荐"标签，新增"失败"标签页和批量提交功能（顺序自动提交前 N 条站点，自动跳过失败）。

**Architecture:** 数据层先扩展（SubmissionRecord 新增字段 + markFailed），再改 UI 层（Dashboard tabs + 批量提交栏），最后实现 App.tsx 的批量协调逻辑（视图切换 + autoStart）。批量状态存储在 App.tsx 的 React state 中，通过 props 向下传递给 Dashboard 和 SubmitFlow。

**Tech Stack:** React + TypeScript, WXT (Chrome extension framework), Tailwind CSS v4, IndexedDB (idb)

---

### Task 1: 扩展 SubmissionRecord 类型和 IndexedDB

**Files:**
- Modify: `extension/src/lib/types.ts:30-40`
- Modify: `extension/src/lib/db.ts:6-7`

- [ ] **Step 1: 在 SubmissionRecord 中新增 `error` 和 `failedAt` 字段**

在 `extension/src/lib/types.ts` 的 `SubmissionRecord` 接口中，在 `notes?: string` 后新增两个字段：

```typescript
export interface SubmissionRecord {
	id: string
	siteName: string
	productId: string
	status: SubmissionStatus
	rewrittenDesc?: string
	submittedAt?: number
	notes?: string
	error?: string        // 失败时的错误信息
	failedAt?: number     // 失败时间戳 (Date.now())
	createdAt: number
	updatedAt: number
}
```

- [ ] **Step 2: 升级 IndexedDB 版本以兼容新字段**

在 `extension/src/lib/db.ts` 中：
- 将 `DB_VERSION` 从 `3` 改为 `4`
- 在 `upgrade` 函数中新增 `if (oldVersion < 4) { /* no schema changes needed, just version bump */ }`

IndexedDB 是 schema-less 的（key-value store），新增可选字段不需要 index 变更，只需要递增版本号让现有数据库触发 upgrade：

```typescript
const DB_VERSION = 4

// inside upgrade function, after the oldVersion < 3 block:
if (oldVersion < 4) {
  // Schema-less: new optional fields (error, failedAt) need no index changes
}
```

- [ ] **Step 3: 验证构建通过**

Run: `cd extension && npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add extension/src/lib/types.ts extension/src/lib/db.ts
git commit -m "feat: add error and failedAt fields to SubmissionRecord"
```

---

### Task 2: 在 useSites hook 中新增 markFailed 函数

**Files:**
- Modify: `extension/src/hooks/useSites.ts:6-14,86-95`

- [ ] **Step 1: 在 UseSitesResult 接口中新增 markFailed**

在 `extension/src/hooks/useSites.ts` 的 `UseSitesResult` 接口中，在 `markSkipped` 后新增：

```typescript
export interface UseSitesResult {
	sites: SiteData[]
	submissions: Map<string, SubmissionRecord>
	loading: boolean
	refresh: () => Promise<void>
	markSubmitted: (siteName: string, productId: string) => Promise<void>
	markSkipped: (siteName: string, productId: string) => Promise<void>
	markFailed: (siteName: string, productId: string, error?: string) => Promise<void>
	updateStatus: (record: SubmissionRecord) => Promise<void>
}
```

- [ ] **Step 2: 实现 markFailed 函数**

在 `useSites` 函数体中，`markSkipped` 之后新增 `markFailed`：

```typescript
const markFailed = useCallback(
	async (siteName: string, productId: string, error?: string) => {
		const existing = submissions.get(siteName)
		const now = Date.now()
		if (existing) {
			await updateSubmission({
				...existing,
				status: 'failed',
				error: error ?? '',
				failedAt: now,
			})
		} else {
			await saveSubmission({
				siteName,
				productId,
				status: 'failed',
				error: error ?? '',
				failedAt: now,
			})
		}
		await refresh()
	},
	[submissions, refresh]
)
```

- [ ] **Step 3: 在返回值中包含 markFailed**

在 `useSites` 的 return 语句中，在 `markSkipped` 后添加 `markFailed`：

```typescript
return {
	sites,
	submissions,
	loading,
	refresh,
	markSubmitted,
	markSkipped,
	markFailed,
	updateStatus,
}
```

- [ ] **Step 4: 验证构建通过**

Run: `cd extension && npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 5: Commit**

```bash
git add extension/src/hooks/useSites.ts
git commit -m "feat: add markFailed function to useSites hook"
```

---

### Task 3: 新增 i18n 翻译文本

**Files:**
- Modify: `extension/src/lib/i18n.ts`

- [ ] **Step 1: 在英文词典中新增批量提交和失败相关的翻译**

在 `extension/src/lib/i18n.ts` 的 `en` 对象中，`dashboard.emptyDone` 行后新增：

```typescript
'dashboard.failed': 'Failed',
'dashboard.emptyFailed': 'No failed submissions',
'dashboard.batchCount': 'Batch size',
'dashboard.startBatch': 'Start Batch Submit',
'dashboard.batchProgress': 'Submitting {current}/{total}  {site}',
'dashboard.stopBatch': 'Stop',
```

在 `en` 对象中，删除 `'dashboard.recommended': 'Recommended',` 行和 `'dashboard.emptyRecommended': 'All recommended sites are done!',` 行。

- [ ] **Step 2: 在中文词典中新增对应翻译**

在 `zh` 对象中，`dashboard.emptyDone` 行后新增：

```typescript
'dashboard.failed': '失败',
'dashboard.emptyFailed': '暂无失败记录',
'dashboard.batchCount': '提交数量',
'dashboard.startBatch': '开始批量提交',
'dashboard.batchProgress': '正在提交 {current}/{total}  {site}',
'dashboard.stopBatch': '停止',
```

在 `zh` 对象中，删除 `'dashboard.recommended': '推荐',` 行和 `'dashboard.emptyRecommended': '所有推荐站点已完成！',` 行。

- [ ] **Step 3: 验证构建通过**

Run: `cd extension && npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add extension/src/lib/i18n.ts
git commit -m "feat: add i18n translations for batch submit and failed tab"
```

---

### Task 4: 重构 Dashboard 组件（删除推荐 Tab，新增失败 Tab，新增批量 UI）

**Files:**
- Modify: `extension/src/components/Dashboard.tsx`

- [ ] **Step 1: 重写 Dashboard.tsx**

完全重写 `extension/src/components/Dashboard.tsx`，做以下变更：

1. 删除 `Tab` 类型中的 `'recommended'`，改为 `'all' | 'done' | 'failed'`
2. 删除 `RECOMMENDED_LIMIT` 常量
3. 删除 `recommendedSites` useMemo
4. 新增 `failedSites` useMemo：筛选 `status === 'failed'` 的站点
5. 新增 props：`batchCount`, `batchRunning`, `batchCurrentIndex`, `batchTotal`, `batchCurrentSite`, `onStartBatch`, `onStopBatch`
6. 默认 tab 改为 `'all'`
7. 在进度条和 tab 栏之间新增批量提交 UI 区域
8. tabs 数组替换为 `all | done | failed`
9. 失败 tab 中的每条记录显示失败时间和错误信息，并有"重试"按钮

```tsx
import type { SiteData, SubmissionRecord, SubmissionStatus } from '@/lib/types'
import { useMemo, useState } from 'react'
import { useT } from '@/hooks/useLanguage'
import { SiteCard } from './SiteCard'

interface DashboardProps {
	sites: SiteData[]
	submissions: Map<string, SubmissionRecord>
	onSelectSite: (site: SiteData) => void
	onRetrySite?: (site: SiteData) => void
	batchCount: number
	onBatchCountChange: (count: number) => void
	batchRunning: boolean
	batchCurrentIndex: number
	batchTotal: number
	batchCurrentSite: string
	onStartBatch: () => void
	onStopBatch: () => void
}

type Tab = 'all' | 'done' | 'failed'

const DONE_STATUSES: SubmissionStatus[] = ['submitted', 'approved', 'skipped']

export function Dashboard({
	sites,
	submissions,
	onSelectSite,
	onRetrySite,
	batchCount,
	onBatchCountChange,
	batchRunning,
	batchCurrentIndex,
	batchTotal,
	batchCurrentSite,
	onStartBatch,
	onStopBatch,
}: DashboardProps) {
	const t = useT()
	const [tab, setTab] = useState<Tab>('all')
	const [search, setSearch] = useState('')

	const submittableSites = useMemo(
		() => sites.filter((s) => !!s.submit_url),
		[sites]
	)

	const stats = useMemo(() => {
		let submitted = 0
		for (const sub of submissions.values()) {
			if (sub.status === 'submitted' || sub.status === 'approved') submitted++
		}
		return { submitted, total: submittableSites.length }
	}, [submittableSites, submissions])

	const allSites = useMemo(() => {
		const q = search.toLowerCase()
		return sites
			.filter((s) => !q || s.name.toLowerCase().includes(q) || s.category?.toLowerCase().includes(q))
			.sort((a, b) => (b.dr ?? 0) - (a.dr ?? 0))
	}, [sites, search])

	const doneSites = useMemo(() => {
		return sites.filter((s) => {
			const status = submissions.get(s.name)?.status
			return status && DONE_STATUSES.includes(status)
		})
	}, [sites, submissions])

	const failedSites = useMemo(() => {
		return sites.filter((s) => {
			const status = submissions.get(s.name)?.status
			return status === 'failed'
		})
	}, [sites, submissions])

	const pct = stats.total > 0 ? Math.round((stats.submitted / stats.total) * 100) : 0

	const tabs: { id: Tab; label: string; count: number }[] = [
		{ id: 'all', label: t('dashboard.all'), count: allSites.length },
		{ id: 'done', label: t('dashboard.done'), count: doneSites.length },
		{ id: 'failed', label: t('dashboard.failed'), count: failedSites.length },
	]

	const displaySites =
		tab === 'all' ? allSites : tab === 'done' ? doneSites : failedSites

	return (
		<div className="flex flex-col gap-2 h-full">
			{/* Progress */}
			<div className="px-1 space-y-1">
				<div className="flex items-center justify-between">
					<span className="text-xs font-medium">
						{t('dashboard.submitted', { submitted: stats.submitted, total: stats.total })}
					</span>
					<span className="text-xs text-muted-foreground">{pct}%</span>
				</div>
				<div className="h-1.5 rounded-full bg-muted overflow-hidden">
					<div
						className="h-full rounded-full bg-primary transition-all"
						style={{ width: `${pct}%` }}
					/>
				</div>
			</div>

			{/* Batch submit bar */}
			<div className="px-1">
				{batchRunning ? (
					<div className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950">
						<span className="text-xs text-blue-600 dark:text-blue-400 shrink-0">
							{t('dashboard.batchProgress', {
								current: batchCurrentIndex,
								total: batchTotal,
								site: batchCurrentSite,
							})}
						</span>
						<button
							type="button"
							className="ml-auto text-xs text-red-600 dark:text-red-400 hover:underline shrink-0"
							onClick={onStopBatch}
						>
							{t('dashboard.stopBatch')}
						</button>
					</div>
				) : (
					<div className="flex items-center gap-2">
						<span className="text-xs text-muted-foreground">{t('dashboard.batchCount')}</span>
						<select
							className="text-xs bg-background border border-border rounded-md px-2 py-1 h-7"
							value={batchCount}
							onChange={(e) => onBatchCountChange(Number(e.target.value))}
						>
							<option value={10}>10</option>
							<option value={20}>20</option>
							<option value={50}>50</option>
						</select>
						<button
							type="button"
							className="ml-auto text-xs font-medium text-primary hover:underline"
							onClick={onStartBatch}
						>
							{t('dashboard.startBatch')}
						</button>
					</div>
				)}
			</div>

			{/* Tabs */}
			<div className="flex gap-0 border-b">
				{tabs.map((tabItem) => (
					<button
						key={tabItem.id}
						type="button"
						onClick={() => setTab(tabItem.id)}
						className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
							tab === tabItem.id
								? 'border-primary text-foreground'
								: 'border-transparent text-muted-foreground hover:text-foreground'
						}`}
					>
						{tabItem.label}
						<span className="ml-1 text-[10px] text-muted-foreground">{tabItem.count}</span>
					</button>
				))}
			</div>

			{/* Search (All tab only) */}
			{tab === 'all' && (
				<input
					type="text"
					placeholder={t('dashboard.searchPlaceholder')}
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					className="w-full px-2.5 py-1.5 text-xs rounded border border-border bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
				/>
			)}

			{/* Site list */}
			<div className="flex-1 overflow-y-auto space-y-1.5">
				{tab === 'failed' ? (
					// Failed tab: show error details
					failedSites.map((site) => {
						const sub = submissions.get(site.name)
						return (
							<div
								key={site.name}
								className="relative flex items-start gap-3 rounded-lg border border-red-200 dark:border-red-800 px-3 py-2.5 cursor-pointer hover:bg-accent/30 transition-colors"
								onClick={() => onRetrySite?.(site)}
							>
								<div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-red-400" />
								<div className="shrink-0 text-center w-8">
									<div className="text-sm font-bold tabular-nums">{site.dr}</div>
									<div className="text-[9px] text-muted-foreground uppercase tracking-wide">DR</div>
								</div>
								<div className="flex-1 min-w-0">
									<div className="text-xs font-medium truncate">{site.name}</div>
									{sub?.failedAt && (
										<div className="text-[10px] text-muted-foreground mt-0.5">
											{new Date(sub.failedAt).toLocaleString()}
										</div>
									)}
									{sub?.error && (
										<div className="text-[10px] text-red-600 dark:text-red-400 mt-0.5 truncate">
											{sub.error}
										</div>
									)}
								</div>
								<span className="text-[10px] text-primary shrink-0 mt-0.5">{t('submitFlow.retryAutoSubmit')}</span>
							</div>
						)
					})
				) : (
					displaySites.map((site) => (
						<SiteCard
							key={site.name}
							site={site}
							status={submissions.get(site.name)?.status ?? 'not_started'}
							onSelect={onSelectSite}
						/>
					))
				)}
				{displaySites.length === 0 && (
					<div className="text-center text-xs text-muted-foreground py-8">
						{tab === 'all' && t('dashboard.emptyAll')}
						{tab === 'done' && t('dashboard.emptyDone')}
						{tab === 'failed' && t('dashboard.emptyFailed')}
					</div>
				)}
			</div>
		</div>
	)
}
```

- [ ] **Step 2: 验证构建通过**

Run: `cd extension && npx tsc --noEmit`
Expected: 无类型错误（可能因为 App.tsx 尚未传入新 props 而报错，这是预期的）

- [ ] **Step 3: Commit**

```bash
git add extension/src/components/Dashboard.tsx
git commit -m "feat: replace recommended tab with failed tab and batch submit UI in Dashboard"
```

---

### Task 5: 在 App.tsx 中实现批量提交协调逻辑

**Files:**
- Modify: `extension/src/entrypoints/sidepanel/App.tsx`

- [ ] **Step 1: 新增批量提交相关的 state 和逻辑**

在 `App.tsx` 中做以下变更：

1. 从 `useSites` 解构中新增 `markFailed`
2. 新增批量提交相关的 state：`batchCount`, `batchRunning`, `batchSites`, `batchCurrentIndex`, `batchStopRequested`
3. 新增 `useRef` 来追踪批量模式（`batchModeRef`）
4. 实现 `startBatch` 函数：从 submittableSites 中取前 N 条 not_started 的站点
5. 实现 `stopBatch` 函数：设置停止标志
6. 实现 `advanceBatch` 函数：在站点完成后，自动导航到下一个站点
7. 修改 Dashboard 的 props 传入
8. 修改 SubmitFlow 的 `onBack` 和 `onMarkSubmitted` 以支持批量模式
9. 新增 `onRetrySite` prop 传递给 Dashboard

在 `App.tsx` 顶部新增 import：

```typescript
import { useState, useRef, useEffect, useCallback } from 'react'
```

（`useCallback` 可能已通过其他 import 存在，检查现有 import 行。如果没有 `useCallback`，添加它。）

在 `App` 组件中，在 `const [agentError, setAgentError] = useState<string | null>(null)` 之后新增：

```typescript
// Batch submit state
const [batchCount, setBatchCount] = useState(20)
const [batchRunning, setBatchRunning] = useState(false)
const [batchSites, setBatchSites] = useState<SiteData[]>([])
const [batchCurrentIndex, setBatchCurrentIndex] = useState(0)
const batchStopRef = useRef(false)
const batchModeRef = useRef(false)
```

新增批量函数（在 float-fill useEffect 之后）：

```typescript
const startBatch = useCallback(() => {
	const notStarted = sites
		.filter((s) => !!s.submit_url && (submissions.get(s.name)?.status ?? 'not_started') === 'not_started')
		.sort((a, b) => (b.dr ?? 0) - (a.dr ?? 0))
		.slice(0, batchCount)

	if (notStarted.length === 0) return

	setBatchSites(notStarted)
	setBatchCurrentIndex(0)
	setBatchRunning(true)
	batchStopRef.current = false
	batchModeRef.current = true
	setView({ name: 'site-detail', site: notStarted[0] })
}, [sites, submissions, batchCount])

const stopBatch = useCallback(() => {
	batchStopRef.current = true
	setBatchRunning(false)
	batchModeRef.current = false
}, [])

const advanceBatch = useCallback(() => {
	if (batchStopRef.current || !batchModeRef.current) {
		setBatchRunning(false)
		batchModeRef.current = false
		setView({ name: 'dashboard' })
		return
	}

	const nextIndex = batchCurrentIndex + 1
	if (nextIndex >= batchSites.length) {
		setBatchRunning(false)
		batchModeRef.current = false
		setView({ name: 'dashboard' })
		return
	}

	setBatchCurrentIndex(nextIndex)
	reset()
	setAgentError(null)
	setView({ name: 'site-detail', site: batchSites[nextIndex] })
}, [batchCurrentIndex, batchSites, reset])
```

- [ ] **Step 2: 修改 Dashboard 的调用以传入新 props**

在 App.tsx 的 Dashboard 渲染处（约第 296-300 行），替换为：

```tsx
<Dashboard
	sites={sites}
	submissions={submissions}
	onSelectSite={(site) => { reset(); setAgentError(null); setView({ name: 'site-detail', site }) }}
	onRetrySite={(site) => { reset(); setAgentError(null); setView({ name: 'site-detail', site }) }}
	batchCount={batchCount}
	onBatchCountChange={setBatchCount}
	batchRunning={batchRunning}
	batchCurrentIndex={batchCurrentIndex + 1}
	batchTotal={batchSites.length}
	batchCurrentSite={batchSites[batchCurrentIndex]?.name ?? ''}
	onStartBatch={startBatch}
	onStopBatch={stopBatch}
/>
```

- [ ] **Step 3: 修改 SubmitFlow 的 site-detail 视图以支持批量模式**

在 App.tsx 的 `view.name === 'site-detail'` 分支中（约第 133-158 行），做以下变更：

1. SubmitFlow 新增 `autoStart` 和 `onMarkSubmitted` 回调修改
2. `onBack` 在批量模式下调用 `stopBatch`
3. `onMarkSubmitted` 在批量模式下调用 `advanceBatch`
4. agent 成功完成后自动触发（使用 useEffect 监听 agentStatus）

将 site-detail 视图替换为：

```tsx
if (view.name === 'site-detail') {
	return (
		<div className="flex flex-col h-screen bg-background">
			<SubmitFlow
				site={view.site}
				product={activeProduct!}
				submission={submissions.get(view.site.name)}
				agentStatus={agentStatus}
				agentHistory={history}
				agentActivity={activity}
				agentError={agentError}
				onStartSubmit={async () => {
					setAgentError(null)
					try {
						await startSubmission(view.site, activeProduct!)
					} catch (err) {
						setAgentError(err instanceof Error ? err.message : String(err))
					}
				}}
				onStop={stop}
				onBack={() => {
					if (batchModeRef.current) {
						stopBatch()
					}
					reset()
					setAgentError(null)
					setView({ name: 'dashboard' })
				}}
				onMarkSubmitted={async () => {
					await markSubmitted(view.site.name, activeProduct!.id)
					if (batchModeRef.current) {
						advanceBatch()
					} else {
						setView({ name: 'dashboard' })
					}
				}}
				onSkip={async () => {
					await markSkipped(view.site.name, activeProduct!.id)
					if (batchModeRef.current) {
						advanceBatch()
					} else {
						setView({ name: 'dashboard' })
					}
				}}
			/>
		</div>
	)
}
```

- [ ] **Step 4: 新增 useEffect 在批量模式下自动开始 agent**

在 `App` 组件中，在现有的 `useEffect` 块之后，新增：

```typescript
// Auto-start agent in batch mode
useEffect(() => {
	if (!batchModeRef.current || view.name !== 'site-detail' || agentStatus !== 'idle') return
	const doStart = async () => {
		setAgentError(null)
		try {
			await startSubmission(view.site, activeProduct!)
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			setAgentError(msg)
			if (batchModeRef.current && activeProduct) {
				await markFailed(view.site.name, activeProduct.id, msg)
				advanceBatch()
			}
		}
	}
	doStart()
}, [view.name])  // only re-run when view changes
```

- [ ] **Step 5: 验证构建通过**

Run: `cd extension && npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 6: Commit**

```bash
git add extension/src/entrypoints/sidepanel/App.tsx
git commit -m "feat: implement batch submit coordination logic in App"
```

---

### Task 6: 更新 SubmitFlow 组件以支持 submission prop 和批量模式行为

**Files:**
- Modify: `extension/src/components/SubmitFlow.tsx:12-25`

- [ ] **Step 1: 更新 SubmitFlowProps 接口**

SubmitFlow 已经有 `submission` 作为可选 prop，但需要确保 `onMarkSubmitted` 和 `onSkip` 是 async 的（因为现在它们需要 await markFailed/markSubmitted）。当前接口定义中没有 async 标注，但 TypeScript 函数类型天然兼容 async。检查现有调用签名是否一致。

当前 `SubmitFlowProps`：
```typescript
interface SubmitFlowProps {
	site: SiteData
	product: ProductProfile | null
	submission?: SubmissionRecord
	agentStatus: AgentStatus
	agentActivity: AgentActivity | null
	agentHistory: HistoricalEvent[]
	agentError: string | null
	onStartSubmit: () => void
	onStop: () => void
	onMarkSubmitted: () => void
	onSkip: () => void
	onBack: () => void
}
```

这些回调在 App.tsx 中现在是 async 函数。由于 `() => void` 类型兼容 `() => Promise<void>`，不需要修改类型签名。无需变更。

- [ ] **Step 2: 验证构建通过**

Run: `cd extension && npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 3: Commit (if any changes were needed)**

如果没有变更，跳过此 commit。

---

### Task 7: 集成测试 — 手动验证

**Files:**
- None (manual testing only)

- [ ] **Step 1: 构建并加载扩展**

Run: `cd extension && npm run build`

在 Chrome 中加载 `extension/.output/chrome-mv3/` 作为未打包扩展。

- [ ] **Step 2: 验证 Dashboard tab 变更**

1. 打开侧面板
2. 确认只有三个 tab：全部、已完成、失败
3. 确认默认显示"全部" tab
4. 确认"推荐" tab 已消失

- [ ] **Step 3: 验证批量提交 UI**

1. 在 Dashboard 顶部确认有 select 下拉框（10/20/50）和"开始批量提交"按钮
2. 点击"开始批量提交"，确认进入批量模式，显示进度条和停止按钮
3. 点击"停止"，确认退出批量模式

- [ ] **Step 4: 验证失败 tab**

1. 手动让某个提交失败（断网后尝试提交）
2. 返回 Dashboard，确认"失败" tab 计数更新
3. 点击"失败" tab，确认显示站点名称、失败时间、错误信息
4. 点击失败记录，确认跳转到 SubmitFlow 并可以重试

- [ ] **Step 5: 验证批量提交流程**

1. 选择数量为 2
2. 点击"开始批量提交"
3. 确认自动打开第一个站点的 SubmitFlow 并自动开始 agent
4. Agent 完成后，确认"标记为已提交"后自动跳到下一个站点
5. 全部完成后确认回到 Dashboard

- [ ] **Step 6: Commit (final)**

如果一切正常，可以创建一个 summary commit 或直接继续。
