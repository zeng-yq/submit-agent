import { useCallback, useEffect, useState } from 'react'
import type { ProductProfile } from '@/lib/types'
import {
	listProducts,
	saveProduct,
	updateProduct,
	deleteProduct as dbDeleteProduct,
} from '@/lib/db'
import { getActiveProductId, setActiveProductId } from '@/lib/storage'

const PRODUCTS_CHANGED = 'PRODUCTS_CHANGED'

export interface UseProductResult {
	products: ProductProfile[]
	activeProduct: ProductProfile | null
	loading: boolean
	createProduct: (data: Omit<ProductProfile, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>
	editProduct: (product: ProductProfile) => Promise<void>
	deleteProduct: (id: string) => Promise<void>
	setActive: (id: string) => Promise<void>
	refresh: () => Promise<void>
}

export function useProduct(): UseProductResult {
	const [products, setProducts] = useState<ProductProfile[]>([])
	const [activeId, setActiveId] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)

	const refresh = useCallback(async () => {
		const [prods, id] = await Promise.all([listProducts(), getActiveProductId()])
		setProducts(prods)
		if (id && prods.some((p) => p.id === id)) {
			setActiveId(id)
		} else if (prods.length > 0) {
			await setActiveProductId(prods[0].id)
			setActiveId(prods[0].id)
		} else {
			setActiveId(null)
		}
		setLoading(false)
	}, [])

	useEffect(() => {
		refresh()
	}, [refresh])

	// 监听其他页面的产品变更广播
	useEffect(() => {
		const handler = (message: any) => {
			if (message.type === PRODUCTS_CHANGED) {
				refresh()
			}
		}
		chrome.runtime.onMessage.addListener(handler)
		return () => chrome.runtime.onMessage.removeListener(handler)
	}, [refresh])

	const broadcastChange = useCallback(() => {
		chrome.runtime.sendMessage({ type: PRODUCTS_CHANGED }).catch(() => {})
	}, [])

	const activeProduct = products.find((p) => p.id === activeId) ?? products[0] ?? null

	const createProduct = useCallback(
		async (data: Omit<ProductProfile, 'id' | 'createdAt' | 'updatedAt'>) => {
			const created = await saveProduct(data)
			if (products.length === 0) {
				await setActiveProductId(created.id)
			}
			await refresh()
			broadcastChange()
		},
		[products.length, refresh, broadcastChange]
	)

	const editProduct = useCallback(
		async (product: ProductProfile) => {
			await updateProduct(product)
			await refresh()
			broadcastChange()
		},
		[refresh, broadcastChange]
	)

	const deleteProduct = useCallback(
		async (id: string) => {
			await dbDeleteProduct(id)
			await refresh()
			broadcastChange()
		},
		[refresh, broadcastChange]
	)

	const setActive = useCallback(
		async (id: string) => {
			await setActiveProductId(id)
			setActiveId(id)
			broadcastChange()
		},
		[broadcastChange]
	)

	return {
		products,
		activeProduct,
		loading,
		createProduct,
		editProduct,
		deleteProduct,
		setActive,
		refresh,
	}
}
