import { useEffect, useRef, useState, useCallback } from 'react'
import { ChevronRight, ChevronDown, Trash2, Info, CheckCircle2, AlertTriangle, XCircle, Copy, Check } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { LogEntry, LogLevel, LogPhase, LLMFieldData } from '@/agent/types'

interface ActivityLogProps {
	logs: LogEntry[]
	totalLogCount?: number
	onClear?: () => void
	llmFieldData?: LLMFieldData | null
	className?: string
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

const URL_RE = /https?:\/\/[^\s<>"')\]，】】]+/g

function linkify(text: string) {
	const parts: (string | JSX.Element)[] = []
	let lastIndex = 0
	for (const m of text.matchAll(URL_RE)) {
		if (m.index! > lastIndex) parts.push(text.slice(lastIndex, m.index!))
		const url = m[0]
		parts.push(
			<a key={m.index} href={url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 underline">
				{url}
			</a>
		)
		lastIndex = m.index! + url.length
	}
	if (lastIndex < text.length) parts.push(text.slice(lastIndex))
	return parts.length > 1 ? parts : text
}

function LogItem({ entry, expanded, onToggle }: { entry: LogEntry; expanded: boolean; onToggle: () => void }) {
	const config = LEVEL_CONFIG[entry.level]
	const Icon = config.icon
	const hasData = entry.data !== undefined && entry.data !== null

	return (
		<div className={cn('text-xs border-b border-border/30 last:border-b-0', config.bgClass)}>
			<div className="flex gap-2 px-3 py-1.5">
				<span className="shrink-0 text-[10px] text-muted-foreground tabular-nums pt-0.5 w-16">
					{formatTime(entry.timestamp)}
				</span>

				<Icon className={cn('shrink-0 w-3.5 h-3.5 mt-0.5', config.colorClass)} />

				<div className="flex-1 min-w-0 flex items-center gap-1.5">
					<span className="text-[9px] font-medium px-1 py-px rounded bg-muted/80 text-muted-foreground shrink-0">
						{PHASE_LABELS[entry.phase]}
					</span>
					<span className="truncate [&_a]:inline [&_a]:align-baseline">{linkify(entry.message)}</span>
					{hasData && (
						<button
							type="button"
							className="flex items-center gap-0.5 shrink-0 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer ml-auto"
							onClick={onToggle}
						>
							{expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
							{'详情'}
						</button>
					)}
				</div>
			</div>

			{expanded && hasData && (
				<pre className="mx-3 mb-1.5 mt-0.5 p-2 rounded bg-background/80 border border-border/50 text-[10px] text-muted-foreground overflow-x-auto max-h-80 overflow-y-auto whitespace-pre-wrap break-all">
					{typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data, null, 2)}
				</pre>
			)}
		</div>
	)
}

function LLMFieldValueItem({ label, value }: { label: string; value: string }) {
	const [copied, setCopied] = useState(false)

	const handleCopy = useCallback(async () => {
		await navigator.clipboard.writeText(value)
		setCopied(true)
		setTimeout(() => setCopied(false), 1500)
	}, [value])

	return (
		<div className="px-3 py-1.5 hover:bg-accent/30 transition-colors cursor-pointer border-b border-border/20 last:border-b-0" onClick={handleCopy}>
			<div className="text-[10px] text-muted-foreground mb-0.5">{label}</div>
			<div className="flex items-start gap-1.5">
				<div className="flex-1 text-xs text-foreground whitespace-pre-wrap break-all min-w-0">{value}</div>
				<span className="shrink-0 text-[10px] text-muted-foreground/60 mt-0.5 flex items-center gap-0.5">
					{copied ? (
						<>
							<Check className="w-3 h-3 text-green-500" />
							{'已复制'}
						</>
					) : (
						<Copy className="w-3 h-3" />
					)}
				</span>
			</div>
		</div>
	)
}

export function ActivityLog({ logs, totalLogCount, onClear, llmFieldData, className }: ActivityLogProps) {
	const displayCount = totalLogCount ?? logs.length
	const scrollRef = useRef<HTMLDivElement>(null)
	const userScrolledRef = useRef(false)
	const [expandedId, setExpandedId] = useState<number | null>(null)

	const toggleEntry = useCallback((id: number) => {
		setExpandedId((prev) => (prev === id ? null : id))
	}, [])

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

	return (
		<div className={cn('rounded-lg border border-border bg-card overflow-hidden flex flex-col', className)}>
			<div className="flex items-center justify-between px-3 py-2 border-b border-border/60 bg-muted/30 shrink-0">
				<span className="text-xs font-medium">{'活动日志'}</span>
				<div className="flex items-center gap-2">
					<span className="text-[10px] text-muted-foreground tabular-nums">
						{displayCount} 条
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
				className="flex-1 overflow-y-auto"
			>
				{logs.length === 0 ? (
					<div className="flex items-center justify-center h-full text-xs text-muted-foreground py-12">
						{'暂无提交记录'}
					</div>
				) : (
					logs.map((entry) => (
						<LogItem key={entry.id} entry={entry} expanded={expandedId === entry.id} onToggle={() => toggleEntry(entry.id)} />
					))
				)}
				{llmFieldData && llmFieldData.fields.length > 0 && (
					<div className="border-t border-border/60">
						<div className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/40 border-b border-border/30">
							<svg className="w-3 h-3 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
								<path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z" />
							</svg>
							<span className="text-[10px] font-medium text-muted-foreground">{'LLM 字段值'}</span>
							<span className="text-[9px] text-muted-foreground/60 ml-auto">{'点击复制'}</span>
						</div>
						{llmFieldData.fields.map((field, i) => (
							<LLMFieldValueItem key={i} label={field.label} value={field.value} />
						))}
					</div>
				)}
			</div>
		</div>
	)
}
