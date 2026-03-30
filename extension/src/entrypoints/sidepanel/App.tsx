import { useState, useRef, useEffect, useCallback } from 'react'
import type { SiteData } from '@/lib/types'
import { Dashboard } from '@/components/Dashboard'
import { QuickCreate } from '@/components/QuickCreate'
import { SubmitFlow } from '@/components/SubmitFlow'
import { SettingsPanel } from '@/components/SettingsPanel'
import { Button } from '@/components/ui/Button'
import { useProduct } from '@/hooks/useProduct'
import { useSites } from '@/hooks/useSites'
import { useSubmitAgent } from '@/hooks/useSubmitAgent'

type View =
	| { name: 'dashboard' }
	| { name: 'quick-create' }
	| { name: 'site-detail'; site: SiteData }
	| { name: 'settings' }
	| { name: 'float-fill' }

export default function App() {
	const [view, setView] = useState<View>({ name: 'dashboard' })
	const [dropdownOpen, setDropdownOpen] = useState(false)
	const dropdownRef = useRef<HTMLDivElement>(null)
	const { products, activeProduct, loading: productLoading, createProduct, setActive } = useProduct()
	const { sites, submissions, loading: sitesLoading, markSubmitted, markSkipped } = useSites(activeProduct?.id ?? null)
	const { status: agentStatus, history, activity, startSubmission, startSubmissionOnCurrentTab, stop } = useSubmitAgent()
	const [agentError, setAgentError] = useState<string | null>(null)

	// Listen for float-fill trigger from content script via background
	useEffect(() => {
		const handler = (message: any) => {
			if (message.type !== 'FLOAT_FILL') return
			if (message.action === 'start') {
				if (!activeProduct) {
					chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'no-product' }).catch(() => {})
					return
				}
				setView({ name: 'float-fill' })
				setAgentError(null)
				// Get the tab URL from session storage
				chrome.storage.session.get('floatFillTabId').then(async (res) => {
					const tabId = res.floatFillTabId as number | undefined
					let tabUrl = window.location.href
					if (tabId) {
						try {
							const tab = await chrome.tabs.get(tabId)
							tabUrl = tab.url ?? tabUrl
						} catch {}
					}
					startSubmissionOnCurrentTab(activeProduct, tabUrl)
						.then(() => {
							setView({ name: 'dashboard' })
						})
						.catch((err: Error) => {
							setAgentError(err.message)
						})
				})
			}
		}
		chrome.runtime.onMessage.addListener(handler)
		return () => chrome.runtime.onMessage.removeListener(handler)
	}, [activeProduct, startSubmissionOnCurrentTab])

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
				<header className="flex items-center justify-between border-b px-3 py-2">
					<span className="text-sm font-semibold">Submit Agent</span>
					<Button variant="ghost" size="sm" onClick={() => setView({ name: 'dashboard' })}>
						Back
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

	if (view.name === 'site-detail') {
		return (
			<div className="flex flex-col h-screen bg-background">
				<SubmitFlow
					site={view.site}
					product={activeProduct!}
					agentStatus={agentStatus}
					agentHistory={history}
					agentActivity={activity}
					agentError={agentError}
					onStartSubmit={async () => {
						setAgentError(null)
						try {
							await startSubmission(view.site, activeProduct!)
						} catch (err) {
							setAgentError(err instanceof Error ? err.message : String(err))
						}
					}}
					onStop={stop}
					onBack={() => setView({ name: 'dashboard' })}
					onMarkSubmitted={() => markSubmitted(view.site.name, activeProduct!.id)}
					onSkip={() => markSkipped(view.site.name, activeProduct!.id)}
				/>
			</div>
		)
	}

	if (view.name === 'float-fill') {
		return (
			<div className="flex flex-col h-screen bg-background">
				<header className="flex items-center justify-between border-b px-3 py-2">
					<span className="text-sm font-semibold">Auto-filling form...</span>
					<Button variant="ghost" size="sm" onClick={() => { stop(); setView({ name: 'dashboard' }) }}>
						Cancel
					</Button>
				</header>
				<div className="flex-1 p-3 space-y-2">
					{agentError ? (
						<div className="text-xs text-destructive bg-destructive/10 rounded p-2">{agentError}</div>
					) : (
						<div className="text-xs text-muted-foreground">
							<div className="font-medium text-foreground mb-1">Product: {activeProduct?.name}</div>
							<div>Status: {agentStatus}</div>
							{activity && <div className="mt-1 text-xs">{activity.type}: {JSON.stringify(activity).slice(0, 80)}</div>}
						</div>
					)}
				</div>
			</div>
		)
	}

	const isLoading = productLoading || sitesLoading

	return (
		<div className="flex flex-col h-screen bg-background">
			<header className="border-b px-3 py-2">
				<div className="flex items-center justify-between">
					<div className="relative" ref={dropdownRef}>
						<button
							type="button"
							className="text-sm font-semibold flex items-center gap-1 hover:text-primary transition-colors"
							onClick={() => setDropdownOpen((o) => !o)}
						>
							{activeProduct?.name ?? 'Submit Agent'}
							<span className="text-muted-foreground text-xs">{dropdownOpen ? '▲' : '▼'}</span>
						</button>
						{dropdownOpen && (
							<div className="absolute top-full left-0 mt-1 bg-popover border rounded shadow-md z-50 min-w-[160px] py-1">
								{products.map((p) => (
									<button
										key={p.id}
										type="button"
										className={`w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors ${
											p.id === activeProduct?.id ? 'font-semibold text-primary' : ''
										}`}
										onClick={() => { setActive(p.id); setDropdownOpen(false) }}
									>
										{p.name}
									</button>
								))}
								<div className="border-t my-1" />
								<button
									type="button"
									className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors text-muted-foreground"
									onClick={() => { setView({ name: 'quick-create' }); setDropdownOpen(false) }}
								>
									+ Add product
								</button>
							</div>
						)}
					</div>
					<div className="flex items-center gap-1">
						<Button
							variant="ghost"
							size="sm"
							onClick={() => chrome.runtime.openOptionsPage()}
						>
							Products
						</Button>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setView({ name: 'settings' })}
						>
							Settings
						</Button>
					</div>
				</div>
			</header>

			<main className="flex-1 overflow-hidden p-3">
				{isLoading ? (
					<div className="flex items-center justify-center h-full text-xs text-muted-foreground">
						Loading...
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
						onSelectSite={(site) => setView({ name: 'site-detail', site })}
					/>
				)}
			</main>
		</div>
	)
}
