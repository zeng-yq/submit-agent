import type {
	AgentActivity,
	AgentStatus,
	HistoricalEvent,
} from '@page-agent/core'
import type { ProductProfile, SiteData, SubmissionRecord, SubmissionStatus } from '@/lib/types'
import { useState } from 'react'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card'

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
	onSkip: () => void
	onBack: () => void
}

function ActivityIndicator({ activity }: { activity: AgentActivity }) {
	switch (activity.type) {
		case 'thinking':
			return <span className="text-blue-600 dark:text-blue-400">Thinking...</span>
		case 'executing':
			return (
				<span className="text-yellow-600 dark:text-yellow-400">
					Executing: {activity.tool}
				</span>
			)
		case 'executed':
			return (
				<span className="text-green-600 dark:text-green-400">
					Done: {activity.tool} ({activity.duration}ms)
				</span>
			)
		case 'retrying':
			return (
				<span className="text-amber-600 dark:text-amber-400">
					Retrying ({activity.attempt}/{activity.maxAttempts})...
				</span>
			)
		case 'error':
			return (
				<span className="text-red-600 dark:text-red-400">
					Error: {activity.message}
				</span>
			)
	}
}

function StepLog({ history }: { history: HistoricalEvent[] }) {
	const [expanded, setExpanded] = useState(false)

	if (history.length === 0) return null

	const stepEvents = history.filter((e) => e.type === 'step')
	const errorEvents = history.filter((e) => e.type === 'error')

	return (
		<Card>
			<CardHeader>
				<button
					className="flex items-center justify-between w-full text-left"
					onClick={() => setExpanded(!expanded)}
				>
					<CardTitle>
						Agent Log ({stepEvents.length} steps)
					</CardTitle>
					<span className="text-xs text-muted-foreground">
						{expanded ? 'collapse' : 'expand'}
					</span>
				</button>
			</CardHeader>
			{expanded && (
				<CardContent className="space-y-2 max-h-60 overflow-y-auto">
					{history.map((event, i) => {
						if (event.type === 'step') {
							return (
								<div key={i} className="text-xs border-b border-border pb-1">
									<div className="font-medium text-foreground">
										Step {event.stepIndex + 1}: {event.action.name}
									</div>
									{event.reflection.next_goal && (
										<div className="text-muted-foreground mt-0.5">
											Goal: {event.reflection.next_goal}
										</div>
									)}
									<div className="text-muted-foreground mt-0.5 truncate">
										Result: {event.action.output}
									</div>
								</div>
							)
						}
						if (event.type === 'error') {
							return (
								<div
									key={i}
									className="text-xs text-red-600 dark:text-red-400 border-b border-border pb-1"
								>
									Error: {event.message}
								</div>
							)
						}
						if (event.type === 'observation') {
							return (
								<div
									key={i}
									className="text-xs text-blue-600 dark:text-blue-400 border-b border-border pb-1"
								>
									{event.content}
								</div>
							)
						}
						if (event.type === 'retry') {
							return (
								<div
									key={i}
									className="text-xs text-amber-600 dark:text-amber-400 border-b border-border pb-1"
								>
									{event.message}
								</div>
							)
						}
						return null
					})}
				</CardContent>
			)}
			{!expanded && errorEvents.length > 0 && (
				<CardContent>
					<div className="text-xs text-red-600 dark:text-red-400">
						{errorEvents.length} error(s) occurred
					</div>
				</CardContent>
			)}
		</Card>
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
	onSkip,
	onBack,
}: SubmitFlowProps) {
	const submissionStatus: SubmissionStatus = submission?.status ?? 'not_started'
	const isAgentRunning = agentStatus === 'running'

	return (
		<div className="flex flex-col h-full">
			<header className="flex items-center justify-between border-b px-3 py-2">
				<span className="text-sm font-semibold truncate">{site.name}</span>
				<Button variant="ghost" size="sm" onClick={onBack} disabled={isAgentRunning}>
					Back
				</Button>
			</header>

			<div className="flex-1 overflow-y-auto p-3 space-y-3">
				{/* Agent status */}
				{isAgentRunning && (
					<Card className="border-blue-300 dark:border-blue-700">
						<CardHeader>
							<CardTitle>Agent Running</CardTitle>
							<Badge variant="warning">running</Badge>
						</CardHeader>
						<CardContent className="text-xs space-y-1">
							{agentActivity && <ActivityIndicator activity={agentActivity} />}
							{!agentActivity && (
								<span className="text-muted-foreground">Initializing...</span>
							)}
						</CardContent>
					</Card>
				)}

				{agentStatus === 'completed' && (
					<Card className="border-green-300 dark:border-green-700">
						<CardContent className="text-xs text-green-600 dark:text-green-400 py-2">
							Agent completed successfully.
						</CardContent>
					</Card>
				)}

				{(agentStatus === 'error' || agentError) && (
					<Card className="border-red-300 dark:border-red-700">
						<CardHeader>
							<CardTitle>Error</CardTitle>
							<Badge variant="destructive">failed</Badge>
						</CardHeader>
						<CardContent className="text-xs text-red-600 dark:text-red-400 wrap-break-word">
							{agentError || 'Agent encountered an error. Check the log below for details.'}
						</CardContent>
					</Card>
				)}

				{/* Step log */}
				<StepLog history={agentHistory} />

				{/* Site info */}
				<Card>
					<CardHeader>
						<CardTitle>Site Details</CardTitle>
						<Badge variant="outline">DR {site.dr}</Badge>
					</CardHeader>
					<CardContent className="space-y-1">
						<div className="flex justify-between">
							<span>Category</span>
							<span>{site.category}</span>
						</div>
						<div className="flex justify-between">
							<span>Traffic</span>
							<span>{site.monthly_traffic}</span>
						</div>
						<div className="flex justify-between">
							<span>Link Type</span>
							<span>{site.link_type === 'dofollow' ? 'Dofollow' : 'Nofollow'}</span>
						</div>
						<div className="flex justify-between">
							<span>Pricing</span>
							<span>{site.pricing}</span>
						</div>
						{site.notes && (
							<div className="pt-1 text-muted-foreground italic">{site.notes}</div>
						)}
					</CardContent>
				</Card>

				{/* Product check */}
				{!product && (
					<Card className="border-warning">
						<CardContent className="text-warning text-xs py-2">
							No product profile selected. Please create one in the Options page first.
						</CardContent>
					</Card>
				)}

				{product && (
					<Card>
						<CardHeader>
							<CardTitle>Product</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="font-medium text-foreground">{product.name}</div>
							<div className="mt-1">{product.tagline}</div>
						</CardContent>
					</Card>
				)}

				{/* Submission status */}
				{submission && (
					<Card>
						<CardHeader>
							<CardTitle>Submission</CardTitle>
							<Badge
								variant={
									submissionStatus === 'submitted' || submissionStatus === 'approved'
										? 'success'
										: submissionStatus === 'failed' || submissionStatus === 'rejected'
											? 'destructive'
											: submissionStatus === 'in_progress'
												? 'warning'
												: 'muted'
								}
							>
								{submissionStatus}
							</Badge>
						</CardHeader>
						{submission.notes && <CardContent>{submission.notes}</CardContent>}
					</Card>
				)}
			</div>

			{/* Actions */}
			<footer className="border-t p-3 space-y-2">
				{isAgentRunning ? (
					<Button
						variant="destructive"
						className="w-full"
						onClick={onStop}
					>
						Stop Agent
					</Button>
				) : (
					<>
						{site.submit_url && (
							<Button
								className="w-full"
								disabled={!product || submissionStatus === 'in_progress'}
								onClick={onStartSubmit}
							>
								{submissionStatus === 'not_started' || submissionStatus === 'failed'
									? 'Start Auto-Submit'
									: 'Re-Submit'}
							</Button>
						)}
						{!site.submit_url && (
							<div className="text-xs text-muted-foreground text-center py-1">
								No direct submit URL available for this site
							</div>
						)}
					</>
				)}
				<div className="flex gap-2">
					{site.submit_url && (
						<Button
							variant="outline"
							size="sm"
							className="flex-1"
							onClick={() => window.open(site.submit_url!, '_blank')}
						>
							Open Manually
						</Button>
					)}
					<Button
						variant="ghost"
						size="sm"
						className="flex-1"
						onClick={onSkip}
						disabled={isAgentRunning}
					>
						Skip
					</Button>
				</div>
			</footer>
		</div>
	)
}
