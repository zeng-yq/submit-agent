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
	onClearAll: () => void
}

export function BacklinkToolbar({
	isRunning,
	stats,
	onImportCsv,
	onReload,
	onStartAnalysis,
	onAddUrl,
	onStop,
	onClearAll,
}: BacklinkToolbarProps) {
	const fileInputRef = useRef<HTMLInputElement>(null)
	const urlInputRef = useRef<HTMLInputElement>(null)
	const [batchCount, setBatchCount] = useState(20)
	const [importMsg, setImportMsg] = useState<{ text: string; isError: boolean } | null>(null)
	const [isImporting, setIsImporting] = useState(false)
	const [urlInput, setUrlInput] = useState('')
	const [adding, setAdding] = useState(false)

	const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (!file) return
		setIsImporting(true)
		try {
			const text = await file.text()
			if (!text.trim()) {
				setImportMsg({ text: '文件内容为空', isError: true })
				return
			}
			const result = await onImportCsv(text)
			await onReload()
			if (result.imported === 0 && result.skipped === 0) {
				setImportMsg({ text: '未找到有效的 Source url 列，请检查 CSV 格式', isError: true })
			} else {
				setImportMsg({ text: `成功导入 ${result.imported} 条新外链，${result.skipped} 条重复被跳过`, isError: false })
			}
		} catch (err) {
			setImportMsg({ text: `导入失败：${err instanceof Error ? err.message : String(err)}`, isError: true })
		} finally {
			setIsImporting(false)
			if (fileInputRef.current) fileInputRef.current.value = ''
			setTimeout(() => setImportMsg(null), 5000)
		}
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
				setImportMsg({ text: `已添加 ${added} 条`, isError: false })
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
						disabled={isRunning || isImporting}
					>
						{isImporting ? (
							<>
								<svg className="w-3 h-3 animate-spin mr-1.5" viewBox="0 0 24 24" fill="none">
									<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
									<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7 7 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
								</svg>
								{'导入中...'}
							</>
						) : '导入 CSV'}
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
					<p className={`text-xs pl-0.5 ${importMsg.isError ? 'text-red-400' : 'text-green-400'}`}>{importMsg.text}</p>
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
							<option value={100}>100</option>
							<option value={200}>200</option>
							<option value={500}>500</option>
							<option value={1000}>1000</option>
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
				<Button
					variant="outline"
					size="xs"
					onClick={() => {
						if (window.confirm('确定要清空所有外链分析缓存吗？此操作不可撤销。')) {
							onClearAll().catch(err => console.error("Clear cache failed:", err))
						}
					}}
					disabled={isRunning || stats.total === 0}
				>
					{'清空缓存'}
				</Button>
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
