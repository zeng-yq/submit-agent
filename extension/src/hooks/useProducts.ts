import { useCallback, useEffect, useState } from 'react'
import { deleteProduct, listProducts } from '@/lib/db'
import { getActiveProductId, setActiveProductId } from '@/lib/storage'
import type { Product } from '@/lib/types'

/** 产品列表与当前选中产品的加载、切换、删除（当前产品选择持久化，重开面板保持）。null 表示尚未加载完成。 */
export function useProducts() {
	const [products, setProducts] = useState<Product[] | null>(null)
	const [activeProductId, setCurrentId] = useState<string | null>(null)
	const loadProducts = useCallback(async () => {
		const [all, storedActiveId] = await Promise.all([listProducts(), getActiveProductId()])
		const nextActiveId =
			storedActiveId && all.some((product) => product.id === storedActiveId)
				? storedActiveId
				: (all[0]?.id ?? null)
		if (nextActiveId !== storedActiveId) {
			await setActiveProductId(nextActiveId)
		}
		setProducts(all)
		setCurrentId(nextActiveId)
	}, [])

	useEffect(() => {
		void loadProducts()
	}, [loadProducts])

	const activeProduct = products?.find((product) => product.id === activeProductId) ?? null

	const selectProduct = useCallback(async (id: string) => {
		await setActiveProductId(id)
		setCurrentId(id)
	}, [])

	const removeProduct = useCallback(
		async (id: string) => {
			await deleteProduct(id)
			await loadProducts()
		},
		[loadProducts],
	)

	return { products, activeProduct, activeProductId, loadProducts, selectProduct, removeProduct }
}
