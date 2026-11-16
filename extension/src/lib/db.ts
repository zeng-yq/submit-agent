import { type DBSchema, type IDBPDatabase, openDB } from 'idb'
import type { Product } from './types'

const DB_NAME = 'submit-agent'
const DB_VERSION = 8

/** v7 及以前的 store。旧功能已整体移除，升级时全部清空，不做数据迁移。 */
const LEGACY_STORES = ['products', 'submissions', 'sites', 'backlinks'] as const

interface SubmitAgentDB extends DBSchema {
	products: {
		key: string
		value: Product
		indexes: { 'by-domain': string; 'by-updated': number }
	}
}

let dbPromise: Promise<IDBPDatabase<SubmitAgentDB>> | null = null

function getDB() {
	if (!dbPromise) {
		dbPromise = openDB<SubmitAgentDB>(DB_NAME, DB_VERSION, {
			upgrade(db) {
				// idb 的类型化 API 只认识新 schema 的 store，删除旧 store 需走原生接口
				const legacy = db as unknown as IDBDatabase
				for (const storeName of LEGACY_STORES) {
					if (legacy.objectStoreNames.contains(storeName)) legacy.deleteObjectStore(storeName)
				}
				const products = db.createObjectStore('products', { keyPath: 'id' })
				products.createIndex('by-domain', 'domain', { unique: true })
				products.createIndex('by-updated', 'updatedAt')
			},
		})
	}
	return dbPromise
}

/** 全部产品，按更新时间倒序 */
export async function listProducts(): Promise<Product[]> {
	const db = await getDB()
	const all = await db.getAllFromIndex('products', 'by-updated')
	return all.reverse()
}

export async function getProduct(id: string): Promise<Product | undefined> {
	const db = await getDB()
	return db.get('products', id)
}

export async function getProductByDomain(domain: string): Promise<Product | undefined> {
	const db = await getDB()
	return db.getFromIndex('products', 'by-domain', domain)
}

/** 新建或整体覆盖保存（updatedAt 由调用方负责设置） */
export async function saveProduct(product: Product): Promise<void> {
	const db = await getDB()
	await db.put('products', product)
}

export async function deleteProduct(id: string): Promise<void> {
	const db = await getDB()
	await db.delete('products', id)
}
