# 站点编辑弹窗实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在外链提交面板的每条站点卡片上添加编辑按钮和弹窗，支持编辑所有站点字段，并将分类编辑从内联迁移到弹窗中。

**Architecture:** 新建 Dialog 基础 UI 组件，在 SiteCard 中添加编辑按钮触发弹窗，弹窗内管理表单状态并回调父组件保存。useSites hook 新增 `updateSite` 方法，通过 `getDB()` 读取现有记录、合并字段后写回。

**Tech Stack:** React 19, Tailwind CSS 4, lucide-react, idb (IndexedDB)

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `extension/src/components/ui/Dialog.tsx` | 新增 | 可复用的 Dialog 基础组件（遮罩 + 居中卡片 + ESC/遮罩关闭） |
| `extension/src/components/SiteCard.tsx` | 修改 | 添加编辑按钮、移除 CategoryEditor、内嵌编辑弹窗 |
| `extension/src/hooks/useSites.ts` | 修改 | 新增 `updateSite` 方法 |
| `extension/src/components/Dashboard.tsx` | 修改 | 将 `onCategoryChange` prop 改为 `onSaveSite` |
| `extension/src/entrypoints/sidepanel/App.tsx` | 修改 | 从 useSites 解构 `updateSite`，传给 Dashboard |

---

### Task 1: Dialog 基础组件

**Files:**
- Create: `extension/src/components/ui/Dialog.tsx`

- [ ] **Step 1: 创建 Dialog 组件文件**

创建 `extension/src/components/ui/Dialog.tsx`：

```tsx
import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { X } from 'lucide-react'

interface DialogProps {
  open: boolean
  onClose: () => void
  children: ReactNode
}

export function Dialog({ open, onClose, children }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        ref={dialogRef}
        className="w-full max-w-md bg-popover border border-border rounded-lg shadow-xl mx-4"
      >
        {children}
      </div>
    </div>
  )
}

export function DialogHeader({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('flex items-center justify-between px-4 pt-4 pb-2', className)}>
      {children}
    </div>
  )
}

export function DialogTitle({ className, children }: { className?: string; children: ReactNode }) {
  return <h3 className={cn('text-sm font-semibold text-foreground', className)}>{children}</h3>
}

export function DialogDescription({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cn('text-xs text-muted-foreground mt-0.5', className)}>{children}</p>
}

interface DialogCloseButtonProps {
  onClose: () => void
}

export function DialogCloseButton({ onClose }: DialogCloseButtonProps) {
  return (
    <button
      type="button"
      className="p-1 rounded text-muted-foreground/50 hover:text-foreground hover:bg-accent transition-colors"
      onClick={onClose}
    >
      <X className="w-4 h-4" />
    </button>
  )
}

export function DialogContent({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('px-4 py-3 space-y-3', className)}>{children}</div>
}

export function DialogFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('flex items-center justify-end gap-2 px-4 pb-4 pt-2', className)}>
      {children}
    </div>
  )
}
```

- [ ] **Step 2: 运行 build 验证编译**

Run: `cd c:/DATA/CODE/submit-agent && npm run build`
Expected: 编译成功，无错误

- [ ] **Step 3: 提交**

```bash
git add extension/src/components/ui/Dialog.tsx
git commit -m "feat: 添加 Dialog 基础 UI 组件"
```

---

### Task 2: useSites 新增 updateSite 方法

**Files:**
- Modify: `extension/src/hooks/useSites.ts`

**关键背景**：`db.ts` 已导出 `getDB()` 函数。db 中也有 `updateSite(site: SiteRecord)` 方法但它需要完整 SiteRecord 对象，而我们的 hook 收到的是 `Partial<SiteData>`，所以用 `getDB()` 先读再合并更合适。

- [ ] **Step 1: 修改 import — 添加 getDB**

`extension/src/hooks/useSites.ts` 第 4 行，在现有 import 末尾添加 `getDB`：

```ts
import { listSubmissionsByProduct, saveSubmission, updateSubmission, deleteSubmission, deleteSite, deleteSubmissionsBySite, updateSiteCategory, getDB } from '@/lib/db'
```

- [ ] **Step 2: 修改 UseSitesResult 接口 — 添加 updateSite 签名**

在 `UseSitesResult` 接口的 `updateSiteCategory` 之后（第 17 行后）添加：

```ts
updateSite: (siteName: string, data: Partial<SiteData>) => Promise<void>
```

- [ ] **Step 3: 添加 handleUpdateSite 实现**

在 `handleUpdateSiteCategory` 函数（第 141 行 `}` 之后）添加：

