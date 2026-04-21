import type { BacklinkRecord, BacklinkStatus } from '@/lib/types'
import type { LogEntry } from '@/agent/types'
import { useState, useRef, useEffect } from 'react'
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

	const filteredBacklinks = [...backlinks
		.filter(b => {
			if (tab === 'all' || tab === 'log') return true
			if (tab === 'done') return DONE_STATUSES.includes(b.status)
			return b.status === 'error'
		})
	].sort((a, b) => b.pageAscore - a.pageAscore)

	const tabs: { id: Tab; label: string; count: number }[] = [
		{ id: 'all', label: '全部', count: backlinks.length },
		{ id: 'done', label: '已完成', count: backlinks.filter(b => DONE_STATUSES.includes(b.status)).length },
		{ id: 'failed', label: '失败', count: backlinks.filter(b => b.status === 'error').length },
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

			{/* ── Content: ActivityLog or Table ── */}
			{tab === 'log' ? (
				<ActivityLog logs={logs} totalLogCount={totalLogCount} onClear={onClearLogs} className="flex-1" />
			) : (
				<div className="flex-1 overflow-y-auto">
				{filteredBacklinks.length === 0 ? (
					<div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
						{'暂无外链数据。请导入 Semrush 导出的 CSV 文件。'}
					</div>
				) : (
					<table className="w-full text-xs table-fixed">
						<thead className="sticky top-0 bg-background">
							<tr className="border-b border-border/60 text-muted-foreground">
								<th className="text-left px-3 py-1.5 font-normal w-10">{'AS'}</th>
								<th className="text-left px-3 py-1.5 font-normal">{'来源'}</th>
								<th className="text-left px-3 py-1.5 font-normal w-20">Status</th>
								<th className="text-right px-3 py-1.5 font-normal w-16">{'操作'}</th>
							</tr>
						</thead>
						<tbody>
							{filteredBacklinks.map(b => (
								<BacklinkRow
									key={b.id}
									backlink={b}
									isAnalyzing={analyzingId === b.id}
									isDisabled={analyzingId !== null || isRunning}
									isExpanded={expandedId === b.id}
									onToggleExpand={() => setExpandedId(expandedId === b.id ? null : b.id)}
									onAnalyze={() => onAnalyzeOne(b)}
								/>
							))}
						</tbody>
					</table>
				)}
				</div>
			)}
		</>
	)
}
