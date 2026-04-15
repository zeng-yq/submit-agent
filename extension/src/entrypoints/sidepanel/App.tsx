import { useState, useRef, useEffect, useCallback } from 'react'
import type { SiteData } from '@/lib/types'
import { Dashboard } from '@/components/Dashboard'
import { QuickCreate } from '@/components/QuickCreate'
import { SettingsPanel } from '@/components/SettingsPanel'
import { Button } from '@/components/ui/Button'
import { useProduct } from '@/hooks/useProduct'
import { useSites } from '@/hooks/useSites'
import { useFormFillEngine } from '@/hooks/useFormFillEngine'
import { useBacklinkAgent } from '@/hooks/useBacklinkAgent'
import { BacklinkAnalysis } from '@/components/BacklinkAnalysis'
import { importBacklinksFromCsv } from '@/lib/backlinks'
import { matchCurrentPage, filterSubmittable } from '@/lib/sites'

type View =
	| { name: 'dashboard' }
	| { name: 'quick-create' }
	| { name: 'settings' }
	| { name: 'backlink-analysis' }

export default function App() {
	const [view, setView] = useState<View>({ name: 'dashboard' })
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

	// Reload backlinks from DB when entering the backlink analysis view
	useEffect(() => {
		if (view.name === 'backlink-analysis') {
			reloadBacklinks()
		}
	}, [view.name, reloadBacklinks])

	if (view.name === 'settings') {
		return (
			<div className="flex flex-col h-screen bg-background">
				<SettingsPanel onClose={() => setView({ name: 'dashboard' })} />
			</div>
		)
	}

	if (view.name === 'quick-create') {
		return (
			<div className="flex flex-col h-screen bg-background">
				<header className="flex items-center justify-between border-b border-border/60 px-4 py-3">
					<span className="text-base font-semibold">{'Submit Agent'}</span>
					<Button variant="ghost" size="sm" onClick={() => setView({ name: 'dashboard' })}>
						{'返回'}
					</Button>
				</header>
				<QuickCreate
					onSave={async (data) => {
						await createProduct(data)
						setView({ name: 'dashboard' })
					}}
					onSkip={() => chrome.runtime.openOptionsPage()}
					onOpenSettings={() => setView({ name: 'settings' })}
				/>
			</div>
		)
	}

	if (view.name === 'backlink-analysis') {
		return (
			<div className="flex flex-col h-screen bg-background">
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
					onBack={() => {
						if (!isBacklinkRunning) resetBacklinkAgent()
						setView({ name: 'dashboard' })
					}}
					batchHistory={batchHistory}
					activeBatchId={activeBatchId}
					onSelectBatch={selectBatch}
					onDismissBatch={dismissBatch}
				/>
			</div>
		)
	}

	const isLoading = productLoading || sitesLoading

	return (
		<div className="flex flex-col h-screen bg-background">
			<header className="border-b border-border/60 px-4 py-3">
				<div className="flex items-center justify-between">
					<div className="relative" ref={dropdownRef}>
						<button
							type="button"
							className="text-xs font-semibold flex items-center gap-1.5 hover:text-primary transition-colors cursor-pointer"
							onClick={() => setDropdownOpen((o) => !o)}
						>
							{activeProduct?.name ?? 'Submit Agent'}
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
									onClick={() => { setView({ name: 'quick-create' }); setDropdownOpen(false) }}
								>
									{'+ 添加产品'}
								</button>
							</div>
						)}
					</div>
					<div className="flex items-center gap-0.5">
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setView({ name: 'backlink-analysis' })}
						>
							{'外链分析'}
						</Button>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => chrome.runtime.openOptionsPage()}
						>
							{'产品管理'}
						</Button>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setView({ name: 'settings' })}
						>
							{'设置'}
						</Button>
					</div>
				</div>
			</header>

			<main className={`flex-1 overflow-hidden ${activeProduct ? 'p-3' : ''}`}>
				{isLoading ? (
					<div className="flex items-center justify-center h-full text-sm text-muted-foreground">
						{'加载中...'}
					</div>
				) : !activeProduct ? (
					<QuickCreate
						onSave={async (data) => {
							await createProduct(data)
							setView({ name: 'dashboard' })
						}}
						onSkip={() => chrome.runtime.openOptionsPage()}
						onOpenSettings={() => setView({ name: 'settings' })}
					/>
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
			</main>

			{/* Confirm dialog for unmatched page */}
			{pendingUnmatchedUrl && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
					<div className="bg-popover border border-border/60 rounded-lg shadow-xl max-w-sm w-full mx-4 p-5">
						<h3 className="text-sm font-semibold mb-2">{'页面未在资源库中'}</h3>
						<p className="text-xs text-muted-foreground mb-1">{'当前页面不在外链资源库中，是否仍然提交？'}</p>
						<p className="text-xs text-muted-foreground break-all mb-4">{pendingUnmatchedUrl}</p>
						<div className="flex justify-end gap-2">
							<Button variant="outline" size="sm" onClick={handleCancelUnmatched}>
								{'取消'}
							</Button>
							<Button size="sm" onClick={handleConfirmUnmatched}>
								{'提交'}
							</Button>
						</div>
					</div>
				</div>
			)}
		</div>
		)
}
