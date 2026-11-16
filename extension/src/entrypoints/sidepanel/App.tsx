import { useState } from 'react'
import { Plus, Settings, Trash2 } from 'lucide-react'
import { SettingsDialog } from '@/components/SettingsDialog'
import { AddProductDialog } from '@/components/AddProductDialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ProductBasics } from '@/components/ProductBasics'
import { CopyGeneration } from '@/components/CopyGeneration'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { useProducts } from '@/hooks/useProducts'

export default function App() {
	const [settingsOpen, setSettingsOpen] = useState(false)
	const [addOpen, setAddOpen] = useState(false)
	const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
	const { products, activeProduct, activeProductId, loadProducts, selectProduct, removeProduct } = useProducts()

	async function handleConfirmDelete() {
		if (!activeProduct) return
		setDeleteConfirmOpen(false)
		await removeProduct(activeProduct.id)
	}

	return (
		<div className="flex h-dvh flex-col">
			<header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
				<div className="min-w-0">
					<h1 className="truncate text-lg font-semibold tracking-tight text-foreground">Submit Agent</h1>
					<p className="mt-0.5 text-xs text-muted-foreground">目录站提交资料生成助手</p>
				</div>
				<button
					type="button"
					className="relative shrink-0 rounded-lg p-2 cursor-pointer text-muted-foreground transition-colors duration-150 motion-reduce:transition-none hover:bg-muted hover:text-foreground after:absolute after:-inset-1 after:content-['']"
					onClick={() => setSettingsOpen(true)}
					aria-label="打开设置"
				>
					<Settings className="h-4 w-4" aria-hidden="true" />
				</button>
			</header>

			<main className="flex-1 space-y-5 overflow-y-auto p-4">
				<section className="space-y-2" aria-label="当前产品">
					<div className="flex items-end gap-2">
						<div className="min-w-0 flex-1">
							<Select
								label="当前产品"
								value={activeProductId ?? ''}
								onChange={(e) => void selectProduct(e.target.value)}
								disabled={products === null || products.length === 0}
								options={
									products && products.length > 0
										? products.map((product) => ({
												value: product.id,
												label: `${product.name} (${product.domain})`,
											}))
										: [{ value: '', label: '暂无产品' }]
								}
							/>
						</div>
						<Button
							variant="outline"
							size="icon"
							className="mb-0.5 hover:text-destructive hover:shadow-stock"
							onClick={() => setDeleteConfirmOpen(true)}
							disabled={!activeProduct}
							aria-label="删除当前产品"
						>
							<Trash2 className="h-4 w-4" aria-hidden="true" />
						</Button>
						<Button
							variant="outline"
							size="icon"
							className="mb-0.5 hover:shadow-cast-lift"
							onClick={() => setAddOpen(true)}
							aria-label="添加产品"
						>
							<Plus className="h-4 w-4" aria-hidden="true" />
						</Button>
					</div>
				</section>

				{products === null ? (
					<section className="space-y-3" aria-busy="true" aria-label="产品加载中">
						<div className="h-4 w-20 animate-pulse rounded bg-muted motion-reduce:animate-none" />
						<div className="h-6 animate-pulse rounded bg-muted motion-reduce:animate-none" />
						<div className="h-6 w-3/4 animate-pulse rounded bg-muted motion-reduce:animate-none" />
						<div className="h-6 w-5/6 animate-pulse rounded bg-muted motion-reduce:animate-none" />
					</section>
				) : activeProduct ? (
					<>
						<ProductBasics product={activeProduct} onChanged={loadProducts} />
						<CopyGeneration product={activeProduct} onChanged={loadProducts} />
					</>
				) : (
					<section className="rounded-lg border border-dashed border-border p-4">
						<p className="text-sm text-muted-foreground">
							还没有产品。点右上角的加号添加第一个产品，添加后这里会展示它的基本信息与提交文案。
						</p>
					</section>
				)}
			</main>

			<SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
			<ConfirmDialog
				open={deleteConfirmOpen}
				title="删除产品"
				message={
					activeProduct
						? `删除产品「${activeProduct.name}」（${activeProduct.domain}）？该操作不可撤销。`
						: ''
				}
				confirmLabel="删除"
				destructive
				onConfirm={() => void handleConfirmDelete()}
				onClose={() => setDeleteConfirmOpen(false)}
			/>
			<AddProductDialog
				open={addOpen}
				onClose={() => setAddOpen(false)}
				onAdded={async (product) => {
					await loadProducts()
					await selectProduct(product.id)
				}}
			/>
		</div>
	)
}
