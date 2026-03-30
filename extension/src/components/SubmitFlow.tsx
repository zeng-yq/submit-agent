import type {
	AgentActivity,
	AgentStatus,
	HistoricalEvent,
} from '@page-agent/core'
import type { ProductProfile, SiteData, SubmissionRecord, SubmissionStatus } from '@/lib/types'
import { useState } from 'react'
import { Button } from './ui/Button'

interface SubmitFlowProps {
	site: SiteData
	product: ProductProfile | null
	submission?: SubmissionRecord
	agentStatus: AgentStatus
	agentActivity: AgentActivity | null
	agentHistory: HistoricalEvent[]
	agentError: string | null
	onStartSubmit: () => void
	onStop: () => void
	onMarkSubmitted: () => void
	onSkip: () => void
	onBack: () => void
}

function humanizeActivity(activity: AgentActivity): string {
	switch (activity.type) {
		case 'thinking':
			return 'Thinking...'
		case 'executing': {
			const tool = activity.tool
			if (tool === 'click') return 'Clicking an element...'
			if (tool === 'type' || tool === 'input_text') return 'Typing into a field...'
			if (tool === 'scroll') return 'Scrolling the page...'
			if (tool === 'navigate' || tool === 'goto') return 'Navigating to page...'
			if (tool === 'select') return 'Selecting an option...'
			if (tool === 'screenshot' || tool === 'snapshot') return 'Reading the page...'
			return `Running: ${tool}...`
		}
		case 'executed': {
			const tool = activity.tool
			if (tool === 'click') return 'Clicked an element'
			if (tool === 'type' || tool === 'input_text') return 'Filled in a field'
			if (tool === 'scroll') return 'Scrolled the page'
			if (tool === 'navigate' || tool === 'goto') return 'Navigated to page'
			if (tool === 'select') return 'Selected an option'
			if (tool === 'screenshot' || tool === 'snapshot') return 'Read the page'
			return `Done: ${tool}`
		}
		case 'retrying':
			return `Retrying... (${activity.attempt}/${activity.maxAttempts})`
		case 'error':
			return `Error: ${activity.message}`
		default:
			return ''
	}
}

function activityColor(activity: AgentActivity): string {
	switch (activity.type) {
		case 'thinking': return 'text-blue-700 dark:text-blue-200'
		case 'executing': return 'text-yellow-700 dark:text-yellow-300'
		case 'executed': return 'text-green-700 dark:text-green-300'
		case 'retrying': return 'text-amber-700 dark:text-amber-300'
		case 'error': return 'text-red-700 dark:text-red-300'
		default: return 'text-muted-foreground'
	}
}

function DebugLog({ history }: { history: HistoricalEvent[] }) {
	const [expanded, setExpanded] = useState(false)
	if (history.length === 0) return null
	return (
		<div className="mt-2">
			<button
				className="text-[10px] text-muted-foreground underline underline-offset-2"
				onClick={() => setExpanded(!expanded)}
			>
				{expanded ? 'Hide details' : 'View details'}
			</button>
			{expanded && (
				<div className="mt-2 max-h-48 overflow-y-auto space-y-1 rounded border border-border bg-muted/40 p-2">
					{history.map((event, i) => {
						if (event.type === 'step') {
							return (
								<div key={i} className="text-[10px] text-muted-foreground border-b border-border pb-1">
									<span className="font-medium text-foreground">Step {event.stepIndex + 1}:</span>{' '}
									{event.action.name}
									{event.reflection.next_goal && (
										<div className="truncate">→ {event.reflection.next_goal}</div>
									)}
								</div>
							)
						}
						if (event.type === 'error') {
							return (
								<div key={i} className="text-[10px] text-red-500">
									Error: {event.message}
								</div>
							)
						}
						return null
					})}
				</div>
			)}
		</div>
	)
}

