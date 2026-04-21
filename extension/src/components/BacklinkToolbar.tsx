import { useRef, useState, useCallback } from 'react'
import { Button } from './ui/Button'

interface BacklinkToolbarProps {
	isRunning: boolean
	stats: { total: number; analyzed: number; publishable: number }
	onImportCsv: (csvText: string) => Promise<{ imported: number; skipped: number }>
	onReload: () => void
	onStartAnalysis: (count: number) => void
	onAddUrl: (url: string) => Promise<{ success: boolean; error?: string }>
	onStop: () => void
}

export function BacklinkToolbar({
	isRunning,
	stats,
	onImportCsv,
	onReload,
	onStartAnalysis,
	onAddUrl,
	onStop,
}: BacklinkToolbarProps) {
	const fileInputRef = useRef<HTMLInputElement>(null)
	const urlInputRef = useRef<HTMLInputElement>(null)
	const [batchCount, setBatchCount] = useState(20)
	const [importMsg, setImportMsg] = useState<string | null>(null)
	const [urlInput, setUrlInput] = useState('')
	const [adding, setAdding] = useState(false)

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
		<>
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
		</>
	)
}
