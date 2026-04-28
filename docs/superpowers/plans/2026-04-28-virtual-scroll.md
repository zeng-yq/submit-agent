# 外链分析面板虚拟滚动优化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引入 @tanstack/react-virtual 虚拟滚动，解决 25000 条外链切换面板时的卡顿问题。

**Architecture:** 将 `<table>` 替换为 CSS Grid 布局（视觉一致），用 `useVirtualizer` 只渲染可视区域内的行（约 20-30 行而非 25000 行）。展开行作为虚拟行内部内容，由 virtualizer 自动测量高度变化。

**Tech Stack:** @tanstack/react-virtual ~3KB, React 19, CSS Grid (Tailwind v4)

---

### Task 1: 安装 @tanstack/react-virtual

**Files:**
- Modify: `extension/package.json`

- [ ] **Step 1: 安装依赖**

Run:
```bash
cd extension && npm install @tanstack/react-virtual
```

Expected: 依赖安装成功，`package.json` 中出现 `"@tanstack/react-virtual": "^3.x.x"`

- [ ] **Step 2: 验证构建**

Run:
```bash
cd c:/DATA/CODE/submit-agent/extension && npm run build
```

Expected: 构建成功，无报错

---

### Task 2: 重构 BacklinkRow — 从 table 行改为 CSS Grid 行

**Files:**
- Rewrite: `extension/src/components/BacklinkRow.tsx`

这个改动会暂时破坏 BacklinkTable 的渲染（div 出现在 `<tbody>` 内），但不会导致构建失败。Task 3 会立即修复。

- [ ] **Step 1: 重写 BacklinkRow.tsx**

将整个文件替换为以下内容。核心变化：`<tr>/<td>` → `<div>` + CSS Grid，保持所有交互逻辑不变。

```tsx
import type { BacklinkRecord } from '@/lib/types'
import { Fragment } from 'react'
import { Button } from './ui/Button'

interface BacklinkRowProps {
	backlink: BacklinkRecord
	isAnalyzing: boolean
	isDisabled: boolean
	isExpanded: boolean
	onToggleExpand: () => void
	onAnalyze: () => void
}

const BACKLINK_STATUS_LABELS: Record<string, string> = {
	pending: '待分析',
	publishable: '可发布',
	not_publishable: '不可发布',
	error: '错误',
	skipped: '已跳过',
}

const STATUS_COLORS: Record<string, string> = {
	pending: 'bg-muted text-muted-foreground',
	publishable: 'bg-green-500/20 text-green-400',
	not_publishable: 'bg-red-500/20 text-red-400',
	skipped: 'bg-yellow-500/20 text-yellow-400',
	error: 'bg-destructive/20 text-destructive',
}

export function BacklinkRow({
	backlink: b,
	isAnalyzing,
	isDisabled,
	isExpanded,
	onToggleExpand,
	onAnalyze,
}: BacklinkRowProps) {
	return (
		<Fragment>
			<div className={`grid grid-cols-[2.5rem_1fr_5rem_4rem] border-b border-border/40 transition-colors text-xs ${isAnalyzing ? 'bg-blue-500/5' : 'hover:bg-accent/30'}`}>
				<div className="px-3 py-1.5 text-primary font-medium">{b.pageAscore}</div>
				<div className="px-3 py-1.5 overflow-hidden">
					<a
						href={b.sourceUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="truncate block text-primary hover:underline"
						title={b.sourceUrl}
					>
						{b.sourceTitle || b.sourceUrl}
					</a>
				</div>
				<div className="px-3 py-1.5">
					<span
						className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
							b.status !== 'pending' ? 'cursor-pointer hover:opacity-80' : 'cursor-default'
						} ${STATUS_COLORS[b.status]}`}
						title={(b.status === 'error' || b.status === 'not_publishable') && b.analysisLog?.length ? b.analysisLog.map(l => typeof l === 'string' ? l : JSON.stringify(l)).join('\n') : undefined}
						onClick={() => {
							if (b.status !== 'pending') {
								onToggleExpand()
							}
						}}
					>
						{BACKLINK_STATUS_LABELS[b.status] ?? b.status}
					</span>
				</div>
				<div className="px-3 py-1.5 text-right">
					<Button
						variant="ghost"
						size="sm"
						className="text-xs h-6 px-2"
						disabled={isDisabled}
						onClick={onAnalyze}
					>
						{isAnalyzing ? (
							<svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
								<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
								<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
							</svg>
						) : (
							'分析'
						)}
					</Button>
				</div>
			</div>
			{isExpanded && b.status !== 'pending' && b.analysisLog?.length > 0 && (
				<div className="border-b border-border/40 px-4 py-2">
					<div className={`text-xs rounded px-3 py-1.5 border-l-2 ${
						b.status === 'publishable' ? 'bg-green-500/5 border-green-400 text-green-300'
							: b.status === 'error' ? 'bg-red-500/5 border-red-400 text-red-300'
								: b.status === 'skipped' ? 'bg-yellow-500/5 border-yellow-400/70 text-yellow-300/80'
									: 'bg-red-500/5 border-red-400/70 text-red-300/80'
					}`}>
						{b.analysisLog.map((log, i) => (
							<div key={i}>{typeof log === 'string' ? log : JSON.stringify(log)}</div>
						))}
					</div>
				</div>
			)}
		</Fragment>
	)
}
```

- [ ] **Step 2: 提交**

```bash
cd c:/DATA/CODE/submit-agent && git add extension/src/components/BacklinkRow.tsx && git commit -m "refactor: 将 BacklinkRow 从 table 行改为 CSS Grid 布局"
```

---

### Task 3: 重构 BacklinkTable — 引入虚拟滚动

**Files:**
- Rewrite: `extension/src/components/BacklinkTable.tsx`

核心改动：`<table>` → CSS Grid 表头 + `useVirtualizer` 虚拟化列表。只渲染可视区约 20-30 行。

- [ ] **Step 1: 重写 BacklinkTable.tsx**

将整个文件替换为以下内容：

```tsx
import type { BacklinkRecord, BacklinkStatus } from '@/lib/types'
import type { LogEntry } from '@/agent/types'
import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Button } from './ui/Button'
import { ActivityLog } from './ActivityLog'
import { BacklinkRow } from './BacklinkRow'