export function SubmitFlow({
	site,
	product,
	submission,
	agentStatus,
	agentActivity,
	agentHistory,
	agentError,
	onStartSubmit,
	onStop,
	onMarkSubmitted,
	onSkip,
	onBack,
}: SubmitFlowProps) {
	const submissionStatus: SubmissionStatus = submission?.status ?? 'not_started'
	const isAgentRunning = agentStatus === 'running'
	const isCompleted = agentStatus === 'completed'
	const isError = agentStatus === 'error' || !!agentError
	const stepCount = agentHistory.filter((e) => e.type === 'step').length
	const alreadySubmitted = submissionStatus === 'submitted' || submissionStatus === 'approved'

	return (
		<div className="flex flex-col h-full">
			{/* Header */}
			<header className="flex items-center gap-2 border-b px-3 py-2">
				<button
					className="text-muted-foreground hover:text-foreground disabled:opacity-40 text-sm"
					onClick={onBack}
					disabled={isAgentRunning}
				>
					←
				</button>
				<span className="text-sm font-semibold truncate flex-1">{site.name}</span>
				<span className="text-xs text-muted-foreground shrink-0">
					DR {site.dr}
				</span>
				{site.link_type === 'dofollow' && (
					<span className="text-[10px] bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded shrink-0">
						Dofollow
					</span>
				)}
			</header>

			{/* Body */}
			<div className="flex-1 overflow-y-auto p-3 space-y-3">

				{/* === IDLE: not started or previously submitted === */}
				{!isAgentRunning && !isCompleted && !isError && (
					<>
						{/* Site info */}
						<div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
							<div className="flex items-center justify-between">
								<a href={site.url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-primary hover:underline truncate">
									{site.url.replace(/^https?:\/\/(www\.)?/, '')}
								</a>
								<span className="text-[10px] text-muted-foreground shrink-0 ml-2">{site.category}</span>
							</div>
							<div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
								<div className="flex items-center gap-1.5">
									<span className="text-muted-foreground">Traffic</span>
									<span className="font-medium">{site.monthly_traffic}</span>
								</div>
								<div className="flex items-center gap-1.5">
									<span className="text-muted-foreground">Pricing</span>
									<span className="font-medium capitalize">{site.pricing}</span>
								</div>
								<div className="flex items-center gap-1.5">
									<span className="text-muted-foreground">Link</span>
									<span className={`font-medium ${site.link_type === 'dofollow' ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
										{site.link_type === 'dofollow' ? 'Dofollow' : 'Nofollow'}
									</span>
								</div>
								<div className="flex items-center gap-1.5">
									<span className="text-muted-foreground">Method</span>
									<span className="font-medium capitalize">{site.submission_method.replace(/-/g, ' ')}</span>
								</div>
							</div>
							{site.notes && (
								<p className="text-[11px] text-muted-foreground italic border-t border-border pt-2">{site.notes}</p>
							)}
						</div>

						{/* Already submitted notice */}
						{alreadySubmitted && (
							<div className="rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950 p-3 text-xs text-green-700 dark:text-green-300">
								You already submitted to this site.
							</div>
						)}

						{/* Submitting as */}
						{product ? (
							<div className="rounded-lg border border-border p-3 space-y-1">
								<div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Submitting as</div>
								<div className="text-xs font-medium text-foreground">{product.name}</div>
								{(product.tagline || product.shortDesc) && (
									<div className="text-xs text-muted-foreground line-clamp-2">{product.tagline || product.shortDesc}</div>
								)}
							</div>
						) : (
							<div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 p-3 text-xs text-amber-700 dark:text-amber-300">
								No product profile. Please create one in the Options page.
							</div>
						)}
					</>
				)}

				{/* === RUNNING === */}
				{isAgentRunning && (
					<div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950 p-4 space-y-3">
						<div className="flex items-center gap-2">
							<span className="relative flex h-2 w-2">
								<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
								<span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
							</span>
							<span className="text-xs font-medium text-blue-700 dark:text-blue-300">Agent is working...</span>
							{stepCount > 0 && (
								<span className="ml-auto text-[10px] text-blue-500 dark:text-blue-400">{stepCount} steps</span>
							)}
						</div>
						{agentActivity ? (
							<div className={`text-xs ${activityColor(agentActivity)}`}>
								{humanizeActivity(agentActivity)}
							</div>
						) : (
							<div className="text-xs text-blue-500 dark:text-blue-400">Initializing...</div>
						)}
						<DebugLog history={agentHistory} />
					</div>
				)}

				{/* === COMPLETED === */}
				{isCompleted && !isError && (
					<div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950 p-4 space-y-2">
						<div className="flex items-center gap-2">
							<span className="text-green-600 dark:text-green-400 text-base">✓</span>
							<span className="text-xs font-medium text-green-700 dark:text-green-300">
								Form filled — please review and submit
							</span>
						</div>
						<p className="text-xs text-green-600 dark:text-green-400">
							The agent has filled the form. Open the page to review the fields and click the final submit button.
						</p>
						<DebugLog history={agentHistory} />
					</div>
				)}

				{/* === ERROR === */}
				{isError && (
					<div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 p-4 space-y-2">
						<div className="flex items-center gap-2">
							<span className="text-red-500 text-base">✕</span>
							<span className="text-xs font-medium text-red-700 dark:text-red-300">Something went wrong</span>
						</div>
						{agentError && (
							<p className="text-xs text-red-600 dark:text-red-400">
								{agentError}
							</p>
						)}
						<DebugLog history={agentHistory} />
					</div>
				)}

			</div>

			{/* Footer actions */}
			<footer className="border-t p-3 space-y-2">
				{/* Running: only show Stop */}
				{isAgentRunning && (
					<Button variant="outline" size="sm" className="w-full" onClick={onStop}>
						Stop
					</Button>
				)}

				{/* Completed: primary = open & submit, secondary = mark done */}
				{isCompleted && !isError && (
					<>
						{site.submit_url && (
							<Button
								className="w-full"
								onClick={() => window.open(site.submit_url!, '_blank')}
							>
								Open page & submit
							</Button>
						)}
						<Button variant="outline" size="sm" className="w-full" onClick={onMarkSubmitted}>
							Mark as submitted
						</Button>
					</>
				)}

				{/* Idle / Error: primary = start, secondary = open manually */}
				{!isAgentRunning && !isCompleted && (
					<>
						{site.submit_url ? (
							<Button
								className="w-full"
								disabled={!product}
								onClick={onStartSubmit}
							>
								{isError ? 'Retry Auto-Submit' : alreadySubmitted ? 'Re-Submit' : 'Start Auto-Submit'}
							</Button>
						) : (
							<div className="text-xs text-muted-foreground text-center py-1">
								No direct submit URL — use manual submission
							</div>
						)}
						<div className="flex gap-2">
							{site.submit_url && (
								<Button
									variant="outline"
									size="sm"
									className="flex-1"
									onClick={() => window.open(site.submit_url!, '_blank')}
								>
									Open manually
								</Button>
							)}
							<Button
								variant="ghost"
								size="sm"
								className="flex-1"
								onClick={onSkip}
							>
								Skip
							</Button>
						</div>
					</>
				)}
			</footer>
		</div>
	)
}