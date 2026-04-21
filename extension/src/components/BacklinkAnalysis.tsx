import type { BacklinkRecord, BacklinkStatus } from '@/lib/types'
import type { LogEntry } from '@/agent/types'
import { useRef, useState, Fragment, useEffect, useCallback } from 'react'
import { Button } from './ui/Button'
import { ActivityLog } from './ActivityLog'

interface BacklinkAnalysisProps {
	backlinks: BacklinkRecord[]
	analyzingId: string | null
	isRunning: boolean
	onImportCsv: (csvText: string) => Promise<{ imported: number; skipped: number }>
	onReload: () => void
	onStartAnalysis: (count: number) => void
	onAnalyzeOne: (backlink: BacklinkRecord) => void
	onAddUrl: (url: string) => Promise<{ success: boolean; error?: string }>
	onStop: () => void
	logs: LogEntry[]
	onClearLogs: () => void
}

type Tab = 'all' | 'done' | 'failed' | 'log'

const BACKLINK_STATUS_LABELS: Record<string, string> = {
	pending: '待分析',
	publishable: '可发布',
	not_publishable: '不可发布',
	error: '错误',
	skipped: '已跳过',
}

const DONE_STATUSES: BacklinkStatus[] = ['publishable', 'not_publishable', 'skipped']

const STATUS_COLORS: Record<BacklinkStatus, string> = {
	pending: 'bg-muted text-muted-foreground',
	publishable: 'bg-green-500/20 text-green-400',
	not_publishable: 'bg-red-500/20 text-red-400',
	skipped: 'bg-yellow-500/20 text-yellow-400',
	error: 'bg-destructive/20 text-destructive',
}

