import { useState } from 'react'
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

export default function App() {
	const [view, setView] = useState<View>({ name: 'dashboard' })
	const { sites, submissions, loading: sitesLoading, markSubmitted, markSkipped } = useSites()
	const { activeProduct, loading: productLoading, createProduct } = useProduct()
	const { status: agentStatus, history, activity, startSubmission, stop } = useSubmitAgent()
	const [agentError, setAgentError] = useState<string | null>(null)

	if (view.name === 'settings') {
		return <SettingsPanel onClose={() => setView({ name: 'dashboard' })} />
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
				<main className="flex-1 overflow-y-auto p-3">
					<QuickCreate
						onSave={async (data) => {
							await createProduct(data)
							setView({ name: 'dashboard' })
						}}
						onSkip={() => chrome.runtime.openOptionsPage()}
						onOpenSettings={() => setView({ name: 'settings' })}
					/>
				</main>
			</div>
		)
	}

	if (view.name === 'site-detail') {
		const site = view.site
		const submission = submissions.get(site.name)

		return (
			<SubmitFlow
				site={site}
				product={activeProduct}
				submission={submission}
				agentStatus={agentStatus}
				agentActivity={activity}
				agentHistory={history}
				agentError={agentError}
				onStartSubmit={() => {
					if (activeProduct) {
						setAgentError(null)
						startSubmission(site, activeProduct)
							.then((result) => {
								if (result.success) {
									markSubmitted(site.name, activeProduct.id)
								} else {
									setAgentError(result.data || 'Submission failed')
								}
							})
							.catch((err) => {
								console.error('[App] startSubmission error:', err)
								setAgentError(
									err instanceof Error ? err.message : String(err)
								)
							})
					}
				}}
				onStop={stop}
				onSkip={() => {
					if (activeProduct) {
						markSkipped(site.name, activeProduct.id)
					}
					setView({ name: 'dashboard' })
				}}
				onBack={() => {
					setAgentError(null)
					setView({ name: 'dashboard' })
				}}
			/>
		)
	}

	const isLoading = sitesLoading || productLoading

	return (
		<div className="flex flex-col h-screen bg-background">
			<header className="flex items-center justify-between border-b px-3 py-2">
				<div className="flex items-center gap-2">
					<span className="text-sm font-semibold">Submit Agent</span>
					{activeProduct && (
						<span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
							{activeProduct.name}
						</span>
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
