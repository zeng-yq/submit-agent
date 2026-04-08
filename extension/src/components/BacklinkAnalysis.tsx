import type { BacklinkRecord, BacklinkStatus } from '@/lib/types'
import type { AnalysisStep } from '@/lib/backlink-analyzer'
import { useRef, useState, Fragment, useEffect, useCallback } from 'react'
import { useT } from '@/hooks/useLanguage'
import { Button } from './ui/Button'

interface BacklinkAnalysisProps {
	backlinks: BacklinkRecord[]
	analyzingId: string | null
	currentStep: AnalysisStep | null
	currentIndex: number
	batchSize: number
	isRunning: boolean
	onImportCsv: (csvText: string) => Promise<{ imported: number; skipped: number }>
	onReload: () => void
	onStartAnalysis: (count: number) => void
	onAnalyzeOne: (backlink: BacklinkRecord) => void
	onAddUrl: (url: string) => Promise<{ success: boolean; error?: string }>
	onStop: () => void
	onBack: () => void
}

const STATUS_COLORS: Record<BacklinkStatus, string> = {
	pending: 'bg-muted text-muted-foreground',
	publishable: 'bg-green-500/20 text-green-400',
	not_publishable: 'bg-red-500/20 text-red-400',
	error: 'bg-destructive/20 text-destructive',
}

