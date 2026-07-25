import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { SiteData, SiteCategory } from '@/lib/types'
import { SITE_CATEGORIES } from '@/lib/types'
import { Dashboard } from '@/components/Dashboard'
import { QuickCreate } from '@/components/QuickCreate'
import { SettingsPanel } from '@/components/SettingsPanel'
import { useProduct } from '@/hooks/useProduct'
import { useSites } from '@/hooks/useSites'
import { useFormFillEngine } from '@/hooks/useFormFillEngine'
import { useBacklinkState } from '@/hooks/useBacklinkState'
import { useBacklinkAnalysis } from '@/hooks/useBacklinkAnalysis'
import { useFloatFill } from '@/hooks/useFloatFill'
import { useBatchSubmit } from '@/hooks/useBatchSubmit'
import { BacklinkAnalysis } from '@/components/BacklinkAnalysis'
import { importBacklinksFromCsv } from '@/lib/backlinks'
import { importAiDirectoryFromCsv } from '@/lib/sites'
import { Dialog, DialogHeader, DialogTitle, DialogCloseButton, DialogContent, DialogFooter } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import type { ExtensionMessage } from '@/messaging/messages'

type Tab = 'submit' | 'analysis' | 'settings'

export default function App() {
	const [tab, setTab] = useState<Tab>('submit')
	const [dropdownOpen, setDropdownOpen] = useState(false)
	const [showQuickCreate, setShowQuickCreate] = useState(false)
	const [addSiteDialogOpen, setAddSiteDialogOpen] = useState(false)
	const [addSiteUrl, setAddSiteUrl] = useState('')
	const [addSiteError, setAddSiteError] = useState('')
	const dropdownRef = useRef<HTMLDivElement>(null)
	const { products, activeProduct, loading: productLoading, createProduct, setActive, refresh: refreshProducts } = useProduct()
	const { sites, submissions, loading: sitesLoading, refresh: refreshSites, markSubmitted, markSkipped, markFailed, resetSubmission, deleteSite, updateSite } = useSites(activeProduct?.id ?? null)
	const { status: engineStatus, result: engineResult, error: engineError, logs: engineLogs, startSubmission, stop, reset, resetUI, clearLogs, llmFieldData } = useFormFillEngine()

	const handleDeleteSite = useCallback(
		async (siteName: string) => {
			await deleteSite(siteName)
		},
		[deleteSite]
	)
	const backlinkState = useBacklinkState()
	const {
		analyzingId,
		isRunning: isBacklinkRunning,
		startAnalysis,
		analyzeOne: analyzeBacklink,
		stop: stopBacklinkAnalysis,
	} = useBacklinkAnalysis(backlinkState)
	const [currentEngineSite, setCurrentEngineSite] = useState<SiteData | null>(null)
	const dashboardRunningRef = useRef(false)
	const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const analysisLoadedRef = useRef(false)

	const { pendingUnmatchedUrl, confirmUnmatched, cancelUnmatched } = useFloatFill({
		activeProduct,
		sites,
		startSubmission,
		markSubmitted,
		markFailed,
		resetSubmission,
		reset,
		resetUI,
		setCurrentEngineSite,
	})

	const {
		isRunning: batchRunning,
		progress: batchProgress,
		start: startBatch,
		stopBatch,
	} = useBatchSubmit({
		activeProduct,
		sites,
		submissions,
		startSubmission,
		markSubmitted,
		markFailed,
		stop,
	})

	useEffect(() => {
		if (!dropdownOpen) return
		const handler = (e: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
				setDropdownOpen(false)
			}
		}
		document.addEventListener('mousedown', handler)
		return () => document.removeEventListener('mousedown', handler)
	}, [dropdownOpen])

	// Start a single site submission directly from dashboard
	const handleStartSite = useCallback(async (site: SiteData) => {
		if (!activeProduct) return
		if (dashboardRunningRef.current) return
		dashboardRunningRef.current = true

		// Clear any pending reset timer from a previous submission
		if (resetTimerRef.current) {
			clearTimeout(resetTimerRef.current)
			resetTimerRef.current = null
		}

		reset()
		setCurrentEngineSite(site)

		try {
			// Open a new tab for the submission page and store the tab ID
			if (site.submit_url) {
				const response = await chrome.runtime.sendMessage({
					type: 'SUBMIT_CONTROL',
					action: 'open_submit_page',
					payload: site.submit_url,
				})
				if (response?.ok && response.tabId) {
					await chrome.storage.session.set({
						floatFillTabId: response.tabId,
					})
				}
			}

			const result = await startSubmission(site)
			if (result.failed === 0 && result.filled > 0) {
				await markSubmitted(site.name, activeProduct.id)
			} else if (result.failed > 0) {
				await markFailed(site.name, activeProduct.id, result.notes)
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			await markFailed(site.name, activeProduct.id, msg)
		}

		resetTimerRef.current = setTimeout(() => {
			setCurrentEngineSite(null)
			resetUI()
			resetTimerRef.current = null
		}, 3000)

		dashboardRunningRef.current = false
	}, [activeProduct, reset, startSubmission, markSubmitted, markFailed])

	// 批量随机提交 20 个博客外链（与单条提交共用 dashboardRunningRef 互斥）
	const handleBatchSubmit = useCallback(async () => {
		if (!activeProduct) return
		if (dashboardRunningRef.current) return
		dashboardRunningRef.current = true
		try {
			await startBatch()
		} finally {
			dashboardRunningRef.current = false
		}
	}, [activeProduct, startBatch])

	const handleAddSite = useCallback(async (category: string, dr: number, notes: string) => {
		setAddSiteError('')
		try {
			let domain: string | undefined
			try {
				domain = new URL(addSiteUrl).hostname.replace(/^www\./, '')
			} catch { /* ignore */ }

			const response = await chrome.runtime.sendMessage({
				type: 'ADD_SITE',
				payload: {
					name: addSiteUrl,
					submit_url: addSiteUrl,
					domain,
					category,
					dr,
					notes,
				},
			})

			if (response?.success) {
				setAddSiteDialogOpen(false)
				await refreshSites()
			} else {
				setAddSiteError(response?.error || '添加失败，请重试')
			}
		} catch {
			setAddSiteError('添加失败，请重试')
		}
	}, [addSiteUrl, refreshSites])

	const handleImportAiDirectory = useCallback(async (csvText: string) => {
		const result = await importAiDirectoryFromCsv(csvText)
		await refreshSites()
		return result
	}, [refreshSites])

	// 当提交引擎激活时，自动切到外链提交标签页
	useEffect(() => {
		const isActive = engineStatus === 'running' || engineStatus === 'analyzing' || engineStatus === 'filling'
		if (isActive) {
			setTab('submit')
		}
	}, [engineStatus])

	// 首次进入外链分析 tab 时从 DB 加载一次 backlinks，之后内存复用（切换不再全表重读）
	useEffect(() => {
		if (tab === 'analysis' && !analysisLoadedRef.current) {
			analysisLoadedRef.current = true
			backlinkState.reload()
		}
	}, [tab, backlinkState.reload])

	// 监听浮动按钮的"添加到外链库"请求
	useEffect(() => {
		const handler = (message: ExtensionMessage) => {
			if (message.type === 'FLOAT_ADD_SITE' && message.url) {
				setAddSiteUrl(message.url)
				setAddSiteError('')
				setAddSiteDialogOpen(true)
			}
		}
		chrome.runtime.onMessage.addListener(handler)
		return () => chrome.runtime.onMessage.removeListener(handler)
	}, [])

	const handleDataImported = useCallback(() => {
		refreshProducts()
		refreshSites()
	}, [refreshProducts, refreshSites])

	const isLoading = productLoading || sitesLoading

	const submitStats = useMemo(() => {
		const submittable = sites.filter((s) => !!s.submit_url)
		let submitted = 0
		for (const sub of submissions.values()) {
			if (sub.status === 'submitted' || sub.status === 'approved') submitted++
		}
		return { submitted, total: submittable.length }
	}, [sites, submissions])

	function renderSubmitTab() {
		if (!activeProduct || showQuickCreate) {
			return (
				<QuickCreate
					onSave={async (data) => {
						await createProduct(data)
						setShowQuickCreate(false)
					}}
					onSkip={() => { setShowQuickCreate(false); chrome.runtime.openOptionsPage() }}
				/>
			)
		}

		return (
			<div className="flex flex-col h-full">
				{/* 产品选择器 */}
				<div className="shrink-0 px-3 py-2 border-b border-border/60">
					<div className="flex items-center justify-between">
						<div className="relative" ref={dropdownRef}>
							<button
								type="button"
								className="text-xs font-semibold flex items-center gap-1.5 hover:text-primary transition-colors cursor-pointer"
								onClick={() => setDropdownOpen((o) => !o)}
							>
								{activeProduct.name}
								<svg className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-150 ${dropdownOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
									<path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
								</svg>
							</button>
							{dropdownOpen && (
								<div className="absolute top-full left-0 mt-1.5 bg-popover border border-border/60 rounded-lg shadow-lg z-50 min-w-[180px] py-1.5">
									{products.map((p) => (
										<button
											key={p.id}
											type="button"
											className={`w-full text-left px-3.5 py-2 text-xs hover:bg-accent transition-colors cursor-pointer ${
												p.id === activeProduct?.id ? 'font-semibold text-primary' : ''
											}`}
											onClick={() => { setActive(p.id); setDropdownOpen(false) }}
										>
											{p.name}
										</button>
									))}
									<div className="border-t border-border/60 my-1" />
									<button
										type="button"
										className="w-full text-left px-3.5 py-2 text-xs hover:bg-accent transition-colors text-muted-foreground cursor-pointer"
										onClick={() => { setDropdownOpen(false); setShowQuickCreate(true) }}
									>
										{'+ 添加产品'}
									</button>
									<button
										type="button"
										className="w-full text-left px-3.5 py-2 text-xs hover:bg-accent transition-colors text-muted-foreground cursor-pointer"
										onClick={() => { setDropdownOpen(false); chrome.runtime.openOptionsPage() }}
									>
										{'管理产品'}
									</button>
								</div>
							)}
						</div>
						<span className="text-xs text-muted-foreground tabular-nums">{`已提交 ${submitStats.submitted} / ${submitStats.total}`}</span>
					</div>
				</div>

				{/* Dashboard 内容 */}
				<div className="flex-1 overflow-hidden p-3">
					{isLoading ? (
						<div className="flex items-center justify-center h-full text-sm text-muted-foreground">
							{'加载中...'}
						</div>
					) : (
						<Dashboard
							sites={sites}
							submissions={submissions}
							onSelectSite={handleStartSite}
							onRetrySite={handleStartSite}
							onResetStatus={resetSubmission}
							onDeleteSite={handleDeleteSite}
							onSaveSite={updateSite}
							engineStatus={engineStatus}
							engineLogs={engineLogs}
							onClearEngineLogs={clearLogs}
							llmFieldData={llmFieldData}
							activeSiteName={currentEngineSite?.name ?? null}
							onImportCsv={handleImportAiDirectory}
							onBatchSubmit={handleBatchSubmit}
							onStopBatch={stopBatch}
							batchRunning={batchRunning}
							batchProgress={batchProgress}
						/>
					)}
				</div>
			</div>
		)
	}

	return (
		<div className="flex flex-col h-screen bg-background">
			{/* Tab 栏 */}
			<div className="flex shrink-0 border-b border-border/60">
				{[
					{ id: 'submit' as Tab, label: '外链提交' },
					{ id: 'analysis' as Tab, label: '外链分析' },
					{ id: 'settings' as Tab, label: '设置' },
				].map((t) => (
					<button
						key={t.id}
						type="button"
						onClick={() => setTab(t.id)}
						className={`flex-1 py-2.5 text-xs font-medium text-center border-b-2 transition-colors cursor-pointer ${
							tab === t.id
								? 'border-primary text-foreground'
								: 'border-transparent text-muted-foreground hover:text-foreground'
						}`}
					>
						{t.label}
					</button>
				))}
			</div>

			{/* Tab 内容 */}
			<div className="flex-1 overflow-hidden">
				{tab === 'submit' && renderSubmitTab()}
				{tab === 'analysis' && (
					<BacklinkAnalysis
						backlinks={backlinkState.backlinks}
						analyzingId={analyzingId}
						isRunning={isBacklinkRunning}
						onImportCsv={importBacklinksFromCsv}
						onReload={backlinkState.reload}
						onStartAnalysis={startAnalysis}
						onAnalyzeOne={analyzeBacklink}
						onAddUrl={backlinkState.addUrl}
						onStop={stopBacklinkAnalysis}
						logs={backlinkState.logs}
						totalLogCount={backlinkState.totalLogCount}
						onClearLogs={backlinkState.clearLogs}
						onClearAll={backlinkState.clearAll}
					/>
				)}
				{tab === 'settings' && <SettingsPanel onDataImported={handleDataImported} />}
			</div>

			{/* Confirm dialog for unmatched page */}
			{pendingUnmatchedUrl && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
					<div className="bg-popover border border-border/60 rounded-lg shadow-xl max-w-sm w-full mx-4 p-5">
						<h3 className="text-sm font-semibold mb-2">{'页面未在资源库中'}</h3>
						<p className="text-xs text-muted-foreground mb-1">{'当前页面不在外链资源库中，是否仍然提交？'}</p>
						<p className="text-xs text-muted-foreground break-all mb-4">{pendingUnmatchedUrl}</p>
						<div className="flex justify-end gap-2">
							<button type="button" className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-accent transition-colors cursor-pointer" onClick={cancelUnmatched}>{'取消'}</button>
							<button type="button" className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer" onClick={confirmUnmatched}>{'提交'}</button>
						</div>
					</div>
				</div>
			)}

			{/* Add site dialog (triggered by float button) */}
			<Dialog open={addSiteDialogOpen} onClose={() => setAddSiteDialogOpen(false)}>
				<AddSiteForm
					url={addSiteUrl}
					error={addSiteError}
					onSave={handleAddSite}
					onCancel={() => setAddSiteDialogOpen(false)}
				/>
			</Dialog>
		</div>
	)
}