```ts
		const handleUpdateSite = useCallback(
			async (siteName: string, data: Partial<SiteData>) => {
				const db = await getDB()
				const site = await db.get('sites', siteName)
				if (!site) throw new Error(`Site not found: ${siteName}`)
				const updated = { ...site, ...data, updatedAt: Date.now() }
				await db.put('sites', updated)
				await refresh()
			},
			[refresh]
		)
```

- [ ] **Step 4: 在 return 对象中导出 updateSite**

在 return 对象中 `updateSiteCategory: handleUpdateSiteCategory,` 之后添加：

```ts
			updateSite: handleUpdateSite,
```

- [ ] **Step 5: 运行 build 验证编译**

Run: `cd c:/DATA/CODE/submit-agent && npm run build`
Expected: 编译成功

- [ ] **Step 6: 提交**

```bash
git add extension/src/hooks/useSites.ts
git commit -m "feat: useSites hook 添加 updateSite 方法"
```

---

### Task 3: SiteCard 添加编辑按钮和编辑弹窗

**Files:**
- Modify: `extension/src/components/SiteCard.tsx`

变更内容：
1. 移除 `CategoryEditor` 组件（第 38-90 行）
2. 修改 `SiteCardProps` 接口 — 用 `onSave` 替换 `onCategoryChange`
3. 卡片名称下方分类标签改为只读 `<span>`
4. 在开始按钮和重置按钮之间添加编辑按钮（Pencil 图标）
5. 添加编辑弹窗（内嵌在 SiteCard 中）

- [ ] **Step 1: 重写 SiteCard.tsx**

将 `extension/src/components/SiteCard.tsx` 完整替换为以下内容：