interface BacklinkTableProps {
	backlinks: BacklinkRecord[]
	analyzingId: string | null
	isRunning: boolean
	onAnalyzeOne: (backlink: BacklinkRecord) => void
	logs: LogEntry[]
	totalLogCount?: number
	onClearLogs: () => void
}

type Tab = 'all' | 'done' | 'failed' | 'log'

const DONE_STATUSES: BacklinkStatus[] = ['publishable', 'not_publishable', 'skipped']

export function BacklinkTable({
	backlinks,
	analyzingId,
	isRunning,
	onAnalyzeOne,
	logs,
	totalLogCount,
	onClearLogs,
}: BacklinkTableProps) {
	const [tab, setTab] = useState<Tab>('all')
	const [expandedId, setExpandedId] = useState<string | null>(null)
	const lastAnalyzedRef = useRef<string | null>(null)
	const scrollRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (isRunning) {
			setTab('log')
		}
	}, [isRunning])

	useEffect(() => {
		if (analyzingId) {
			lastAnalyzedRef.current = analyzingId
		} else if (lastAnalyzedRef.current) {
			if (!isRunning) {
				setExpandedId(lastAnalyzedRef.current)
			}
			lastAnalyzedRef.current = null
		}
	}, [analyzingId, isRunning])

	const filteredBacklinks = useMemo(() => {
		return [...backlinks
			.filter(b => {
				if (tab === 'all' || tab === 'log') return true
				if (tab === 'done') return DONE_STATUSES.includes(b.status)
				return b.status === 'error'
			})
		].sort((a, b) => b.pageAscore - a.pageAscore)
	}, [backlinks, tab])

	const tabCounts = useMemo(() => ({
		all: backlinks.length,
		done: backlinks.filter(b => DONE_STATUSES.includes(b.status)).length,
		failed: backlinks.filter(b => b.status === 'error').length,
	}), [backlinks])

	const handleToggleExpand = useCallback((id: string) => {
		setExpandedId(prev => prev === id ? null : id)
	}, [])

	const virtualizer = useVirtualizer({
		count: filteredBacklinks.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => 36,
		overscan: 5,
	})

	const tabs: { id: Tab; label: string; count: number }[] = [
		{ id: 'all', label: '全部', count: tabCounts.all },
		{ id: 'done', label: '已完成', count: tabCounts.done },
		{ id: 'failed', label: '失败', count: tabCounts.failed },
	]

	return (
		<>
			{/* ── Filter tabs ── */}
			<div className="shrink-0 border-t border-border/60">
				<div className="flex items-center gap-0 border-b px-4">
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
					<Button
						variant={tab === 'log' ? 'default' : 'ghost'}
						size="xs"
						onClick={() => setTab('log')}
						className="ml-auto"
					>
						{'活动日志'}
					</Button>
				</div>
			</div>

			{/* ── Content: ActivityLog or Virtualized Table ── */}
			{tab === 'log' ? (
				<ActivityLog logs={logs} totalLogCount={totalLogCount} onClear={onClearLogs} className="flex-1" />
			) : (
				<>
					{/* Header row — CSS Grid */}
					<div className="shrink-0 grid grid-cols-[2.5rem_1fr_5rem_4rem] border-b border-border/60 text-muted-foreground text-xs">
						<span className="px-3 py-1.5 font-normal">{'AS'}</span>
						<span className="px-3 py-1.5 font-normal">{'来源'}</span>
						<span className="px-3 py-1.5 font-normal">{'Status'}</span>
						<span className="text-right px-3 py-1.5 font-normal">{'操作'}</span>
					</div>

					{/* Virtualized scroll area */}
					<div ref={scrollRef} className="flex-1 overflow-y-auto">
						{filteredBacklinks.length === 0 ? (
							<div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
								{'暂无外链数据。请导入 Semrush 导出的 CSV 文件。'}
							</div>
						) : (
							<div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
								{virtualizer.getVirtualItems().map(virtualRow => {
									const b = filteredBacklinks[virtualRow.index]
									return (
										<div
											key={virtualRow.key}
											data-index={virtualRow.index}
											ref={virtualizer.measureElement}
											style={{
												position: 'absolute',
												top: 0,
												left: 0,
												width: '100%',
												transform: `translateY(${virtualRow.start}px)`,
											}}
										>
											<BacklinkRow
												backlink={b}
												isAnalyzing={analyzingId === b.id}
												isDisabled={analyzingId !== null || isRunning}
												isExpanded={expandedId === b.id}
												onToggleExpand={() => handleToggleExpand(b.id)}
												onAnalyze={() => onAnalyzeOne(b)}
											/>
										</div>
									)
								})}
							</div>
						)}
					</div>
				</>
			)}
		</>
	)
}
```

- [ ] **Step 2: 验证构建**

Run:
```bash
cd c:/DATA/CODE/submit-agent/extension && npm run build
```

Expected: 构建成功，无 TypeScript 错误

- [ ] **Step 3: 提交**

```bash
cd c:/DATA/CODE/submit-agent && git add extension/src/components/BacklinkTable.tsx && git commit -m "feat: BacklinkTable 引入虚拟滚动，25000 条外链只渲染可视区约 20-30 行"
```

---

### Task 4: 优化 BacklinkAnalysis 统计计算

**Files:**
- Modify: `extension/src/components/BacklinkAnalysis.tsx`

将 3 次 `.filter()` 遍历改为 1 次 for 循环 + `useMemo` 缓存。

- [ ] **Step 1: 添加 useMemo 导入并优化 stats 计算**

在 `BacklinkAnalysis.tsx` 中：

将第 1 行的 import 改为：
```tsx
import { useMemo } from 'react'
```

将第 37-41 行的 stats 计算改为：
```tsx
	const stats = useMemo(() => {
		let analyzed = 0
		let publishable = 0
		for (const b of backlinks) {
			if (b.status !== 'pending') analyzed++
			if (b.status === 'publishable') publishable++
		}
		return { total: backlinks.length, analyzed, publishable }
	}, [backlinks])
