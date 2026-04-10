# 外链站点删除功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在外链站点列表的每个卡片上添加删除按钮，支持从资源库中移除站点及其提交记录。

**Architecture:** 从底向上逐层添加：数据层新增按站点名批量删除提交记录的函数 → Hook 层暴露 `deleteSite` → UI 层在 SiteCard 和 Dashboard 的失败卡片上添加删除按钮 → App 层处理当前查看站点被删除时的视图回退。

**Tech Stack:** React, TypeScript, IndexedDB (idb), lucide-react icons, Tailwind CSS

---

### Task 1: 数据层 — 新增 `deleteSubmissionsBySite`

**Files:**
- Modify: `extension/src/lib/db.ts:193-256`

- [ ] **Step 1: 在 db.ts 的 Site CRUD 区域之后、Backlink CRUD 之前，新增 `deleteSubmissionsBySite` 函数**

在 `bulkPutSites` 函数之后（第 255 行）添加：

```typescript
export async function deleteSubmissionsBySite(siteName: string): Promise<void> {
	const db = await getDB()
	const tx = db.transaction('submissions', 'readwrite')
	let cursor = await tx.store.index('by-site').openCursor(siteName)
	while (cursor) {
		await cursor.delete()
		cursor = await cursor.continue()
	}
	await tx.done
}
```

- [ ] **Step 2: 运行构建确认类型无误**

Run: `cd extension && npm run build 2>&1 | tail -5`
Expected: Build succeeds with no type errors.

- [ ] **Step 3: Commit**

```bash
git add extension/src/lib/db.ts
git commit -m "feat: add deleteSubmissionsBySite to db layer"
```

---

### Task 2: Hook 层 — 在 `useSites` 中暴露 `deleteSite`

**Files:**
- Modify: `extension/src/hooks/useSites.ts`

- [ ] **Step 1: 添加 import 和更新接口类型**

在 `useSites.ts` 顶部，更新 import 行以加入新的 db 函数：

```typescript
import { listSubmissionsByProduct, saveSubmission, updateSubmission, deleteSite, deleteSubmissionsBySite } from '@/lib/db'
```

更新 `UseSitesResult` 接口，添加 `deleteSite` 方法：

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
	deleteSite: (siteName: string) => Promise<void>
}
```

- [ ] **Step 2: 在 hook 函数体中实现 `deleteSite` 回调并返回**

在 `updateStatus` 回调之后（约第 110 行）、`return` 语句之前，添加：

```typescript
	const handleDeleteSite = useCallback(
		async (siteName: string) => {
			await deleteSite(siteName)
			await deleteSubmissionsBySite(siteName)
			await refresh()
		},
		[refresh]
	)
```

更新 return 对象，加入 `deleteSite: handleDeleteSite`：

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
		deleteSite: handleDeleteSite,
	}
```

- [ ] **Step 3: 运行构建确认无误**

Run: `cd extension && npm run build 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add extension/src/hooks/useSites.ts
git commit -m "feat: expose deleteSite in useSites hook"
```

---

### Task 3: UI 层 — SiteCard 添加删除按钮

**Files:**
- Modify: `extension/src/components/SiteCard.tsx`

- [ ] **Step 1: 更新 props 接口和导入 Trash2 图标**

在 `SiteCard.tsx` 顶部添加 lucide-react 导入：

```typescript
import { Trash2 } from 'lucide-react'
import type { SiteData, SubmissionStatus } from '@/lib/types'
```

更新 `SiteCardProps` 接口，加入 `onDelete`：

```typescript
interface SiteCardProps {
	site: SiteData
	status?: SubmissionStatus
	onSelect?: (site: SiteData) => void
	onDelete?: (siteName: string) => void
}
```

- [ ] **Step 2: 更新组件函数签名，在右侧徽章区域添加删除按钮**

更新函数签名：

```typescript
export function SiteCard({ site, status = 'not_started', onSelect, onDelete }: SiteCardProps) {
```

将右侧徽章区域（`{/* Right badges */}` 注释部分）替换为：

```typescript
			{/* Right: delete + status badge */}
			<div className="shrink-0 flex items-center gap-1">
				{onDelete && (
					<button
						type="button"
						className="p-1 rounded text-muted-foreground/50 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
						onClick={(e) => {
							e.stopPropagation()
							if (confirm(`确定要删除「${site.name}」吗？该站点的提交记录也将被删除。`)) {
								onDelete(site.name)
							}
						}}
						title="删除站点"
					>
						<Trash2 className="w-3.5 h-3.5" />
					</button>
				)}
				<div className="flex flex-col items-end gap-1">
					{labelKey && (
						<span className="text-[9px] text-muted-foreground">{labelKey}</span>
					)}
				</div>
			</div>
```

- [ ] **Step 3: 运行构建确认无误**

Run: `cd extension && npm run build 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add extension/src/components/SiteCard.tsx
git commit -m "feat: add delete button to SiteCard"
```

---

### Task 4: UI 层 — Dashboard 传递 delete 回调 + 失败 Tab 卡片添加删除

**Files:**
- Modify: `extension/src/components/Dashboard.tsx`

- [ ] **Step 1: 更新 DashboardProps 接口**

在 `DashboardProps` 中添加 `onDeleteSite`：

