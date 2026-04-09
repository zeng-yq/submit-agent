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
