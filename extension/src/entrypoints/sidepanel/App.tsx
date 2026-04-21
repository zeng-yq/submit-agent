import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { SiteData } from '@/lib/types'
import { Dashboard } from '@/components/Dashboard'
import { QuickCreate } from '@/components/QuickCreate'
import { SettingsPanel } from '@/components/SettingsPanel'
import { useProduct } from '@/hooks/useProduct'
import { useSites } from '@/hooks/useSites'
import { useFormFillEngine } from '@/hooks/useFormFillEngine'
import { useBacklinkAgent } from '@/hooks/useBacklinkAgent'
import { BacklinkAnalysis } from '@/components/BacklinkAnalysis'
import { importBacklinksFromCsv } from '@/lib/backlinks'
import { matchCurrentPage, filterSubmittable } from '@/lib/sites'

type Tab = 'submit' | 'analysis' | 'settings'

export default function App() {
	const [tab, setTab] = useState<Tab>('submit')
	const [dropdownOpen, setDropdownOpen] = useState(false)
	const dropdownRef = useRef<HTMLDivElement>(null)
	const { products, activeProduct, loading: productLoading, createProduct, setActive } = useProduct()
	const { sites, submissions, loading: sitesLoading, markSubmitted, markSkipped, markFailed, resetSubmission, deleteSite } = useSites(activeProduct?.id ?? null)
	const { status: engineStatus, result: engineResult, error: engineError, logs: engineLogs, startSubmission, stop, reset, clearLogs } = useFormFillEngine()

	const handleDeleteSite = useCallback(
		async (siteName: string) => {
			await deleteSite(siteName)
		},
		[deleteSite]
	)
	const {
		analyzingId,
		currentStep: backlinkStep,
		currentIndex,
		batchSize,
		backlinks,
		isRunning: isBacklinkRunning,
		startAnalysis,
		analyzeOne: analyzeBacklink,
		stop: stopBacklinkAnalysis,
		reset: resetBacklinkAgent,
		reload: reloadBacklinks,
		addUrl,
		batchHistory,
		activeBatchId,
		selectBatch,
		dismissBatch,
		logs: backlinkLogs,
		clearLogs: clearBacklinkLogs,
	} = useBacklinkAgent()
	const [currentEngineSite, setCurrentEngineSite] = useState<SiteData | null>(null)
	const [pendingUnmatchedUrl, setPendingUnmatchedUrl] = useState<string | null>(null)
	const dashboardRunningRef = useRef(false)
	const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	// Run float-fill: match current tab to a site and start submission
	const floatFillRunningRef = useRef(false)
	const runFloatFill = useCallback(async () => {
		if (floatFillRunningRef.current) return
		floatFillRunningRef.current = true
		// Reset float button to idle so it can be clicked again later
		chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'reset' }).catch(() => {})
		try {
			if (!activeProduct) {
				chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'no-product' }).catch(() => {})
				return
			}
			const res = await chrome.storage.session.get('floatFillTabId')
			const tabId = res.floatFillTabId as number | undefined
			if (!tabId) return
			try {
				const tab = await chrome.tabs.get(tabId)
				const tabUrl = tab.url ?? ''
				const submittable = filterSubmittable(sites)
				const matched = matchCurrentPage(submittable, tabUrl)
				if (matched) {
					chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'progress' }).catch(() => {})
					reset()
					setCurrentEngineSite(matched)
					try {
						const r = await startSubmission(matched)
						if (r.failed === 0 && r.filled > 0) {
							markSubmitted(matched.name, activeProduct.id)
						}
						setTimeout(() => {
							setCurrentEngineSite(null)
							reset()
						}, 3000)
					} catch (err) {
						markFailed(matched.name, activeProduct.id, err instanceof Error ? err.message : String(err))
						setTimeout(() => {
							setCurrentEngineSite(null)
							reset()
						}, 3000)
					}
				} else {
					chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'reset' }).catch(() => {})
					setPendingUnmatchedUrl(tabUrl)
				}
			} catch (err) {
				chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'error' }).catch(() => {})
			}
		} finally {
			floatFillRunningRef.current = false
		}
	}, [activeProduct, sites, startSubmission, markSubmitted, reset, markFailed])

	// On mount, check if there's a pending float-fill request (sidepanel may have been opened by float button)
	useEffect(() => {
		if (!activeProduct || sites.length === 0) return
		chrome.storage.session.get('floatFillPending').then((res) => {
			if (res.floatFillPending) {
				chrome.storage.session.remove('floatFillPending').catch(() => {})
				runFloatFill()
			}
		})
	}, [activeProduct, sites.length, runFloatFill])

	// Listen for float-fill trigger and status updates from content script via background
	useEffect(() => {
		const handler = (message: any) => {
			if (message.type === 'FLOAT_FILL' && message.action === 'start') {
				runFloatFill()
				return
			}
			if (message.type === 'STATUS_UPDATE') {
				if (!activeProduct) return
				const { status, tabUrl } = message.payload ?? {}
				if (!status || !tabUrl) return
				const submittable = filterSubmittable(sites)
				const matched = matchCurrentPage(submittable, tabUrl)
				if (!matched) return
				if (status === 'not_started') {
					resetSubmission(matched.name)
				} else if (status === 'submitted') {
					markSubmitted(matched.name, activeProduct.id)
				} else if (status === 'failed') {
					markFailed(matched.name, activeProduct.id)
				}
			}
		}
		chrome.runtime.onMessage.addListener(handler)
		return () => chrome.runtime.onMessage.removeListener(handler)
	}, [runFloatFill, activeProduct, sites, markSubmitted, markFailed, resetSubmission])

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
						floatFillPending: true,
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
			reset()
			resetTimerRef.current = null
		}, 3000)

		dashboardRunningRef.current = false
	}, [activeProduct, reset, startSubmission, markSubmitted, markFailed])

	// Confirm submission for an unmatched page
	const handleConfirmUnmatched = useCallback(async () => {
		if (!pendingUnmatchedUrl || !activeProduct) return
		const url = new URL(pendingUnmatchedUrl)
		const virtualSite: SiteData = {
			name: url.hostname,
			submit_url: pendingUnmatchedUrl,
			category: 'directory_submit',
			dr: null,
		}
		setPendingUnmatchedUrl(null)
		chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'progress' }).catch(() => {})
		reset()
		setCurrentEngineSite(virtualSite)
		try {
			const r = await startSubmission(virtualSite)
			if (r.failed === 0 && r.filled > 0) {
				markSubmitted(virtualSite.name, activeProduct.id)
			}
			setTimeout(() => {
				setCurrentEngineSite(null)
				reset()
			}, 3000)
		} catch (err) {
			markFailed(virtualSite.name, activeProduct.id, err instanceof Error ? err.message : String(err))
			setTimeout(() => {
				setCurrentEngineSite(null)
				reset()
			}, 3000)
		}
	}, [pendingUnmatchedUrl, activeProduct, startSubmission, markSubmitted, reset, markFailed])

	const handleCancelUnmatched = useCallback(() => {
		setPendingUnmatchedUrl(null)
		chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'no-match' }).catch(() => {})
	}, [])

	// Reload backlinks from DB when entering the analysis tab
	useEffect(() => {
		if (tab === 'analysis') {
			reloadBacklinks()
		}
	}, [tab, reloadBacklinks])

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
		if (!activeProduct) {
			return (
				<QuickCreate
					onSave={async (data) => {
						await createProduct(data)
					}}
					onSkip={() => chrome.runtime.openOptionsPage()}
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
										onClick={() => { setDropdownOpen(false) }}
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
							engineStatus={engineStatus}
							engineLogs={engineLogs}
							onClearEngineLogs={clearLogs}
							activeSiteName={currentEngineSite?.name ?? null}
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
						backlinks={backlinks}
						analyzingId={analyzingId}
						currentStep={backlinkStep}
						currentIndex={currentIndex}
						batchSize={batchSize}
						isRunning={isBacklinkRunning}
						onImportCsv={importBacklinksFromCsv}
						onReload={reloadBacklinks}
						onStartAnalysis={startAnalysis}
						onAnalyzeOne={analyzeBacklink}
						onAddUrl={addUrl}
						onStop={stopBacklinkAnalysis}
						batchHistory={batchHistory}
						activeBatchId={activeBatchId}
						onSelectBatch={selectBatch}
						onDismissBatch={dismissBatch}
						logs={backlinkLogs}
						onClearLogs={clearBacklinkLogs}
					/>
				)}
				{tab === 'settings' && <SettingsPanel />}
			</div>

			{/* Confirm dialog for unmatched page */}
			{pendingUnmatchedUrl && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
					<div className="bg-popover border border-border/60 rounded-lg shadow-xl max-w-sm w-full mx-4 p-5">
						<h3 className="text-sm font-semibold mb-2">{'页面未在资源库中'}</h3>
						<p className="text-xs text-muted-foreground mb-1">{'当前页面不在外链资源库中，是否仍然提交？'}</p>
						<p className="text-xs text-muted-foreground break-all mb-4">{pendingUnmatchedUrl}</p>
						<div className="flex justify-end gap-2">
							<button type="button" className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-accent transition-colors cursor-pointer" onClick={handleCancelUnmatched}>{'取消'}</button>
							<button type="button" className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer" onClick={handleConfirmUnmatched}>{'提交'}</button>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}