```tsx
import { useState } from 'react'
import { Play, Trash2, Loader2, Pencil } from 'lucide-react'
import type { SiteData, SubmissionStatus, SiteCategory } from '@/lib/types'
import { SITE_CATEGORIES, getCategoryLabel } from '@/lib/types'
import { Dialog, DialogHeader, DialogTitle, DialogCloseButton, DialogContent, DialogFooter } from './ui/Dialog'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Select } from './ui/Select'
import { Textarea } from './ui/Textarea'

interface SiteCardProps {
	site: SiteData
	status?: SubmissionStatus
	onSelect?: (site: SiteData) => void
	onDelete?: (siteName: string) => void
	onResetStatus?: (siteName: string) => void
	onSave?: (siteName: string, data: Partial<SiteData>) => void
	disabled?: boolean
	isActive?: boolean
}

const statusBar: Record<SubmissionStatus, string> = {
	not_started: '',
	in_progress: 'bg-blue-400',
	submitted: 'bg-green-400',
	approved: 'bg-green-500',
	rejected: 'bg-red-400',
	failed: 'bg-red-400',
	skipped: 'bg-muted-foreground/30',
}

const statusLabelKey: Record<SubmissionStatus, string> = {
	not_started: '',
	in_progress: '进行中',
	submitted: '已提交',
	approved: '已通过',
	rejected: '已拒绝',
	failed: '失败',
	skipped: '已跳过',
}

export function SiteCard({ site, status = 'not_started', onSelect, onDelete, onResetStatus, onSave, disabled, isActive }: SiteCardProps) {
	const [editOpen, setEditOpen] = useState(false)
	const hasSubmitUrl = !!site.submit_url
	const bar = statusBar[status]
	const labelKey = statusLabelKey[status]

	const [formName, setFormName] = useState('')
	const [formUrl, setFormUrl] = useState('')
	const [formCategory, setFormCategory] = useState<SiteCategory>('others')
	const [formDr, setFormDr] = useState('')
	const [formLang, setFormLang] = useState('')
	const [formNotes, setFormNotes] = useState('')

	const openEdit = () => {
		setFormName(site.name)
		setFormUrl(site.submit_url ?? '')
		setFormCategory(site.category)
		setFormDr(site.dr != null ? String(site.dr) : '')
		setFormLang(site.lang ?? '')
		setFormNotes(site.notes ?? '')
		setEditOpen(true)
	}

	const handleSave = () => {
		if (!onSave) return
		const data: Partial<SiteData> = {
			name: formName.trim() || site.name,
			submit_url: formUrl.trim() || null,
			category: formCategory,
			dr: formDr.trim() ? Number(formDr) : null,
			lang: formLang.trim() || undefined,
			notes: formNotes.trim() || undefined,
		}
		onSave(site.name, data)
		setEditOpen(false)
	}

	return (
		<>
			<div
				className={`relative flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
					hasSubmitUrl
						? 'hover:border-primary/60 hover:bg-accent/30'
						: 'opacity-50'
				}`}
			>
				{/* Left status bar */}
				{bar && (
					<div className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-full ${bar}`} />
				)}

				{/* DR score */}
				<div className="shrink-0 text-center w-8">
					<div className="text-sm font-bold tabular-nums">{site.dr}</div>
					<div className="text-[9px] text-muted-foreground uppercase tracking-wide">DR</div>
				</div>

				{/* Main info */}
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-1.5">
						{hasSubmitUrl ? (
							<button
								type="button"
								className="text-xs font-medium truncate text-left hover:underline hover:text-primary transition-colors"
								onClick={(e) => {
									e.stopPropagation()
									window.open(site.submit_url!, '_blank')
								}}
								title={site.submit_url!}
							>
								{site.name}
							</button>
						) : (
							<span className="text-xs font-medium truncate">{site.name}</span>
						)}
						{!hasSubmitUrl && (
							<span className="text-[9px] text-muted-foreground shrink-0">手动</span>
						)}
					</div>
					<div className="mt-0.5">
						<span className="text-[10px] text-muted-foreground">{getCategoryLabel(site.category)}</span>
					</div>
				</div>

				{/* Right: submit + edit + reset + delete */}
				<div className="shrink-0 flex items-center gap-1">
					{onSelect && hasSubmitUrl && (
						<button
							type="button"
							className={`p-1 rounded transition-colors ${
								isActive
									? 'text-primary'
									: disabled
										? 'text-muted-foreground/20 cursor-not-allowed'
										: 'text-muted-foreground/50 hover:text-primary hover:bg-primary/10 dark:hover:bg-primary/20'
							}`}
							onClick={(e) => {
								e.stopPropagation()
								if (!disabled && !isActive) onSelect(site)
							}}
							disabled={disabled || isActive}
							title={isActive ? '提交中...' : '自动提交'}
						>
							{isActive
								? <Loader2 className="w-3.5 h-3.5 animate-spin" />
								: <Play className="w-3.5 h-3.5" />
							}
						</button>
					)}
					{onSave && (
						<button
							type="button"
							className="p-1 rounded text-muted-foreground/50 hover:text-primary hover:bg-primary/10 dark:hover:bg-primary/20 transition-colors"
							onClick={(e) => {
								e.stopPropagation()
								openEdit()
							}}
							title="编辑站点"
						>
							<Pencil className="w-3.5 h-3.5" />
						</button>
					)}
					{labelKey && onResetStatus && (
						<button
							type="button"
							className="p-1 rounded text-muted-foreground/50 hover:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-950/30 transition-colors"
							onClick={(e) => {
								e.stopPropagation()
								onResetStatus(site.name)
							}}
							title={`点击重置状态（${labelKey}）`}
						>
							<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
						</button>
					)}
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
				</div>
			</div>

			{/* Edit Dialog */}
			<Dialog open={editOpen} onClose={() => setEditOpen(false)}>
				<DialogHeader>
					<DialogTitle>编辑站点</DialogTitle>
					<DialogCloseButton onClose={() => setEditOpen(false)} />
				</DialogHeader>
				<DialogContent>
					<Input
						label="站点名称"
						value={formName}
						onChange={(e) => setFormName(e.target.value)}
					/>
					<Input
						label="提交 URL"
						value={formUrl}
						onChange={(e) => setFormUrl(e.target.value)}
						placeholder="留空表示手动提交"
					/>
					<Select
						label="分类"
						options={SITE_CATEGORIES}
						value={formCategory}
						onChange={(e) => setFormCategory(e.target.value as SiteCategory)}
					/>
					<Input
						label="DR 分数"
						type="number"
						value={formDr}
						onChange={(e) => setFormDr(e.target.value)}
						placeholder="留空表示未知"
					/>
					<Input
						label="语言"
						value={formLang}
						onChange={(e) => setFormLang(e.target.value)}
						placeholder="如 en, zh, ja"
					/>
					<Textarea
						label="备注"
						value={formNotes}
						onChange={(e) => setFormNotes(e.target.value)}
						placeholder="可选备注"
					/>
				</DialogContent>
				<DialogFooter>
					<Button variant="ghost" size="sm" onClick={() => setEditOpen(false)}>取消</Button>
					<Button size="sm" onClick={handleSave}>保存</Button>
				</DialogFooter>
			</Dialog>
		</>
	)
}
```

- [ ] **Step 2: 运行 build 验证编译**

Run: `cd c:/DATA/CODE/submit-agent && npm run build`
Expected: 编译成功

- [ ] **Step 3: 提交**

```bash
git add extension/src/components/SiteCard.tsx
git commit -m "feat: SiteCard 添加编辑按钮和编辑弹窗，移除内联分类编辑器"
```

---

### Task 4: Dashboard 适配新接口

**Files:**
- Modify: `extension/src/components/Dashboard.tsx`

- [ ] **Step 1: 修改 Dashboard props 接口**

`extension/src/components/Dashboard.tsx` 第 1 行 import 中，移除 `SiteCategory`（不再需要），保留其余不变。同时添加 `SiteData` 的 import（如果还没有）。

检查第 1 行当前 import：
```ts
import type { SiteData, SubmissionRecord, SubmissionStatus, SiteCategory } from '@/lib/types'
```
移除 `SiteCategory`：
```ts
import type { SiteData, SubmissionRecord, SubmissionStatus } from '@/lib/types'
```

第 17 行，将 `onCategoryChange` prop：
```ts
onCategoryChange?: (siteName: string, category: SiteCategory) => void
```
替换为：
```ts
onSaveSite?: (siteName: string, data: Partial<SiteData>) => void
```

- [ ] **Step 2: 修改解构参数**

在第 35-39 行的解构中，将 `onCategoryChange,` 替换为 `onSaveSite,`。

- [ ] **Step 3: 修改 SiteCard 调用**

在第 249-261 行的 SiteCard 调用中，将 `onCategoryChange={onCategoryChange}` 替换为 `onSave={onSaveSite}`。其他 props 不变：

```tsx
<SiteCard
  key={site.name}
  site={site}
  status={submissions.get(site.name)?.status ?? 'not_started'}
  onSelect={onSelectSite}
  onDelete={onDeleteSite}
  onResetStatus={onResetStatus}
  onSave={onSaveSite}
  disabled={hasActive && site.name !== activeSiteName}
  isActive={hasActive && site.name === activeSiteName}