export function BacklinkAnalysis({
	backlinks,
	analyzingId,
	currentStep,
	currentIndex,
	batchSize,
	isRunning,
	onImportCsv,
	onReload,
	onStartAnalysis,
	onAnalyzeOne,
	onAddUrl,
	onStop,
	onBack,
}: BacklinkAnalysisProps) {
	const t = useT()
	const fileInputRef = useRef<HTMLInputElement>(null)
	const urlInputRef = useRef<HTMLInputElement>(null)
	const [batchCount, setBatchCount] = useState(20)
	const [importMsg, setImportMsg] = useState<string | null>(null)
	const [statusFilter, setStatusFilter] = useState<BacklinkStatus | 'all'>('all')
	const [urlInput, setUrlInput] = useState('')
	const [urlError, setUrlError] = useState<string | null>(null)
	const [adding, setAdding] = useState(false)
	const [expandedId, setExpandedId] = useState<string | null>(null)
	const lastAnalyzedRef = useRef<string | null>(null)

	useEffect(() => {
		if (analyzingId) {
			lastAnalyzedRef.current = analyzingId
		} else if (lastAnalyzedRef.current) {
			// Analysis just completed — auto-expand if not in batch mode
			if (!isRunning) {
				setExpandedId(lastAnalyzedRef.current)
			}
			lastAnalyzedRef.current = null
		}
	}, [analyzingId, isRunning])

	const filteredBacklinks = [...(statusFilter === 'all'
		? backlinks
		: backlinks.filter(b => b.status === statusFilter))].sort((a, b) => b.pageAscore - a.pageAscore)

	const stats = {
		total: backlinks.length,
		analyzed: backlinks.filter(b => b.status !== 'pending').length,
		publishable: backlinks.filter(b => b.status === 'publishable').length,
	}

	const getDomain = (url: string) => {
		try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
	}

	const analyzingBacklink = analyzingId ? backlinks.find(b => b.id === analyzingId) : null

	const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (!file) return
		const text = await file.text()
		const result = await onImportCsv(text)
		await onReload()
		setImportMsg(t('backlink.importResult', { imported: result.imported, skipped: result.skipped }))
		if (fileInputRef.current) fileInputRef.current.value = ''
		setTimeout(() => setImportMsg(null), 5000)
	}

	const handleAddUrl = useCallback(async () => {
		setUrlError(null)
		const url = urlInput.trim()
		if (!url) {
			setUrlError(t('backlink.addUrlInvalid'))
			return
		}
		setAdding(true)
		try {
			const result = await onAddUrl(url)
			if (!result.success) {
				setUrlError(t(result.error === 'Duplicate URL' ? 'backlink.addUrlDuplicate' : 'backlink.addUrlInvalid'))
				return
			}
			setUrlInput('')
			urlInputRef.current?.focus()
		} finally {
			setAdding(false)
		}
	}, [urlInput, onAddUrl, t])

	return (
		<div className="flex flex-col h-full">
			{/* Header */}
			<header className="flex items-center justify-between border-b border-border/60 px-4 py-3">
				<span className="text-base font-semibold">{t('backlink.title')}</span>
				<Button variant="ghost" size="sm" onClick={onBack}>
					{t('common.back')}
				</Button>
			</header>

			{/* Action bar */}
			<div className="border-b border-border/60 px-3 py-2 flex items-center gap-2 flex-wrap">
				<input
					ref={fileInputRef}
					type="file"
					accept=".csv"
					className="hidden"
					onChange={handleFileChange}
				/>
				<Button
					variant="outline"
					size="sm"
					onClick={() => fileInputRef.current?.click()}
					disabled={isRunning}
				>
					{t('backlink.importCsv')}
				</Button>
				{isRunning ? (
					<Button variant="destructive" size="sm" onClick={onStop}>
						{t('backlink.stopAnalysis')}
					</Button>
				) : (
					<div className="flex items-center gap-1.5">
						<select
							className="text-xs bg-background border border-border rounded px-1.5 py-1"
							value={batchCount}
							onChange={e => setBatchCount(Number(e.target.value))}
						>
							<option value={10}>10</option>
							<option value={20}>20</option>
							<option value={50}>50</option>
						</select>
						<Button
							variant="default"
							size="sm"
							onClick={() => onStartAnalysis(batchCount)}
							disabled={stats.total === 0 || stats.analyzed === stats.total}
						>
							{t('backlink.startAnalysis')}
						</Button>
					</div>
				)}

				<div className="ml-auto text-xs text-muted-foreground flex items-center gap-2">
					<span>{t('backlink.stats', { analyzed: stats.analyzed, total: stats.total })}</span>
					{stats.publishable > 0 && (
						<span className="text-green-400">{t('backlink.statsPublishable', { count: stats.publishable })}</span>
					)}
				</div>
			</div>

			{/* Inline Add URL */}
			<div className="border-b border-border/60 px-3 py-2 flex items-center gap-2">
				<input
					ref={urlInputRef}
					type="url"
					className="flex-1 text-xs bg-background border border-border rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
					placeholder={t('backlink.addUrlPlaceholder')}
					value={urlInput}
					onChange={(e) => { setUrlInput(e.target.value); setUrlError(null) }}
					onKeyDown={(e) => { if (e.key === 'Enter') handleAddUrl() }}
					disabled={adding || isRunning}
				/>
				<Button
					variant="default"
					size="sm"
					onClick={handleAddUrl}
					disabled={adding || isRunning}
				>
					{adding ? t('backlink.adding') : t('backlink.addUrl')}
				</Button>
			</div>
			{urlError && (
				<div className="px-3 py-1 text-[10px] text-destructive border-b border-border/60">
					{urlError}
				</div>
			)}

			{/* Import feedback */}
			{importMsg && (
				<div className="px-3 py-1.5 text-xs bg-green-500/10 text-green-400 border-b border-border/60">
					{importMsg}
				</div>
			)}

			{/* Progress indicator */}
			{(isRunning || analyzingId) && (
				<div className="px-3 py-1.5 flex items-center gap-1.5 text-xs text-muted-foreground border-b border-border/60">
					<span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
					{analyzingBacklink ? (
						<>
							{isRunning
								? t('backlink.analyzing', { current: currentIndex + 1, total: batchSize })
								: t('backlink.analyzingSingle', { domain: getDomain(analyzingBacklink.sourceUrl) })
							}
							{isRunning && (
								<span className="text-muted-foreground/80">
									{' — '}
									{getDomain(analyzingBacklink.sourceUrl)}
								</span>
							)}
							{currentStep && (
								<span className="text-muted-foreground/60">
									{' — '}
									{t(`backlink.step.${currentStep}` as any)}
								</span>
							)}
						</>
					) : isRunning ? (
						t('backlink.analyzingIn')
					) : null}
				</div>
			)}

			{/* Filter tabs */}
			<div className="px-3 py-1.5 flex items-center gap-1 border-b border-border/60">
				{(['all', 'pending', 'publishable', 'not_publishable', 'error'] as const).map(s => (
					<button
						key={s}
						type="button"
						className={`text-xs px-2 py-0.5 rounded transition-colors cursor-pointer ${
							statusFilter === s ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
						}`}
						onClick={() => setStatusFilter(s)}
					>
						{s === 'all' ? 'All' : t(`backlink.status.${s}` as any)}
					</button>
				))}
			</div>

			{/* Table */}
			<div className="flex-1 overflow-y-auto">
				{filteredBacklinks.length === 0 ? (
					<div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
						{t('backlink.noData')}
					</div>
				) : (
					<table className="w-full text-xs table-fixed">
						<thead className="sticky top-0 bg-background">
							<tr className="border-b border-border/60 text-muted-foreground">
								<th className="text-left px-3 py-1.5 font-normal w-10">{t('backlink.ascore')}</th>
								<th className="text-left px-3 py-1.5 font-normal">{t('backlink.source')}</th>
								<th className="text-left px-3 py-1.5 font-normal w-20">Status</th>
								<th className="text-right px-3 py-1.5 font-normal w-16">{t('backlink.action')}</th>
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
													{t(`backlink.status.${b.status}` as any)}
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
														<span className="flex items-center gap-1">
															<svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
																<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
																<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
															</svg>
															{t('backlink.analyzingIn')}
														</span>
													) : (
														t('backlink.analyze')
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
		</div>
	)
}
