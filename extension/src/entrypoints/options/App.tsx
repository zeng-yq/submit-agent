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
			setError((err as Error).message || '生成失败')
			setStep('url-input')
		}
	}, [url])

	if (step === 'review' && profile) {
		return (
			<div>
				<div className="flex items-center gap-2 mb-6">
					<button className="text-sm text-muted-foreground hover:text-foreground" onClick={() => { setStep('url-input'); setProfile(null) }}>{'← 返回'}</button>
					<span className="text-sm text-muted-foreground">{'审核 AI 生成的资料'}</span>
				</div>
				<ProductForm
					initial={profile as FormData}
					onSave={onSave}
					onCancel={onCancel}
					submitLabel={'保存产品'}
				/>
			</div>
		)
	}

	if (step === 'manual') {
		return (
			<div>
				<div className="flex items-center gap-2 mb-6">
					<button className="text-sm text-muted-foreground hover:text-foreground" onClick={() => setStep('url-input')}>{'← 返回'}</button>
					<span className="text-sm text-muted-foreground">{'新产品'}</span>
				</div>
				<ProductForm onSave={onSave} onCancel={onCancel} submitLabel={'保存产品'} />
			</div>
		)
	}

	return (
		<div className="max-w-md">
			<div className="flex items-center gap-2 mb-6">
				<button className="text-sm text-muted-foreground hover:text-foreground" onClick={onCancel}>{'← 返回'}</button>
				<span className="text-sm font-medium">{'新产品'}</span>
			</div>
			<div className="space-y-4">
				<div>
					<h2 className="text-base font-semibold">{'你的产品 URL 是什么？'}</h2>
					<p className="text-sm text-muted-foreground mt-1">{'AI 将读取你的网站并自动生成资料。'}</p>
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
						{'AI 生成功能需要在设置中配置 LLM API。'}
					</div>
				)}
				<Button
					className="w-full"
					onClick={handleGenerate}
					disabled={!url.trim() || step === 'generating' || llmReady === false}
				>
					{step === 'generating' ? '正在分析你的产品...' : '用 AI 生成资料'}
				</Button>
				<button
					type="button"
					className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
					onClick={() => setStep('manual')}
				>
					{'或手动填写'}
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
					<h1 className="text-xl font-bold">{'Submit Agent'}</h1>
					<p className="text-sm text-muted-foreground mt-1">
						{'管理你的产品资料，用于自动提交'}
					</p>
				</div>
				<Button onClick={() => setView({ name: 'create' })}>{'新建产品'}</Button>
			</div>

			{loading ? (
				<div className="text-sm text-muted-foreground">{'加载中...'}</div>
			) : products.length === 0 ? (
				<Card>
					<CardContent className="py-8 text-center">
						<div className="text-sm text-muted-foreground mb-3">
							{'暂无产品资料，创建一个开始提交吧。'}
						</div>
						<Button size="sm" onClick={() => setView({ name: 'create' })}>
							{'创建第一个产品资料'}
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
										{isActive && <Badge variant="default">{'当前使用'}</Badge>}
									</div>
									<div className="flex gap-1">
										{!isActive && (
											<Button
												variant="outline"
												size="sm"
												onClick={() => setActive(product.id)}
											>
												{'设为当前'}
											</Button>
										)}
										<Button
											variant="ghost"
											size="sm"
											onClick={() => setView({ name: 'edit', product })}
										>
											{'编辑'}
										</Button>
										<Button
											variant="ghost"
											size="sm"
											className="text-destructive"
											onClick={() => {
												if (confirm(`确定删除「${product.name}」？`)) {
													deleteProduct(product.id)
												}
											}}
										>
											{'删除'}
										</Button>
									</div>
								</CardHeader>
								<CardContent>
									<div className="text-foreground">{product.description.slice(0, 100)}{product.description.length > 100 ? '...' : ''}</div>
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
								</CardContent>
							</Card>
						)
					})}
				</div>
			)}
		</div>
	)
}