/>
```

- [ ] **Step 4: 运行 build 验证编译**

Run: `cd c:/DATA/CODE/submit-agent && npm run build`
Expected: 编译成功

- [ ] **Step 5: 提交**

```bash
git add extension/src/components/Dashboard.tsx
git commit -m "feat: Dashboard 适配 SiteCard 编辑弹窗接口"
```

---

### Task 5: App.tsx 适配新接口

**Files:**
- Modify: `extension/src/entrypoints/sidepanel/App.tsx`

- [ ] **Step 1: 修改 useSites 解构**

第 22 行，将：
```ts
const { sites, submissions, loading: sitesLoading, markSubmitted, markSkipped, markFailed, resetSubmission, deleteSite, updateSiteCategory } = useSites(activeProduct?.id ?? null)
```
替换为：
```ts
const { sites, submissions, loading: sitesLoading, markSubmitted, markSkipped, markFailed, resetSubmission, deleteSite, updateSite } = useSites(activeProduct?.id ?? null)
```

（将 `updateSiteCategory` 替换为 `updateSite`）

- [ ] **Step 2: 修改 Dashboard 组件的 prop**

第 212 行，将：
```tsx
onCategoryChange={updateSiteCategory}
```
替换为：
```tsx
onSaveSite={updateSite}
```

- [ ] **Step 3: 运行 build 验证编译**

Run: `cd c:/DATA/CODE/submit-agent && npm run build`
Expected: 编译成功

- [ ] **Step 4: 提交**

```bash
git add extension/src/entrypoints/sidepanel/App.tsx
git commit -m "feat: App.tsx 适配站点编辑弹窗接口"
```

---

### Task 6: 最终验证

- [ ] **Step 1: 运行完整 build**

Run: `cd c:/DATA/CODE/submit-agent && npm run build`
Expected: 编译成功，无警告

- [ ] **Step 2: 清理不再使用的代码**

检查：
- `useSites.ts` 中的 `updateSiteCategory` 和 `handleUpdateSiteCategory` — 确认没有其他消费者后可移除
- `db.ts` 中的 `updateSiteCategory` — 确认没有其他消费者后可移除
- 确认无未使用的 import（`SiteCategory` 在 SiteCard 中仍需使用）

- [ ] **Step 3: 功能验证清单**

手动验证：
- [ ] 点击编辑按钮打开弹窗
- [ ] 弹窗显示当前站点所有字段
- [ ] 修改字段后点击保存，数据正确更新
- [ ] 点击取消或遮罩，弹窗关闭且数据不变
- [ ] ESC 键关闭弹窗
- [ ] 分类标签在卡片上只读显示
- [ ] 其他按钮（开始、重置、删除）功能不受影响
