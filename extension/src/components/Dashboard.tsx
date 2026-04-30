import type { SiteData, SubmissionRecord, SubmissionStatus, SiteCategory } from '@/lib/types'
import { SITE_CATEGORIES } from '@/lib/types'
import type { FillEngineStatus, LogEntry, LLMFieldData } from '@/agent/types'
import { useMemo, useState, useEffect, useCallback } from 'react'
import { Play, Trash2, Loader2, ExternalLink } from 'lucide-react'
import { SiteCard } from './SiteCard'
import { Button } from './ui/Button'
import { ActivityLog } from './ActivityLog'

interface DashboardProps {
	sites: SiteData[]
	submissions: Map<string, SubmissionRecord>
	onSelectSite: (site: SiteData) => void
	onRetrySite?: (site: SiteData) => void
	onResetStatus?: (siteName: string) => void
	onDeleteSite?: (siteName: string) => void
	onSaveSite?: (siteName: string, data: Partial<SiteData>) => void
	engineStatus: FillEngineStatus
	engineLogs: LogEntry[]
	onClearEngineLogs: () => void
	llmFieldData: LLMFieldData | null
	activeSiteName: string | null
}

type Tab = 'all' | 'undone' | 'done' | 'failed' | 'log'

const DONE_STATUSES: SubmissionStatus[] = ['submitted', 'approved', 'skipped']

function shuffle<T>(arr: T[]): T[] {
	const a = [...arr]
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1))
		;[a[i], a[j]] = [a[j], a[i]]
	}
	return a
}

const RANDOM_OPEN_COUNT = 10

