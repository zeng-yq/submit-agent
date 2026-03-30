import { useState, useCallback, useRef, useEffect } from 'react'
import type { ProductProfile } from '@/lib/types'
import type { FormData } from '@/components/ProductForm'
import { ProductForm } from '@/components/ProductForm'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { useProduct } from '@/hooks/useProduct'
import { generateProfile, type GeneratedProfile } from '@/lib/profile-generator'
import { isLLMConfigured } from '@/agent/constants'
import { getLLMConfig } from '@/lib/storage'

type View = { name: 'list' } | { name: 'create' } | { name: 'edit'; product: ProductProfile }
type CreateStep = 'url-input' | 'generating' | 'review' | 'manual'

function CreateView({ onSave, onCancel }: { onSave: (data: FormData) => Promise<void>; onCancel: () => void }) {
	const [step, setStep] = useState<CreateStep>('url-input')
	const [url, setUrl] = useState('')
	const [profile, setProfile] = useState<GeneratedProfile | null>(null)
	const [error, setError] = useState('')
	const [llmReady, setLlmReady] = useState<boolean | null>(null)
	const abortRef = useRef<AbortController | null>(null)

	useEffect(() => {
		getLLMConfig().then((config) => setLlmReady(isLLMConfigured(config)))
	}, [])

	const handleGenerate = useCallback(async () => {
		const trimmed = url.trim()
		if (!trimmed) return
		let normalized = trimmed
		if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`
		abortRef.current?.abort()
		const controller = new AbortController()
		abortRef.current = controller
		setStep('generating')
		setError('')
		try {
			const result = await generateProfile(normalized, controller.signal)
			if (!result.name) result.name = new URL(normalized).hostname.replace(/^www\./, '')
			result.url = normalized
			setProfile(result)
			setStep('review')
		} catch (err) {
			if ((err as Error).name === 'AbortError') return
			setError((err as Error).message || 'Generation failed')
			setStep('url-input')
		}
	}, [url])

	if (step === 'review' && profile) {
		return (
			<div>
				<div className="flex items-center gap-2 mb-6">
					<button className="text-sm text-muted-foreground hover:text-foreground" onClick={() => { setStep('url-input'); setProfile(null) }}>← Back</button>
					<span className="text-sm text-muted-foreground">Review AI-generated profile</span>
				</div>
				<ProductForm
					initial={profile as FormData}
					onSave={onSave}
					onCancel={onCancel}
					submitLabel="Save Product"
				/>
			</div>
		)
	}

	if (step === 'manual') {
		return (
			<div>
				<div className="flex items-center gap-2 mb-6">
					<button className="text-sm text-muted-foreground hover:text-foreground" onClick={() => setStep('url-input')}>← Back</button>
					<span className="text-sm text-muted-foreground">New product</span>
				</div>
				<ProductForm onSave={onSave} onCancel={onCancel} submitLabel="Save Product" />
			</div>
		)
	}

	return (
		<div className="max-w-md">
			<div className="flex items-center gap-2 mb-6">
				<button className="text-sm text-muted-foreground hover:text-foreground" onClick={onCancel}>← Back</button>
				<span className="text-sm font-medium">New product</span>
			</div>
			<div className="space-y-4">
				<div>
					<h2 className="text-base font-semibold">What's your product URL?</h2>
					<p className="text-sm text-muted-foreground mt-1">AI will read your site and generate a profile automatically.</p>
				</div>
				<Input
					placeholder="https://your-product.com"
					value={url}
					autoFocus
					onChange={(e) => setUrl(e.target.value)}
					onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleGenerate() } }}
					disabled={step === 'generating' || llmReady === false}
				/>
				{error && (
					<div className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1.5">{error}</div>
				)}
				{llmReady === false && (
					<div className="text-xs text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950 rounded p-3">
						AI generation requires an LLM API configured in Settings.
					</div>
				)}
				<Button
					className="w-full"
					onClick={handleGenerate}
					disabled={!url.trim() || step === 'generating' || llmReady === false}
				>
					{step === 'generating' ? 'Analyzing your product...' : 'Generate Profile with AI'}
				</Button>
				<button
					type="button"
					className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
					onClick={() => setStep('manual')}
				>
					or fill in manually
				</button>
			</div>
		</div>
	)
}

export default function App() {
	const [view, setView] = useState<View>({ name: 'list' })
	const { products, activeProduct, loading, createProduct, editProduct, deleteProduct, setActive } =
		useProduct()

	if (view.name === 'create') {
		return (
			<div className="max-w-2xl mx-auto p-6">
				<CreateView
					onSave={async (data) => {
						await createProduct(data)
						setView({ name: 'list' })
					}}
					onCancel={() => setView({ name: 'list' })}
				/>
			</div>
		)
	}

	if (view.name === 'edit') {
		return (
			<div className="max-w-2xl mx-auto p-6">
				<ProductForm
					initial={view.product}
					onSave={async (data) => {
						await editProduct({ ...view.product, ...data })
						setView({ name: 'list' })
					}}
					onCancel={() => setView({ name: 'list' })}
				/>
			</div>
		)
	}

	return (
		<div className="max-w-2xl mx-auto p-6">
			<div className="flex items-center justify-between mb-6">
				<div>
					<h1 className="text-xl font-bold">Submit Agent</h1>
					<p className="text-sm text-muted-foreground mt-1">
						Manage your product profiles for auto-submission
					</p>
				</div>
				<Button onClick={() => setView({ name: 'create' })}>New Product</Button>
			</div>

			{loading ? (
				<div className="text-sm text-muted-foreground">Loading...</div>
			) : products.length === 0 ? (
				<Card>
					<CardContent className="py-8 text-center">
						<div className="text-sm text-muted-foreground mb-3">
							No product profiles yet. Create one to start submitting.
						</div>
						<Button size="sm" onClick={() => setView({ name: 'create' })}>
							Create Your First Profile
						</Button>
					</CardContent>
				</Card>
			) : (
				<div className="space-y-3">
					{products.map((product) => {
						const isActive = activeProduct?.id === product.id
						return (
							<Card
								key={product.id}
								className={isActive ? 'border-primary' : 'hover:border-primary/50'}
							>
								<CardHeader>
									<div className="flex items-center gap-2">
										<CardTitle>{product.name}</CardTitle>
										{isActive && <Badge variant="default">Active</Badge>}
									</div>
									<div className="flex gap-1">
										{!isActive && (
											<Button
												variant="outline"
												size="sm"
												onClick={() => setActive(product.id)}
											>
												Set Active
											</Button>
										)}
										<Button
											variant="ghost"
											size="sm"
											onClick={() => setView({ name: 'edit', product })}
										>
											Edit
										</Button>
										<Button
											variant="ghost"
											size="sm"
											className="text-destructive"
											onClick={() => {
												if (confirm(`Delete "${product.name}"?`)) {
													deleteProduct(product.id)
												}
											}}
										>
											Delete
										</Button>
									</div>
								</CardHeader>
								<CardContent>
									<div className="text-foreground">{product.tagline}</div>
									<div className="mt-1">
										<a
											href={product.url}
											target="_blank"
											rel="noopener noreferrer"
											className="text-primary hover:underline"
										>
											{product.url}
										</a>
									</div>
									{product.categories.length > 0 && (
										<div className="flex gap-1 mt-2 flex-wrap">
											{product.categories.map((cat) => (
												<Badge key={cat} variant="outline">
													{cat}
												</Badge>
											))}
										</div>
									)}
								</CardContent>
							</Card>
						)
					})}
				</div>
			)}
		</div>
	)
}
