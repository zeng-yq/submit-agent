import type { AgentActivity, AgentStatus, HistoricalEvent } from '@page-agent/core'
import type { SiteData, SubmissionRecord, SubmissionStatus } from '@/lib/types'
import { useMemo, useState } from 'react'
import { Play, Trash2 } from 'lucide-react'
import { SiteCard } from './SiteCard'

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
	// Agent state for inline progress
	agentStatus: AgentStatus
	agentActivity: AgentActivity | null
	agentHistory: HistoricalEvent[]
	agentError: string | null
	agentSiteName: string | null
	onStopAgent: () => void
}

type Tab = 'all' | 'done' | 'failed'

const DONE_STATUSES: SubmissionStatus[] = ['submitted', 'approved', 'skipped']

function humanizeActivity(activity: AgentActivity): string {
	switch (activity.type) {
		case 'thinking': return '思考中...'
		case 'executing': {
			const tool = activity.tool
			if (tool === 'click') return '正在点击元素...'
			if (tool === 'type' || tool === 'input_text') return '正在输入内容...'
			if (tool === 'scroll') return '正在滚动页面...'
			if (tool === 'navigate' || tool === 'goto') return '正在跳转页面...'
			if (tool === 'select') return '正在选择选项...'
			if (tool === 'screenshot' || tool === 'snapshot') return '正在读取页面...'
			return `正在执行：${tool}...`
		}
		case 'executed': {
			const tool = activity.tool
			if (tool === 'click') return '已点击元素'
			if (tool === 'type' || tool === 'input_text') return '已填入字段'
			if (tool === 'scroll') return '已滚动页面'
			if (tool === 'navigate' || tool === 'goto') return '已跳转页面'
			if (tool === 'select') return '已选择选项'
			if (tool === 'screenshot' || tool === 'snapshot') return '已读取页面'
			return `已完成：${tool}`
		}
		case 'retrying': return `重试中... (${activity.attempt}/${activity.maxAttempts})`
		case 'error': return `错误：${activity.message}`
		default: return ''
	}
}

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
	agentStatus,
	agentActivity,
	agentHistory,
	agentError,
	agentSiteName,
	onStopAgent,
}: DashboardProps) {
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
		{ id: 'all', label: '全部', count: allSites.length },
		{ id: 'done', label: '已完成', count: doneSites.length },
		{ id: 'failed', label: '失败', count: failedSites.length },
	]

	const displaySites =
		tab === 'all' ? allSites : tab === 'done' ? doneSites : failedSites

	const isAgentActive = agentStatus === 'running' || agentStatus === 'completed' || agentStatus === 'error' || !!agentError

	return (
		<div className="flex flex-col gap-2 h-full">
			{/* Progress */}
			<div className="px-1 space-y-1">
				<div className="flex items-center justify-between">
					<span className="text-xs font-medium">
						{`已提交 ${stats.submitted} / ${stats.total}`}
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

			{/* Agent progress panel */}
			{isAgentActive && agentSiteName && (
				<div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950 p-3 space-y-2">
					{agentStatus === 'running' && (
						<div className="flex items-center gap-2">
							<span className="relative flex h-2 w-2">
								<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
								<span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
							</span>
							<span className="text-xs font-medium text-blue-700 dark:text-blue-300">
								{'AI 正在提交'} — {agentSiteName}
							</span>
							<span className="ml-auto">
								<button
									type="button"
									className="text-xs text-red-600 dark:text-red-400 hover:underline"
									onClick={onStopAgent}
								>
									{'停止'}
								</button>
							</span>
						</div>
					)}
					{agentStatus === 'completed' && !agentError && (
						<div className="flex items-center gap-2">
							<span className="text-green-600 dark:text-green-400 text-sm">{'✓'}</span>
							<span className="text-xs font-medium text-green-700 dark:text-green-300">
								{'已完成'} — {agentSiteName}
							</span>
						</div>
					)}
					{(agentStatus === 'error' || !!agentError) && (
						<div className="flex items-center gap-2">
							<span className="text-red-500 text-sm">{'✕'}</span>
							<span className="text-xs font-medium text-red-700 dark:text-red-300">
								{'失败'} — {agentSiteName}
							</span>
						</div>
					)}
					{agentActivity && agentStatus === 'running' && (
						<div className="text-xs text-blue-600 dark:text-blue-300">
							{humanizeActivity(agentActivity)}
						</div>
					)}
					{agentError && (
						<div className="text-xs text-red-600 dark:text-red-400 truncate">
							{agentError}
						</div>
					)}
				</div>
			)}

			{/* Tabs + batch controls */}
			<div className="flex items-center gap-0 border-b">
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
				{batchRunning ? (
					<span className="ml-auto text-xs text-blue-600 dark:text-blue-400 shrink-0 py-1">
						{`正在提交 ${batchCurrentIndex}/${batchTotal}  ${batchCurrentSite}`}
						<button
							type="button"
							className="ml-2 text-xs text-red-600 dark:text-red-400 hover:underline"
							onClick={onStopBatch}
						>
							{'停止'}
						</button>
					</span>
				) : (
					<div className="ml-auto flex items-center gap-1.5 py-1">
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
							className="text-xs font-medium bg-primary text-primary-foreground rounded-md px-2.5 h-7 hover:bg-primary/90 transition-colors"
							onClick={onStartBatch}
						>
							{'开始提交'}
						</button>
					</div>
				)}
			</div>

			{/* Search (All tab only) */}
			{tab === 'all' && (
				<input
					type="text"
					placeholder={'搜索站点...'}
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					className="w-full px-2.5 py-1.5 text-xs rounded border border-border bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
				/>
			)}

			{/* Site list */}
			<div className="flex-1 overflow-y-auto space-y-1.5">
				{tab === 'failed' ? (
					failedSites.map((site) => {
						const sub = submissions.get(site.name)
						return (
							<div
								key={site.name}
								className="relative flex items-start gap-3 rounded-lg border border-red-200 dark:border-red-800 px-3 py-2.5 hover:bg-accent/30 transition-colors"
							>
								<div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-red-400" />
								<div className="shrink-0 text-center w-8">
									<div className="text-sm font-bold tabular-nums">{site.dr}</div>
									<div className="text-[9px] text-muted-foreground uppercase tracking-wide">DR</div>
								</div>
								<div className="flex-1 min-w-0">
									{site.submit_url ? (
										<button
											type="button"
											className="text-xs font-medium truncate text-left hover:underline hover:text-primary transition-colors"
											onClick={() => window.open(site.submit_url!, '_blank')}
											title={site.submit_url!}
										>
											{site.name}
										</button>
									) : (
										<div className="text-xs font-medium truncate">{site.name}</div>
									)}
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
								<div className="shrink-0 flex items-center gap-1.5 mt-0.5">
									{onRetrySite && site.submit_url && (
										<button
											type="button"
											className="p-1 rounded text-muted-foreground/50 hover:text-primary hover:bg-primary/10 dark:hover:bg-primary/20 transition-colors"
											onClick={() => onRetrySite(site)}
											title="重试自动提交"
										>
											<Play className="w-3.5 h-3.5" />
										</button>
									)}
									<button
										type="button"
										className="p-1 rounded text-muted-foreground/50 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
										onClick={(e) => {
											e.stopPropagation()
											if (confirm('确定要删除「' + site.name + '」吗？该站点的提交记录也将被删除。')) {
												onDeleteSite?.(site.name)
											}
										}}
										title="删除站点"
									>
										<Trash2 className="w-3.5 h-3.5" />
									</button>
								</div>
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
							onDelete={onDeleteSite}
							disabled={isAgentActive}
						/>
					))
				)}
				{displaySites.length === 0 && (
					<div className="text-center text-xs text-muted-foreground py-8">
						{tab === 'all' && '没有匹配的站点'}
						{tab === 'done' && '暂无已提交或跳过的站点'}
						{tab === 'failed' && '暂无失败记录'}
					</div>
				)}
			</div>
		</div>
	)
}
