import { useRef, useState } from 'react'
import { Settings, Trash2 } from 'lucide-react'
import { SettingsDialog } from '@/components/SettingsDialog'
import { ProductBasics } from '@/components/ProductBasics'
import { CopyGeneration } from '@/components/CopyGeneration'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { useProducts } from '@/hooks/useProducts'
import {
	addProduct,
	fetchHomepageHtml,
	fetchImageAsDataUrl,
	type AddProductStage,
} from '@/lib/add-product'
import { callLLM } from '@/lib/llm-utils'
import { getActiveLLMConfig } from '@/lib/storage'
import { toErrorMessage } from '@/lib/to-error-message'

function describeStage(stage: AddProductStage): string {
	switch (stage.type) {
		case 'domain-normalized':
			return `✓ 域名已规范化：${stage.domain}`
		case 'homepage-fetching':
			return `抓取首页中…（${stage.url}）`
		case 'homepage-fetched':
			return `✓ 首页抓取完成（${stage.htmlLength} 字符）`
		case 'basics-parsed':
			return `✓ 基本信息解析：网站名「${stage.siteName ?? '无，回退域名'}」；logo ${stage.logoFound ? '✓' : '✗'}；og 图 ${stage.ogFound ? '✓' : '✗'}`
		case 'images-fetched':
			return `✓ 图片处理完成（logo ${stage.logoSaved ? '已存' : '留空'} / og 图 ${stage.ogSaved ? '已存' : '留空'}）`
		case 'analysis-starting':
			return '调用 LLM 生成产品分析中…（约 20~40 秒）'
		case 'analysis-done':
			return `✓ 产品分析完成（${stage.analysisLength} 字符）`
		case 'saved':
			return '✓ 产品已保存入库'
	}
}

export default function App() {
	const [settingsOpen, setSettingsOpen] = useState(false)
	const { products, activeProduct, activeProductId, loadProducts, selectProduct, removeProduct } = useProducts()
	const [domainInput, setDomainInput] = useState('')
	const [adding, setAdding] = useState(false)
	const [addError, setAddError] = useState<string | null>(null)
	const [addLogs, setAddLogs] = useState<string[]>([])
	const logBoxRef = useRef<HTMLDivElement>(null)

	function appendAddLog(line: string) {
		setAddLogs((current) => {
			const next = [...current, line]
			requestAnimationFrame(() => {
				if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight
			})
			return next
		})
	}

	async function handleAddProduct() {
		if (adding || !domainInput.trim()) return
		setAdding(true)
		setAddError(null)
		setAddLogs([])
		try {
			const config = await getActiveLLMConfig()
			const product = await addProduct(domainInput, {
				llmConfig: config,
				fetchHomepageHtml,
				fetchImageAsDataUrl,
				callLLM: (options) => callLLM({ ...options, config }),
				onProgress: (stage) => appendAddLog(describeStage(stage)),
			})
			setDomainInput('')
			await loadProducts()
			await selectProduct(product.id)
		} catch (err: unknown) {
			appendAddLog(`✗ 失败：${toErrorMessage(err)}`)
			setAddError(toErrorMessage(err))
		} finally {
			setAdding(false)
		}
	}

	async function handleDeleteProduct() {
		if (!activeProduct) return
		const confirmed = window.confirm(`删除产品「${activeProduct.name}」（${activeProduct.domain}）？`)
		if (!confirmed) return
		await removeProduct(activeProduct.id)
	}

	return (
		<div className="flex h-screen flex-col">
			<header className="flex items-center justify-between border-b border-border px-4 py-3">
				<div>
					<h1 className="text-base font-semibold">Submit Agent</h1>
					<p className="mt-0.5 text-xs text-muted-foreground">目录站提交资料生成助手</p>
				</div>
				<button
					type="button"
					className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					onClick={() => setSettingsOpen(true)}
					aria-label="打开设置"
				>
					<Settings className="h-4 w-4" />
				</button>
			</header>

			<main className="flex-1 space-y-4 overflow-y-auto p-4">
				<section className="space-y-2">
					<div className="flex items-end gap-2">
						<div className="flex-1">
							<Select
								label="当前产品"
								value={activeProductId ?? ''}
								onChange={(e) => void selectProduct(e.target.value)}
								disabled={products.length === 0}
								options={
									products.length > 0
										? products.map((product) => ({
												value: product.id,
												label: `${product.name} (${product.domain})`,
											}))
										: [{ value: '', label: '暂无产品' }]
								}
							/>
						</div>
						<Button
							variant="ghost"
							size="icon"
							onClick={() => void handleDeleteProduct()}
							disabled={!activeProduct}
							aria-label="删除当前产品"
						>
							<Trash2 className="h-4 w-4" />
						</Button>
					</div>
				</section>

				{activeProduct ? (
					<>
						<ProductBasics product={activeProduct} onChanged={loadProducts} />
						<CopyGeneration product={activeProduct} onChanged={loadProducts} />
					</>
				) : (
					<section className="border-t border-border pt-4">
						<p className="text-xs text-muted-foreground">添加第一个产品后，这里会展示它的基本信息与复制按钮。</p>
					</section>
				)}

				<section className="space-y-2 border-t border-border pt-4">
					<Input
						label="添加产品"
						placeholder="输入网站域名，如 example.com"
						value={domainInput}
						onChange={(e) => {
							setDomainInput(e.target.value)
							setAddError(null)
						}}
						onKeyDown={(e) => {
							if (e.key === 'Enter') void handleAddProduct()
						}}
						disabled={adding}
					/>
					<Button size="sm" onClick={() => void handleAddProduct()} disabled={adding || !domainInput.trim()}>
						{adding ? '添加中…' : '开始添加'}
					</Button>
					{addLogs.length > 0 && (
						<div
							ref={logBoxRef}
							className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-border bg-muted/50 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground"
						>
							{addLogs.map((line, index) => (
								<p key={index} className={line.startsWith('✗') ? 'text-destructive' : undefined}>
									{line}
								</p>
							))}
							{adding && <p className="animate-pulse">▌</p>}
						</div>
					)}
					{addError && !adding && <p className="text-xs text-destructive">{addError}</p>}
				</section>
			</main>

			<SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
		</div>
	)
}
