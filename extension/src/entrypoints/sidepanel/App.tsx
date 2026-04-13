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
	const { status: engineStatus, result: engineResult, error: engineError, startSubmission, stop, reset } = useFormFillEngine()

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

	// Batch submit state
	const [batchCount, setBatchCount] = useState(20)
	const [batchRunning, setBatchRunning] = useState(false)
	const [batchSites, setBatchSites] = useState<SiteData[]>([])
	const [batchCurrentIndex, setBatchCurrentIndex] = useState(0)
	const batchStopRef = useRef(false)
	const batchModeRef = useRef(false)

	// Listen for float-fill trigger from content script via background
	useEffect(() => {
		const handler = (message: any) => {
			if (message.type !== 'FLOAT_FILL') return
			if (message.action === 'start') {
				if (!activeProduct) {
					chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'no-product' }).catch(() => {})
					return
				}
				// The float button triggers are now handled by the floating button's own state.
				// The sidepanel just needs to know to run the engine.
				chrome.storage.session.get('floatFillTabId').then(async (res) => {
					const tabId = res.floatFillTabId as number | undefined
					if (!tabId) return
					try {
						const tab = await chrome.tabs.get(tabId)
						const tabUrl = tab.url ?? ''
						if (!activeProduct) return
						// Find matching site
						const submittable = filterSubmittable(sites)
						const matched = matchCurrentPage(submittable, tabUrl)
						if (matched) {
							startSubmission(matched)
								.then((r) => {
									if (r.failed === 0 && r.filled > 0) {
										markSubmitted(matched.name, activeProduct.id)
									}
								})
								.catch(() => {})
						}
					} catch {}
				})
			}
		}
		chrome.runtime.onMessage.addListener(handler)
		return () => chrome.runtime.onMessage.removeListener(handler)
	}, [activeProduct, sites, startSubmission, markSubmitted])

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
		reset()
		setCurrentEngineSite(site)

		try {
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

		// If in batch mode, advance to next
		if (batchModeRef.current) {
			advanceBatch()
		} else {
			setTimeout(() => {
				setCurrentEngineSite(null)
				reset()
			}, 3000)
		}
	}, [activeProduct, reset, startSubmission, markSubmitted, markFailed])

	const startBatch = useCallback((category?: string) => {
		const notStarted = sites
			.filter((s) => !!s.submit_url && (submissions.get(s.name)?.status ?? 'not_started') === 'not_started')
			.filter((s) => !category || s.category === category)
			.sort((a, b) => (b.dr ?? 0) - (a.dr ?? 0))
			.slice(0, batchCount)

		if (notStarted.length === 0) return

		setBatchSites(notStarted)
		setBatchCurrentIndex(0)
		setBatchRunning(true)
		batchStopRef.current = false
		batchModeRef.current = true
		reset()
		// Start first site directly
		handleStartSite(notStarted[0])
	}, [sites, submissions, batchCount, reset, handleStartSite])

	const stopBatch = useCallback(() => {
		batchStopRef.current = true
		setBatchRunning(false)
		batchModeRef.current = false
		stop()
	}, [stop])

	const advanceBatch = useCallback(() => {
		if (batchStopRef.current || !batchModeRef.current) {
			setBatchRunning(false)
			batchModeRef.current = false
			setCurrentEngineSite(null)
			return
		}

		const nextIndex = batchCurrentIndex + 1
		if (nextIndex >= batchSites.length) {
			setBatchRunning(false)
			batchModeRef.current = false
			setCurrentEngineSite(null)
			return
		}

		setBatchCurrentIndex(nextIndex)
		reset()
		handleStartSite(batchSites[nextIndex])
	}, [batchCurrentIndex, batchSites, reset, handleStartSite])

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
						batchCount={batchCount}
						onBatchCountChange={setBatchCount}
						batchRunning={batchRunning}
						batchCurrentIndex={batchCurrentIndex + 1}
						batchTotal={batchSites.length}
						batchCurrentSite={batchSites[batchCurrentIndex]?.name ?? ''}
						onStartBatch={startBatch}
						onStopBatch={stopBatch}
						engineStatus={engineStatus}
						engineError={engineError?.message ?? null}
						engineSiteName={currentEngineSite?.name ?? null}
						onStopEngine={stop}
					/>
				)}
			</main>
		</div>
	)
}
