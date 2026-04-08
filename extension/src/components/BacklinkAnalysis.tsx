import type { BacklinkRecord, BacklinkStatus } from '@/lib/types'
import type { AnalysisStep } from '@/lib/backlink-analyzer'
import { useRef, useState } from 'react'
import { useT } from '@/hooks/useLanguage'
import { importBacklinksFromCsv } from '@/lib/backlinks'
import { Button } from './ui/Button'

interface BacklinkAnalysisProps {
	backlinks: BacklinkRecord[]
	currentStep: AnalysisStep | null
	currentIndex: number
	batchSize: number
	isRunning: boolean
	onImportCsv: (csvText: string) => Promise<{ imported: number; skipped: number }>
	onReload: () => void
	onStartAnalysis: (count: number) => void
	onAnalyzeOne: (backlink: BacklinkRecord) => void
	onStop: () => void
	onBack: () => void
}

const STATUS_COLORS: Record<BacklinkStatus, string> = {
	pending: 'bg-muted text-muted-foreground',
	publishable: 'bg-green-500/20 text-green-400',
	not_publishable: 'bg-red-500/20 text-red-400',
	error: 'bg-destructive/20 text-destructive',
}

const STEP_LABELS: Record<AnalysisStep, string> = {
	opening: 'Opening page...',
	loading: 'Loading page...',
	analyzing: 'Analyzing content...',
	done: 'Done',
}

export function BacklinkAnalysis({
	backlinks,
	currentStep,
	currentIndex,
	batchSize,
	isRunning,
	onImportCsv,
	onReload,
	onStartAnalysis,
	onAnalyzeOne,
	onStop,
	onBack,
}: BacklinkAnalysisProps) {
	const t = useT()
	const fileInputRef = useRef<HTMLInputElement>(null)
	const [batchCount, setBatchCount] = useState(20)
	const [importMsg, setImportMsg] = useState<string | null>(null)
	const [statusFilter, setStatusFilter] = useState<BacklinkStatus | 'all'>('all')

	const filteredBacklinks = [...(statusFilter === 'all'
		? backlinks
		: backlinks.filter(b => b.status === statusFilter))].sort((a, b) => b.pageAscore - a.pageAscore)

	const stats = {
		total: backlinks.length,
		analyzed: backlinks.filter(b => b.status !== 'pending').length,
		publishable: backlinks.filter(b => b.status === 'publishable').length,
	}

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

			{/* Import feedback */}
			{importMsg && (
				<div className="px-3 py-1.5 text-xs bg-green-500/10 text-green-400 border-b border-border/60">
					{importMsg}
				</div>
			)}

			{/* Progress indicator */}
			{isRunning && (
				<div className="px-3 py-1.5 flex items-center gap-1.5 text-xs text-muted-foreground border-b border-border/60">
					<span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
					{t('backlink.analyzing', { current: currentIndex + 1, total: batchSize })}
					{currentStep && (
						<span className="text-muted-foreground/60">
							{' — '}
							{STEP_LABELS[currentStep]}
						</span>
					)}
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
					<table className="w-full text-xs">
						<thead className="sticky top-0 bg-background">
							<tr className="border-b border-border/60 text-muted-foreground">
								<th className="text-left px-3 py-1.5 font-normal w-10">{t('backlink.ascore')}</th>
								<th className="text-left px-3 py-1.5 font-normal">{t('backlink.source')}</th>
								<th className="text-left px-3 py-1.5 font-normal w-20">Status</th>
								<th className="text-right px-3 py-1.5 font-normal w-16">{t('backlink.action')}</th>
							</tr>
						</thead>
						<tbody>
							{filteredBacklinks.map(b => (
								<tr key={b.id} className="border-b border-border/40 hover:bg-accent/30 transition-colors">
									<td className="px-3 py-1.5 text-primary font-medium">{b.pageAscore}</td>
									<td className="px-3 py-1.5">
										<a
											href={b.sourceUrl}
											target="_blank"
											rel="noopener noreferrer"
											className="truncate max-w-[200px] block text-primary hover:underline"
											title={b.sourceUrl}
										>
											{b.sourceTitle || b.sourceUrl}
										</a>
									</td>
									<td className="px-3 py-1.5">
										<span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_COLORS[b.status]}`}>
											{t(`backlink.status.${b.status}` as any)}
										</span>
									</td>
									<td className="px-3 py-1.5 text-right">
										<Button
											variant="ghost"
											size="sm"
											className="text-xs h-6 px-2"
											disabled={isRunning}
											onClick={() => onAnalyzeOne(b)}
										>
											{t('backlink.analyze')}
										</Button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>
		</div>
	)
}