export function BacklinkAnalysis({
	backlinks,
	analyzingId,
	isRunning,
	onImportCsv,
	onReload,
	onStartAnalysis,
	onAnalyzeOne,
	onAddUrl,
	onStop,
	logs,
	onClearLogs,
}: BacklinkAnalysisProps) {
	const fileInputRef = useRef<HTMLInputElement>(null)
	const urlInputRef = useRef<HTMLInputElement>(null)
	const [batchCount, setBatchCount] = useState(20)
	const [importMsg, setImportMsg] = useState<string | null>(null)
	const [tab, setTab] = useState<Tab>('all')
	const [urlInput, setUrlInput] = useState('')
	const [adding, setAdding] = useState(false)
	const [expandedId, setExpandedId] = useState<string | null>(null)
	const lastAnalyzedRef = useRef<string | null>(null)

	useEffect(() => {
		if (isRunning) {
			setTab('log')
		}
	}, [isRunning])

	useEffect(() => {
		if (analyzingId) {
			lastAnalyzedRef.current = analyzingId
		} else if (lastAnalyzedRef.current) {
			if (!isRunning) {
				setExpandedId(lastAnalyzedRef.current)
			}
			lastAnalyzedRef.current = null
		}
	}, [analyzingId, isRunning])

	const filteredBacklinks = [...backlinks
		.filter(b => {
			if (tab === 'all' || tab === 'log') return true
			if (tab === 'done') return DONE_STATUSES.includes(b.status)
			return b.status === 'error'
		})
	].sort((a, b) => b.pageAscore - a.pageAscore)

	const stats = {
		total: backlinks.length,
		analyzed: backlinks.filter(b => b.status !== 'pending').length,
		publishable: backlinks.filter(b => b.status === 'publishable').length,
	}

	const tabs: { id: Tab; label: string; count: number }[] = [
		{ id: 'all', label: '全部', count: backlinks.length },
		{ id: 'done', label: '已完成', count: backlinks.filter(b => DONE_STATUSES.includes(b.status)).length },
		{ id: 'failed', label: '失败', count: backlinks.filter(b => b.status === 'error').length },
	]

	const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (!file) return
		const text = await file.text()
		const result = await onImportCsv(text)
		await onReload()
		setImportMsg(`成功导入 ${result.imported} 条新外链，${result.skipped} 条重复被跳过`)
		if (fileInputRef.current) fileInputRef.current.value = ''
		setTimeout(() => setImportMsg(null), 5000)
	}

	const handleAddUrl = useCallback(async () => {
		const raw = urlInput.trim()
		if (!raw) return
		setAdding(true)
		try {
			const urls = raw.split(',').map(u => u.trim()).filter(Boolean)
			let added = 0
			for (const url of urls) {
				const result = await onAddUrl(url)
				if (result.success) added++
			}
			setUrlInput('')
			urlInputRef.current?.focus()
			if (added > 0) {
				setImportMsg(`已添加 ${added} 条`)
				setTimeout(() => setImportMsg(null), 3000)
			}
		} finally {
			setAdding(false)
		}
	}, [urlInput, onAddUrl])

	return (
		<div className="flex flex-col h-full">
			{/* ── Toolbar: data actions + batch controls ── */}
			<div className="shrink-0 px-4 pt-3 pb-3 space-y-2">
				<div className="flex items-center gap-2">
					<input
						ref={fileInputRef}
						type="file"
						accept=".csv"
						className="hidden"
						onChange={handleFileChange}
					/>
					<Button
						variant="outline"
						size="xs"
						onClick={() => fileInputRef.current?.click()}
						disabled={isRunning}
					>
						{'导入 CSV'}
					</Button>

					<div className="w-px h-5 bg-border/60" />

					<div className="flex items-center gap-1.5 flex-1 min-w-0">
						<input
							ref={urlInputRef}
							type="url"
							className="flex-1 min-w-0 text-xs bg-background border border-border rounded-md px-2.5 h-7 focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/60"
							placeholder={'输入 URL，多条用逗号分隔'}
							value={urlInput}
							onChange={(e) => setUrlInput(e.target.value)}
							onKeyDown={(e) => { if (e.key === 'Enter') handleAddUrl() }}
							disabled={adding || isRunning}
						/>
						<Button
							variant="default"
							size="xs"
							onClick={handleAddUrl}
							disabled={adding || isRunning || !urlInput.trim()}
						>
							{adding ? '添加中...' : '添加 URL'}
						</Button>
					</div>

				</div>

				{/* Inline messages */}
				{importMsg && (
					<p className="text-xs text-green-400 pl-0.5">{importMsg}</p>
				)}

			</div>

			<div className="shrink-0 h-px bg-border/60 mx-4" />

			<div className="shrink-0 px-4 py-2 flex items-center gap-2">
				{isRunning ? (
					<Button variant="destructive" size="xs" onClick={onStop}>
						{'停止分析'}
					</Button>
				) : (
					<>
						<select
							className="text-xs bg-background border border-border rounded-md px-2 py-1 h-7"
							value={batchCount}
							onChange={e => setBatchCount(Number(e.target.value))}
						>
							<option value={10}>10</option>
							<option value={20}>20</option>
							<option value={50}>50</option>
						</select>
						<Button
							variant="default"
							size="xs"
							onClick={() => onStartAnalysis(batchCount)}
							disabled={stats.total === 0 || stats.analyzed === stats.total}
						>
							{'开始分析'}
						</Button>
					</>
				)}
				<div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
					<span className="tabular-nums">{'已分析 '}{stats.analyzed}{'/'}{stats.total}</span>
					{stats.publishable > 0 && (
						<span className="text-green-400 tabular-nums">{`${stats.publishable} 条可发布`}</span>
					)}
				</div>
			</div>

			{/* ── Filter tabs ── */}
			<div className="shrink-0 border-t border-border/60">
				<div className="flex items-center gap-0 border-b px-4">
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
			</div>

			{/* ── Content: ActivityLog or Table ── */}
			{tab === 'log' ? (
				<ActivityLog logs={logs} onClear={onClearLogs} className="flex-1" />
			) : (
				<div className="flex-1 overflow-y-auto">
				{filteredBacklinks.length === 0 ? (
					<div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
						{'暂无外链数据。请导入 Semrush 导出的 CSV 文件。'}
					</div>
				) : (
					<table className="w-full text-xs table-fixed">
						<thead className="sticky top-0 bg-background">
							<tr className="border-b border-border/60 text-muted-foreground">
								<th className="text-left px-3 py-1.5 font-normal w-10">{'AS'}</th>
								<th className="text-left px-3 py-1.5 font-normal">{'来源'}</th>
								<th className="text-left px-3 py-1.5 font-normal w-20">Status</th>
								<th className="text-right px-3 py-1.5 font-normal w-16">{'操作'}</th>
							</tr>
						</thead>
						<tbody>
							{filteredBacklinks.map(b => {
								const isAnalyzing = analyzingId === b.id
								const isDisabled = analyzingId !== null || isRunning
								const isExpanded = expandedId === b.id

								return (
									<Fragment key={b.id}>
										<tr className={`border-b border-border/40 transition-colors ${isAnalyzing ? 'bg-blue-500/5' : 'hover:bg-accent/30'}`}>
											<td className="px-3 py-1.5 text-primary font-medium">{b.pageAscore}</td>
											<td className="px-3 py-1.5 overflow-hidden">
												<a
													href={b.sourceUrl}
													target="_blank"
													rel="noopener noreferrer"
													className="truncate block text-primary hover:underline"
													title={b.sourceUrl}
												>
													{b.sourceTitle || b.sourceUrl}
												</a>
											</td>
											<td className="px-3 py-1.5">
												<span
													className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
														b.status !== 'pending' ? 'cursor-pointer hover:opacity-80' : 'cursor-default'
													} ${STATUS_COLORS[b.status]}`}
													title={(b.status === 'error' || b.status === 'not_publishable') && b.analysisLog?.length ? b.analysisLog.map(l => typeof l === 'string' ? l : JSON.stringify(l)).join('\n') : undefined}
													onClick={() => {
														if (b.status !== 'pending') {
															setExpandedId(isExpanded ? null : b.id)
														}
													}}
												>
													{BACKLINK_STATUS_LABELS[b.status] ?? b.status}
												</span>
											</td>
											<td className="px-3 py-1.5 text-right">
												<Button
													variant="ghost"
													size="sm"
													className="text-xs h-6 px-2"
													disabled={isDisabled}
													onClick={() => onAnalyzeOne(b)}
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
											</td>
										</tr>
										{isExpanded && b.status !== 'pending' && b.analysisLog?.length > 0 && (
											<tr className="border-b border-border/40">
												<td colSpan={4} className="px-4 py-2">
													<div className={`text-xs rounded px-3 py-1.5 border-l-2 ${
														b.status === 'publishable' ? 'bg-green-500/5 border-green-400 text-green-300'
															: b.status === 'error' ? 'bg-red-500/5 border-red-400 text-red-300'
																: b.status === 'skipped' ? 'bg-yellow-500/5 border-yellow-400/70 text-yellow-300/80'
																	: 'bg-red-500/5 border-red-400/70 text-red-300/80'
													}`}>
														{b.analysisLog.map((log, i) => (
															<div key={i}>{typeof log === 'string' ? log : JSON.stringify(log)}</div>
														))}
													</div>
												</td>
											</tr>
										)}
									</Fragment>
								)
							})}
						</tbody>
					</table>
				)}
				</div>
			)}
		</div>
	)
}