function AddSiteForm({ url, error, onSave, onCancel }: {
	url: string
	error: string
	onSave: (category: string, dr: number, notes: string) => void
	onCancel: () => void
}) {
	const [category, setCategory] = useState<SiteCategory>('others')
	const [dr, setDr] = useState('0')
	const [notes, setNotes] = useState('')

	return (
		<>
			<DialogHeader>
				<DialogTitle>添加到外链库</DialogTitle>
				<DialogCloseButton onClose={onCancel} />
			</DialogHeader>
			<DialogContent>
				<Input
					label="URL"
					value={url}
					onChange={() => {}}
					placeholder=""
					disabled
				/>
				<Select
					label="分类"
					options={SITE_CATEGORIES}
					value={category}
					onChange={(e) => setCategory(e.target.value as SiteCategory)}
				/>
				<Input
					label="DR 分数"
					type="number"
					value={dr}
					onChange={(e) => setDr(e.target.value)}
					placeholder="0"
				/>
				<Textarea
					label="备注"
					value={notes}
					onChange={(e) => setNotes(e.target.value)}
					placeholder="可选备注"
				/>
				{error && (
					<p className="text-xs text-red-500">{error}</p>
				)}
			</DialogContent>
			<DialogFooter>
				<Button variant="ghost" size="sm" onClick={onCancel}>取消</Button>
				<Button size="sm" onClick={() => onSave(category, Number(dr) || 0, notes.trim())}>保存</Button>
			</DialogFooter>
		</>
	)
}
