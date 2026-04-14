import { useEffect, useRef, useState, useCallback } from 'react'
import { ChevronRight, ChevronDown, Trash2, Info, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { LogEntry, LogLevel, LogPhase } from '@/agent/types'

interface ActivityLogProps {
	logs: LogEntry[]
	onClear?: () => void
}

const LEVEL_CONFIG: Record<LogLevel, { icon: typeof Info; colorClass: string; bgClass: string }> = {
	info: {
		icon: Info,
		colorClass: 'text-blue-500 dark:text-blue-400',
		bgClass: 'bg-blue-50/50 dark:bg-blue-950/20',
	},
	success: {
		icon: CheckCircle2,
		colorClass: 'text-green-500 dark:text-green-400',
		bgClass: 'bg-green-50/50 dark:bg-green-950/20',
	},
	warning: {
		icon: AlertTriangle,
		colorClass: 'text-amber-500 dark:text-amber-400',
		bgClass: 'bg-amber-50/50 dark:bg-amber-950/20',
	},
	error: {
		icon: XCircle,
		colorClass: 'text-red-500 dark:text-red-400',
		bgClass: 'bg-red-50/50 dark:bg-red-950/20',
	},
}

const PHASE_LABELS: Record<LogPhase, string> = {
	analyze: '分析',
	llm: 'LLM',
	fill: '填写',
	system: '系统',
}

function formatTime(ts: number): string {
	const d = new Date(ts)
	return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function LogItem({ entry }: { entry: LogEntry }) {
	const [expanded, setExpanded] = useState(false)
	const config = LEVEL_CONFIG[entry.level]
	const Icon = config.icon
	const hasData = entry.data !== undefined && entry.data !== null

	return (
		<div className={cn('flex gap-2 px-3 py-1.5 text-xs border-b border-border/30 last:border-b-0', config.bgClass)}>
			<span className="shrink-0 text-[10px] text-muted-foreground tabular-nums pt-0.5 w-16">
				{formatTime(entry.timestamp)}
			</span>

			<Icon className={cn('shrink-0 w-3.5 h-3.5 mt-0.5', config.colorClass)} />

			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-1.5">
					<span className="text-[9px] font-medium px-1 py-px rounded bg-muted/80 text-muted-foreground shrink-0">
						{PHASE_LABELS[entry.phase]}
					</span>
					<span className="truncate">{entry.message}</span>
				</div>

				{hasData && (
					<div>
						<button
							type="button"
							className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground mt-0.5 cursor-pointer"
							onClick={() => setExpanded(!expanded)}
						>
							{expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
							{'详情'}
						</button>
						{expanded && (
							<pre className="mt-1 p-2 rounded bg-background/80 border border-border/50 text-[10px] text-muted-foreground overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
								{typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data, null, 2)}
							</pre>
						)}
					</div>
				)}
			</div>
		</div>
	)
}

export function ActivityLog({ logs, onClear }: ActivityLogProps) {
	const scrollRef = useRef<HTMLDivElement>(null)
	const userScrolledRef = useRef(false)

	useEffect(() => {
		if (!userScrolledRef.current && scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight
		}
	}, [logs.length])

	const handleScroll = useCallback(() => {
		if (!scrollRef.current) return
		const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
		userScrolledRef.current = scrollHeight - scrollTop - clientHeight > 20
	}, [])

	if (logs.length === 0) return null

	return (
		<div className="rounded-lg border border-border bg-card overflow-hidden">
			<div className="flex items-center justify-between px-3 py-2 border-b border-border/60 bg-muted/30">
				<span className="text-xs font-medium">{'活动日志'}</span>
				<div className="flex items-center gap-2">
					<span className="text-[10px] text-muted-foreground tabular-nums">
						{logs.length} 条
					</span>
					{onClear && (
						<button
							type="button"
							className="p-1 rounded text-muted-foreground/50 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer"
							onClick={onClear}
							title="清除日志"
						>
							<Trash2 className="w-3.5 h-3.5" />
						</button>
					)}
				</div>
			</div>

			<div
				ref={scrollRef}
				onScroll={handleScroll}
				className="max-h-60 overflow-y-auto"
			>
				{logs.map((entry) => (
					<LogItem key={entry.id} entry={entry} />
				))}
			</div>
		</div>
	)
}
