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

const statusLabelKey: Record<SubmissionStatus, string> = {
	not_started: '',
	in_progress: '进行中',
	submitted: '已提交',
	approved: '已通过',
	rejected: '已拒绝',
	failed: '失败',
	skipped: '已跳过',
}

export function SiteCard({ site, status = 'not_started', onSelect }: SiteCardProps) {
	const hasSubmitUrl = !!site.submit_url
	const bar = statusBar[status]
	const labelKey = statusLabelKey[status]

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
						<span className="text-[9px] text-muted-foreground shrink-0">手动</span>
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
				{site.pricing && (
					<span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
						{site.pricing.startsWith('Free') ? 'Free' : 'Paid'}
					</span>
				)}
				{labelKey && (
					<span className="text-[9px] text-muted-foreground">{labelKey}</span>
				)}
			</div>
		</div>
	)
}
