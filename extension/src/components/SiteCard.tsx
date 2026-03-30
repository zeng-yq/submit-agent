import type { SiteData, SubmissionStatus } from '@/lib/types'

interface SiteCardProps {
	site: SiteData
	status?: SubmissionStatus
	onSelect?: (site: SiteData) => void
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

const statusLabel: Record<SubmissionStatus, string> = {
	not_started: '',
	in_progress: 'In Progress',
	submitted: 'Submitted',
	approved: 'Approved',
	rejected: 'Rejected',
	failed: 'Failed',
	skipped: 'Skipped',
}

export function SiteCard({ site, status = 'not_started', onSelect }: SiteCardProps) {
	const hasSubmitUrl = !!site.submit_url
	const bar = statusBar[status]
	const label = statusLabel[status]

	return (
		<div
			className={`relative flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
				hasSubmitUrl
					? 'cursor-pointer hover:border-primary/60 hover:bg-accent/30'
					: 'opacity-50 cursor-default'
			}`}
			onClick={() => onSelect?.(site)}
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
					<span className="text-xs font-medium truncate">{site.name}</span>
					{!hasSubmitUrl && (
						<span className="text-[9px] text-muted-foreground shrink-0">manual</span>
					)}
				</div>
				<div className="flex items-center gap-1.5 mt-0.5">
					{site.category && (
						<span className="text-[10px] text-muted-foreground truncate">{site.category}</span>
					)}
				</div>
			</div>

			{/* Right badges */}
			<div className="shrink-0 flex flex-col items-end gap-1">
				<span
					className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
						site.link_type === 'dofollow'
							? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
							: 'bg-muted text-muted-foreground'
					}`}
				>
					{site.link_type === 'dofollow' ? 'DF' : 'NF'}
				</span>
				{label && (
					<span className="text-[9px] text-muted-foreground">{label}</span>
				)}
			</div>
		</div>
	)
}
