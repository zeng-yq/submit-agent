import { useMemo } from 'react'
import type { BacklinkRecord } from '@/lib/types'
import type { LogEntry } from '@/agent/types'
import { BacklinkToolbar } from './BacklinkToolbar'
import { BacklinkTable } from './BacklinkTable'
import type { BatchProgress } from './ActivityLog'

interface BacklinkAnalysisProps {
	backlinks: BacklinkRecord[]
	analyzingId: string | null
	isRunning: boolean
	analysisProgress?: BatchProgress
	onImportCsv: (csvText: string) => Promise<{ imported: number; skipped: number }>
	onReload: () => void
	onStartAnalysis: (count: number) => void
	onAnalyzeOne: (backlink: BacklinkRecord) => void
	onAddUrl: (url: string) => Promise<{ success: boolean; error?: string }>
	onStop: () => void
	logs: LogEntry[]
	totalLogCount?: number
	onClearLogs: () => void
	onClearAll: () => void
}

export function BacklinkAnalysis({
	backlinks,
	analyzingId,
	isRunning,
	analysisProgress,
	onImportCsv,
	onReload,
	onStartAnalysis,
	onAnalyzeOne,
	onAddUrl,
	onStop,
	logs,
	totalLogCount,
	onClearLogs,
	onClearAll,
}: BacklinkAnalysisProps) {
	const stats = useMemo(() => {
		let analyzed = 0
		let publishable = 0
		for (const b of backlinks) {
			if (b.status !== 'pending') analyzed++
			if (b.status === 'publishable') publishable++
		}
		return { total: backlinks.length, analyzed, publishable }
	}, [backlinks])

	return (
		<div className="flex flex-col h-full">
			<BacklinkToolbar
				isRunning={isRunning}
				stats={stats}
				onImportCsv={onImportCsv}
				onReload={onReload}
				onStartAnalysis={onStartAnalysis}
				onAddUrl={onAddUrl}
				onStop={onStop}
				onClearAll={onClearAll}
			/>
			<BacklinkTable
				backlinks={backlinks}
				analyzingId={analyzingId}
				isRunning={isRunning}
				analysisProgress={analysisProgress}
				onAnalyzeOne={onAnalyzeOne}
				logs={logs}
				totalLogCount={totalLogCount}
				onClearLogs={onClearLogs}
			/>
		</div>
	)
}