```

- [ ] **Step 2: 验证构建**

Run:
```bash
cd c:/DATA/CODE/submit-agent/extension && npm run build
```

Expected: 构建成功

- [ ] **Step 3: 提交**

```bash
cd c:/DATA/CODE/submit-agent && git add extension/src/components/BacklinkAnalysis.tsx && git commit -m "perf: BacklinkAnalysis stats 从 3 次 filter 改为单次遍历 + useMemo 缓存"
```

---

### Task 5: 最终验证

- [ ] **Step 1: 完整构建**

Run:
```bash
cd c:/DATA/CODE/submit-agent/extension && npm run build
```

Expected: 构建成功，无错误无警告

- [ ] **Step 2: 运行现有测试**

Run:
```bash
cd c:/DATA/CODE/submit-agent/extension && npm run test
```

Expected: 所有测试通过

- [ ] **Step 3: 视觉验证清单**

在浏览器中加载扩展，逐一验证：

1. **切换面板** — 从"外链提交"切到"外链分析"，应无明显卡顿
2. **滚动流畅** — 在 25000 条数据中滚动，应 60fps 无白屏闪烁
3. **展开行** — 点击已完成行的状态标签，展开/折叠日志正常
4. **Tab 筛选** — 全部/已完成/失败/活动日志 切换正常，计数正确
5. **分析按钮** — 单条分析和批量分析功能正常
6. **CSV 导入** — 导入新数据后列表正常更新

---

## 自检清单

- [x] 设计文档中的每个需求都有对应的 Task
- [x] 无 TBD/TODO 占位符
- [x] 所有文件路径精确
- [x] 所有代码步骤包含完整代码
- [x] 类型签名跨 Task 一致
- [x] 每个 Task 结束时构建可过
