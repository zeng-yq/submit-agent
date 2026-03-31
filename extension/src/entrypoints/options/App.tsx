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
import { useT } from '@/hooks/useLanguage'

type View = { name: 'list' } | { name: 'create' } | { name: 'edit'; product: ProductProfile }
type CreateStep = 'url-input' | 'generating' | 'review' | 'manual'

function CreateView({ onSave, onCancel }: { onSave: (data: FormData) => Promise<void>; onCancel: () => void }) {
	const t = useT()
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
			setError((err as Error).message || t('options.generationFailed'))
			setStep('url-input')
		}
	}, [url, t])

	if (step === 'review' && profile) {
		return (
			<div>
				<div className="flex items-center gap-2 mb-6">
					<button className="text-sm text-muted-foreground hover:text-foreground" onClick={() => { setStep('url-input'); setProfile(null) }}>{t('options.backToList')}</button>
					<span className="text-sm text-muted-foreground">{t('options.reviewProfile')}</span>
				</div>
				<ProductForm
					initial={profile as FormData}
					onSave={onSave}
					onCancel={onCancel}
					submitLabel={t('options.saveProduct')}
				/>
			</div>
		)
	}

	if (step === 'manual') {
		return (
			<div>
				<div className="flex items-center gap-2 mb-6">
					<button className="text-sm text-muted-foreground hover:text-foreground" onClick={() => setStep('url-input')}>{t('options.backToList')}</button>
					<span className="text-sm text-muted-foreground">{t('options.newProductLabel')}</span>
				</div>
				<ProductForm onSave={onSave} onCancel={onCancel} submitLabel={t('options.saveProduct')} />
			</div>
		)
	}

	return (
		<div className="max-w-md">
			<div className="flex items-center gap-2 mb-6">
				<button className="text-sm text-muted-foreground hover:text-foreground" onClick={onCancel}>{t('options.backToList')}</button>
				<span className="text-sm font-medium">{t('options.newProductLabel')}</span>
			</div>
			<div className="space-y-4">
				<div>
					<h2 className="text-base font-semibold">{t('options.urlTitle')}</h2>
					<p className="text-sm text-muted-foreground mt-1">{t('options.urlDesc')}</p>
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
						{t('options.llmRequired')}
					</div>
				)}
				<Button
					className="w-full"
					onClick={handleGenerate}
					disabled={!url.trim() || step === 'generating' || llmReady === false}
				>
					{step === 'generating' ? t('options.analyzingProduct') : t('options.generateWithAi')}
				</Button>
				<button
					type="button"
					className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
					onClick={() => setStep('manual')}
				>
					{t('options.orManually')}
				</button>
			</div>
		</div>
	)
}

export default function App() {
	const t = useT()
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
					<h1 className="text-xl font-bold">{t('options.title')}</h1>
					<p className="text-sm text-muted-foreground mt-1">
						{t('options.subtitle')}
					</p>
				</div>
				<Button onClick={() => setView({ name: 'create' })}>{t('options.newProduct')}</Button>
			</div>

			{loading ? (
				<div className="text-sm text-muted-foreground">{t('common.loading')}</div>
			) : products.length === 0 ? (
				<Card>
					<CardContent className="py-8 text-center">
						<div className="text-sm text-muted-foreground mb-3">
							{t('options.noProducts')}
						</div>
						<Button size="sm" onClick={() => setView({ name: 'create' })}>
							{t('options.createFirst')}
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
										{isActive && <Badge variant="default">{t('options.active')}</Badge>}
									</div>
									<div className="flex gap-1">
										{!isActive && (
											<Button
												variant="outline"
												size="sm"
												onClick={() => setActive(product.id)}
											>
												{t('options.setActive')}
											</Button>
										)}
										<Button
											variant="ghost"
											size="sm"
											onClick={() => setView({ name: 'edit', product })}
										>
											{t('common.edit')}
										</Button>
										<Button
											variant="ghost"
											size="sm"
											className="text-destructive"
											onClick={() => {
												if (confirm(t('options.confirmDelete', { name: product.name }))) {
													deleteProduct(product.id)
												}
											}}
										>
											{t('common.delete')}
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
