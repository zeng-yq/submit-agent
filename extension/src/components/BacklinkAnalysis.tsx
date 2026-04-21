import type { BacklinkRecord } from '@/lib/types'
import type { LogEntry } from '@/agent/types'
import { BacklinkToolbar } from './BacklinkToolbar'
import { BacklinkTable } from './BacklinkTable'

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
	totalLogCount?: number
	onClearLogs: () => void
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
	totalLogCount,
	onClearLogs,
}: BacklinkAnalysisProps) {
	const stats = {
		total: backlinks.length,
		analyzed: backlinks.filter(b => b.status !== 'pending').length,
		publishable: backlinks.filter(b => b.status === 'publishable').length,
	}

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
			/>
			<BacklinkTable
				backlinks={backlinks}
				analyzingId={analyzingId}
				isRunning={isRunning}
				onAnalyzeOne={onAnalyzeOne}
				logs={logs}
				totalLogCount={totalLogCount}
				onClearLogs={onClearLogs}
			/>
		</div>
	)
}