```typescript
interface DashboardProps {
	sites: SiteData[]
	submissions: Map<string, SubmissionRecord>
	onSelectSite: (site: SiteData) => void
	onRetrySite?: (site: SiteData) => void
	onDeleteSite?: (siteName: string) => void
	batchCount: number
	onBatchCountChange: (count: number) => void
	batchRunning: boolean
	batchCurrentIndex: number
	batchTotal: number
	batchCurrentSite: string
	onStartBatch: () => void
	onStopBatch: () => void
}
```

- [ ] **Step 2: 解构新 prop**

在 Dashboard 组件的解构中添加 `onDeleteSite`：

```typescript
export function Dashboard({
	sites,
	submissions,
	onSelectSite,
	onRetrySite,
	onDeleteSite,
	batchCount,
	onBatchCountChange,
	batchRunning,
	batchCurrentIndex,
	batchTotal,
	batchCurrentSite,
	onStartBatch,
	onStopBatch,
}: DashboardProps) {
```

- [ ] **Step 3: 为 SiteCard 传递 onDelete**

在 "all" 和 "done" Tab 的 `<SiteCard>` 渲染中（约第 199-206 行），添加 `onDelete` prop：

```typescript
					displaySites.map((site) => (
						<SiteCard
							key={site.name}
							site={site}
							status={submissions.get(site.name)?.status ?? 'not_started'}
							onSelect={onSelectSite}
							onDelete={onDeleteSite}
						/>
					))
```

- [ ] **Step 4: 为失败 Tab 的内联卡片添加删除按钮**

在失败 Tab 的内联卡片中（约第 168-197 行），在 `"重试自动提交"` 之前添加删除按钮。需要在 `lucide-react` 导入中加入 `Trash2`：

在文件顶部 import 区域添加：

```typescript
import { Trash2 } from 'lucide-react'
```

替换失败卡片的右侧内容区域。将原来的：

```typescript
								<span className="text-[10px] text-primary shrink-0 mt-0.5">{'重试自动提交'}</span>
```

替换为：

```typescript
								<div className="shrink-0 flex items-center gap-1.5 mt-0.5">
									<button
										type="button"
										className="p-1 rounded text-muted-foreground/50 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
										onClick={(e) => {
											e.stopPropagation()
											if (confirm(`确定要删除「${site.name}」吗？该站点的提交记录也将被删除。`)) {
												onDeleteSite?.(site.name)
											}
										}}
										title="删除站点"
									>
										<Trash2 className="w-3.5 h-3.5" />
									</button>
									<span className="text-[10px] text-primary">{'重试自动提交'}</span>
								</div>
```

- [ ] **Step 5: 运行构建确认无误**

Run: `cd extension && npm run build 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add extension/src/components/Dashboard.tsx
git commit -m "feat: wire delete callback through Dashboard"
```

---

### Task 5: App 层 — 传递 deleteSite 回调 + 处理视图回退

**Files:**
- Modify: `extension/src/entrypoints/sidepanel/App.tsx`

- [ ] **Step 1: 从 useSites 解构 deleteSite**

在 `App.tsx` 中，找到 `useSites` 的解构（约第 28 行），添加 `deleteSite`：

```typescript
	const { sites, submissions, loading: sitesLoading, markSubmitted, markSkipped, markFailed, deleteSite } = useSites(activeProduct?.id ?? null)
```

- [ ] **Step 2: 创建 handleDeleteSite 回调，处理当前查看站点被删除时的视图回退**

在 `App.tsx` 中，在 `useSites` 调用之后、其他 hooks 之前（约第 30 行），添加：

```typescript
	const handleDeleteSite = useCallback(
		async (siteName: string) => {
			await deleteSite(siteName)
			if (view.name === 'site-detail' && view.site.name === siteName) {
				setView({ name: 'dashboard' })
			}
		},
		[deleteSite, view]
	)
```

- [ ] **Step 3: 将 onDeleteSite 传递给 Dashboard**

在 `<Dashboard>` 组件调用中（约第 392-405 行），添加 `onDeleteSite` prop：

```typescript
						<Dashboard
							sites={sites}
							submissions={submissions}
							onSelectSite={(site) => { reset(); setAgentError(null); setView({ name: 'site-detail', site }) }}
							onRetrySite={(site) => { reset(); setAgentError(null); setView({ name: 'site-detail', site }) }}
							onDeleteSite={handleDeleteSite}
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

- [ ] **Step 4: 运行构建确认无误**

Run: `cd extension && npm run build 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add extension/src/entrypoints/sidepanel/App.tsx
git commit -m "feat: wire site delete with view rollback in App"
```

---

## Self-Review

### Spec Coverage
| Spec 要求 | Task |
|-----------|------|
| SiteCard 添加删除按钮 | Task 3 |
| Dashboard 失败 Tab 添加删除按钮 | Task 4 |
| 确认对话框 | Task 3, Task 4 |
| 删除站点 + 提交记录 | Task 1 + Task 2 |
| Hook 暴露 deleteSite | Task 2 |
| 删除后自动刷新列表 | Task 2 (refresh) |
| 当前查看站点被删除时回退 | Task 5 |

### Placeholder Scan
无 TBD/TODO，所有步骤包含完整代码。

### Type Consistency
- `deleteSubmissionsBySite(siteName: string)` 在 Task 1 定义，Task 2 中调用 — 签名一致
- `onDelete?: (siteName: string) => void` 在 SiteCard (Task 3) 和 Dashboard (Task 4) 中一致
- `onDeleteSite?: (siteName: string) => void` 在 Dashboard (Task 4) 和 App (Task 5) 中一致