export function Dashboard({
	sites,
	submissions,
	onSelectSite,
	onRetrySite,
	onResetStatus,
	onDeleteSite,
	onSaveSite,
	engineStatus,
	engineLogs,
	onClearEngineLogs,
	llmFieldData,
	activeSiteName,
}: DashboardProps) {
	const [tab, setTab] = useState<Tab>('all')
	const [search, setSearch] = useState('')
	const [categoryFilter, setCategoryFilter] = useState<SiteCategory | 'all'>('all')
	const [opening, setOpening] = useState(false)

	const openRandomSites = useCallback(async () => {
		const candidates = undoneSites.filter((s) => !!s.submit_url)
		if (candidates.length === 0) return

		const picked = shuffle(candidates).slice(0, RANDOM_OPEN_COUNT)

		setOpening(true)
		for (let i = 0; i < picked.length; i++) {
			await chrome.tabs.create({ url: picked[i].submit_url!, active: i === picked.length - 1 })
			if (i < picked.length - 1) {
				await new Promise((r) => setTimeout(r, 500))
			}
		}
		setOpening(false)
	}, [undoneSites])

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

	const matchesSearch = useCallback((s: SiteData) => {
		const q = search.toLowerCase()
		return !q || s.name.toLowerCase().includes(q) || s.category?.toLowerCase().includes(q)
	}, [search])

	const allSites = useMemo(() => {
		return sites
			.filter(matchesSearch)
			.filter((s) => categoryFilter === 'all' || s.category === categoryFilter)
			.sort((a, b) => (b.dr ?? 0) - (a.dr ?? 0))
	}, [sites, matchesSearch, categoryFilter])

	const doneSites = useMemo(() => {
		return sites
			.filter((s) => {
				const status = submissions.get(s.name)?.status
				return status && DONE_STATUSES.includes(status)
			})
			.filter(matchesSearch)
			.filter((s) => categoryFilter === 'all' || s.category === categoryFilter)
	}, [sites, submissions, matchesSearch, categoryFilter])

	const failedSites = useMemo(() => {
		return sites
			.filter((s) => {
				const status = submissions.get(s.name)?.status
				return status === 'failed'
			})
			.filter(matchesSearch)
			.filter((s) => categoryFilter === 'all' || s.category === categoryFilter)
	}, [sites, submissions, matchesSearch, categoryFilter])

	const undoneSites = useMemo(() => {
		return sites
			.filter((s) => {
				const status = submissions.get(s.name)?.status
				return !status || (!DONE_STATUSES.includes(status) && status !== 'failed')
			})
			.filter(matchesSearch)
			.filter((s) => categoryFilter === 'all' || s.category === categoryFilter)
			.sort((a, b) => (b.dr ?? 0) - (a.dr ?? 0))
	}, [sites, submissions, matchesSearch, categoryFilter])

	const tabs: { id: Tab; label: string; count: number }[] = [
		{ id: 'all', label: '全部', count: allSites.length },
		{ id: 'undone', label: '未完成', count: undoneSites.length },
		{ id: 'done', label: '已完成', count: doneSites.length },
		{ id: 'failed', label: '失败', count: failedSites.length },
	]

	const displaySites =
		tab === 'all' ? allSites : tab === 'undone' ? undoneSites : tab === 'done' ? doneSites : failedSites

	const isEngineActive = engineStatus === 'running' || engineStatus === 'analyzing' || engineStatus === 'filling'
	const hasActive = !!activeSiteName

	useEffect(() => {
		if (isEngineActive) {
			setTab('log')
		}
	}, [isEngineActive])

	return (
		<div className="flex flex-col gap-2 h-full">
			{/* Tabs + current submission toggle */}
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
				<Button
					variant={tab === 'log' ? 'default' : 'ghost'}
					size="xs"
					onClick={() => setTab('log')}
					className="ml-auto"
				>
					{'活动日志'}
				</Button>
			</div>

			{tab === 'log' ? (
				<ActivityLog
					logs={engineLogs}
					onClear={onClearEngineLogs}
					llmFieldData={llmFieldData}
					className="flex-1"
				/>
			) : (
				<>
					{/* Category filter & search */}
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
						{tab === 'undone' && (() => {
							const openableCount = undoneSites.filter((s) => !!s.submit_url).length
							const count = Math.min(RANDOM_OPEN_COUNT, openableCount)
							return (
								<Button
									variant="outline"
									size="xs"
									disabled={openableCount === 0 || opening}
									onClick={openRandomSites}
									title={`随机打开 ${count} 个未提交外链`}
								>
									{opening ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
									{opening ? '打开中...' : `随机 ${count}`}
								</Button>
							)
						})()}
					</div>

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
										<div className="flex-1 min-w-0 overflow-hidden">
											{site.submit_url ? (
												<button
													type="button"
													className="w-full text-xs font-medium truncate text-left hover:underline hover:text-primary transition-colors"
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
											{onRetrySite && site.submit_url && (() => {
												const siteIsActive = hasActive && site.name === activeSiteName
												return (
													<button
														type="button"
														className={`p-1 rounded transition-colors ${
															siteIsActive
																? 'text-primary'
																: 'text-muted-foreground/50 hover:text-primary hover:bg-primary/10 dark:hover:bg-primary/20'
														}`}
														onClick={() => {
															if (!siteIsActive) onRetrySite(site)
														}}
														disabled={siteIsActive}
														title={siteIsActive ? '提交中...' : '重试自动提交'}
													>
														{siteIsActive
															? <Loader2 className="w-3.5 h-3.5 animate-spin" />
															: <Play className="w-3.5 h-3.5" />
														}
													</button>
												)
											})()}
											{onResetStatus && (
												<button
													type="button"
													className="p-1 rounded text-muted-foreground/50 hover:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-950/30 transition-colors"
													onClick={(e) => { e.stopPropagation(); onResetStatus(site.name) }}
													title="重置状态"
												>
													<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
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
									onResetStatus={onResetStatus}
									onSave={onSaveSite}
									disabled={hasActive && site.name !== activeSiteName}
									isActive={hasActive && site.name === activeSiteName}
								/>
							))
						)}
						{displaySites.length === 0 && (
							<div className="text-center text-xs text-muted-foreground py-8">
								{tab === 'all' && '没有匹配的站点'}
								{tab === 'undone' && '所有站点均已完成或失败'}
								{tab === 'done' && '暂无已提交或跳过的站点'}
								{tab === 'failed' && '暂无失败记录'}
							</div>
						)}
					</div>
				</>
			)}
		</div>
	)
}
