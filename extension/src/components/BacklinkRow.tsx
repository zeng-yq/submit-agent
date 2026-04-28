import type { BacklinkRecord } from '@/lib/types'
import { Fragment } from 'react'
import { Button } from './ui/Button'

interface BacklinkRowProps {
	backlink: BacklinkRecord
	isAnalyzing: boolean
	isDisabled: boolean
	isExpanded: boolean
	onToggleExpand: () => void
	onAnalyze: () => void
}

const BACKLINK_STATUS_LABELS: Record<string, string> = {
	pending: '待分析',
	publishable: '可发布',
	not_publishable: '不可发布',
	error: '错误',
	skipped: '已跳过',
}

const STATUS_COLORS: Record<string, string> = {
	pending: 'bg-muted text-muted-foreground',
	publishable: 'bg-green-500/20 text-green-400',
	not_publishable: 'bg-red-500/20 text-red-400',
	skipped: 'bg-yellow-500/20 text-yellow-400',
	error: 'bg-destructive/20 text-destructive',
}

export function BacklinkRow({
	backlink: b,
	isAnalyzing,
	isDisabled,
	isExpanded,
	onToggleExpand,
	onAnalyze,
}: BacklinkRowProps) {
	return (
		<Fragment>
			<div className={`grid grid-cols-[2.5rem_1fr_5rem_4rem] h-9 items-center border-b border-border/40 transition-colors text-xs ${isAnalyzing ? 'bg-blue-500/5' : 'hover:bg-accent/30'}`}>
				<div className="px-3 text-primary font-medium">{b.pageAscore}</div>
				<div className="px-3 overflow-hidden">
					<a
						href={b.sourceUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="truncate block text-primary hover:underline"
						title={b.sourceUrl}
					>
						{b.sourceTitle || b.sourceUrl}
					</a>
				</div>
				<div className="px-3">
					<span
						className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
							b.status !== 'pending' ? 'cursor-pointer hover:opacity-80' : 'cursor-default'
						} ${STATUS_COLORS[b.status]}`}
						title={(b.status === 'error' || b.status === 'not_publishable') && b.analysisLog?.length ? b.analysisLog.map(l => typeof l === 'string' ? l : JSON.stringify(l)).join('\n') : undefined}
						onClick={() => {
							if (b.status !== 'pending') {
								onToggleExpand()
							}
						}}
					>
						{BACKLINK_STATUS_LABELS[b.status] ?? b.status}
					</span>
				</div>
				<div className="px-3 text-right">
					<Button
						variant="ghost"
						size="sm"
						className="text-xs h-6 px-2"
						disabled={isDisabled}
						onClick={onAnalyze}
					>
						{isAnalyzing ? (
							<svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
								<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
								<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
							</svg>
						) : (
							'分析'
						)}
					</Button>
				</div>
			</div>
			{isExpanded && b.status !== 'pending' && b.analysisLog?.length > 0 && (
				<div className="border-b border-border/40 px-4 py-2">
					<div className={`text-xs rounded px-3 border-l-2 ${
						b.status === 'publishable' ? 'bg-green-500/5 border-green-400 text-green-300'
							: b.status === 'error' ? 'bg-red-500/5 border-red-400 text-red-300'
								: b.status === 'skipped' ? 'bg-yellow-500/5 border-yellow-400/70 text-yellow-300/80'
									: 'bg-red-500/5 border-red-400/70 text-red-300/80'
					}`}>
						{b.analysisLog.map((log, i) => (
							<div key={i}>{typeof log === 'string' ? log : JSON.stringify(log)}</div>
						))}
					</div>
				</div>
			)}
		</Fragment>
	)
}
