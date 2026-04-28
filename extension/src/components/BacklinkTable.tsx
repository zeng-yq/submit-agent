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

	const sortedBacklinks = useMemo(
		() => [...backlinks].sort((a, b) => b.pageAscore - a.pageAscore),
		[backlinks]
	)

	const filteredBacklinks = useMemo(() => {
		if (tab === 'all' || tab === 'log') return sortedBacklinks
		if (tab === 'done') return sortedBacklinks.filter(b => DONE_STATUSES.includes(b.status))
		return sortedBacklinks.filter(b => b.status === 'error')
	}, [sortedBacklinks, tab])

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
