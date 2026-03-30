import type { SiteData, SubmissionRecord, SubmissionStatus } from '@/lib/types'
import { useMemo, useState } from 'react'
import { SiteCard } from './SiteCard'

interface DashboardProps {
	sites: SiteData[]
	submissions: Map<string, SubmissionRecord>
	onSelectSite: (site: SiteData) => void
}

type Tab = 'recommended' | 'all' | 'done'

const DONE_STATUSES: SubmissionStatus[] = ['submitted', 'approved', 'skipped']
const RECOMMENDED_LIMIT = 20

export function Dashboard({ sites, submissions, onSelectSite }: DashboardProps) {
	const [tab, setTab] = useState<Tab>('recommended')
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

	const recommendedSites = useMemo(() => {
		return submittableSites
			.filter((s) => {
				const status = submissions.get(s.name)?.status ?? 'not_started'
				return !DONE_STATUSES.includes(status) && status !== 'in_progress'
			})
			.sort((a, b) => b.dr - a.dr)
			.slice(0, RECOMMENDED_LIMIT)
	}, [submittableSites, submissions])

	const allSites = useMemo(() => {
		const q = search.toLowerCase()
		return sites
			.filter((s) => !q || s.name.toLowerCase().includes(q) || s.category?.toLowerCase().includes(q))
			.sort((a, b) => b.dr - a.dr)
	}, [sites, search])

	const doneSites = useMemo(() => {
		return sites.filter((s) => {
			const status = submissions.get(s.name)?.status
			return status && DONE_STATUSES.includes(status)
		})
	}, [sites, submissions])

	const pct = stats.total > 0 ? Math.round((stats.submitted / stats.total) * 100) : 0

	const tabs: { id: Tab; label: string; count: number }[] = [
		{ id: 'recommended', label: 'Recommended', count: recommendedSites.length },
		{ id: 'all', label: 'All', count: allSites.length },
		{ id: 'done', label: 'Done', count: doneSites.length },
	]

	const displaySites =
		tab === 'recommended' ? recommendedSites : tab === 'all' ? allSites : doneSites

	return (
		<div className="flex flex-col gap-2 h-full">
			{/* Progress */}
			<div className="px-1 space-y-1">
				<div className="flex items-center justify-between">
					<span className="text-xs font-medium">
						{stats.submitted} / {stats.total} submitted
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

			{/* Tabs */}
			<div className="flex gap-0 border-b">
				{tabs.map((t) => (
					<button
						key={t.id}
						type="button"
						onClick={() => setTab(t.id)}
						className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
							tab === t.id
								? 'border-primary text-foreground'
								: 'border-transparent text-muted-foreground hover:text-foreground'
						}`}
					>
						{t.label}
						<span className="ml-1 text-[10px] text-muted-foreground">{t.count}</span>
					</button>
				))}
			</div>

			{/* Search (All tab only) */}
			{tab === 'all' && (
				<input
					type="text"
					placeholder="Search sites..."
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					className="w-full px-2.5 py-1.5 text-xs rounded border border-border bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
				/>
			)}

			{/* Site list */}
			<div className="flex-1 overflow-y-auto space-y-1.5">
				{displaySites.map((site) => (
					<SiteCard
						key={site.name}
						site={site}
						status={submissions.get(site.name)?.status ?? 'not_started'}
						onSelect={onSelectSite}
					/>
				))}
				{displaySites.length === 0 && (
					<div className="text-center text-xs text-muted-foreground py-8">
						{tab === 'recommended' && 'All recommended sites are done!'}
						{tab === 'all' && 'No sites match your search'}
						{tab === 'done' && 'No submitted or skipped sites yet'}
					</div>
				)}
			</div>
		</div>
	)
}
