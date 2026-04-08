import { type DBSchema, type IDBPDatabase, openDB } from 'idb'
import type { ProductProfile, SiteRecord, SiteData, SubmissionRecord } from './types'

const DB_NAME = 'submit-agent'
const DB_VERSION = 2

interface SubmitAgentDB extends DBSchema {
	products: {
		key: string
		value: ProductProfile
		indexes: { 'by-updated': number }
	}
	submissions: {
		key: string
		value: SubmissionRecord
		indexes: {
			'by-site': string
			'by-product': string
			'by-status': string
			'by-updated': number
		}
	}
	sites: {
		key: string
		value: SiteRecord
		indexes: {
			'by-category': string
			'by-dr': number
			'by-source': string
		}
	}
}

let dbPromise: Promise<IDBPDatabase<SubmitAgentDB>> | null = null

function getDB() {
	if (!dbPromise) {
		dbPromise = openDB<SubmitAgentDB>(DB_NAME, DB_VERSION, {
			upgrade(db, oldVersion) {
				if (oldVersion < 1) {
					const products = db.createObjectStore('products', { keyPath: 'id' })
					products.createIndex('by-updated', 'updatedAt')

					const submissions = db.createObjectStore('submissions', { keyPath: 'id' })
					submissions.createIndex('by-site', 'siteName')
					submissions.createIndex('by-product', 'productId')
					submissions.createIndex('by-status', 'status')
					submissions.createIndex('by-updated', 'updatedAt')
				}
				if (oldVersion < 2) {
					const sites = db.createObjectStore('sites', { keyPath: 'name' })
					sites.createIndex('by-category', 'category')
					sites.createIndex('by-dr', 'dr')
					sites.createIndex('by-source', 'source')
				}
			},
		})
	}
	return dbPromise
}

// ---- Product CRUD ----

export async function saveProduct(
	data: Omit<ProductProfile, 'id' | 'createdAt' | 'updatedAt'>
): Promise<ProductProfile> {
	const db = await getDB()
	const now = Date.now()
	const record: ProductProfile = {
		...data,
		id: crypto.randomUUID(),
		createdAt: now,
		updatedAt: now,
	}
	await db.put('products', record)
	return record
}

export async function updateProduct(product: ProductProfile): Promise<ProductProfile> {
	const db = await getDB()
	const updated = { ...product, updatedAt: Date.now() }
	await db.put('products', updated)
	return updated
}

export async function getProduct(id: string): Promise<ProductProfile | undefined> {
	const db = await getDB()
	return db.get('products', id)
}

export async function listProducts(): Promise<ProductProfile[]> {
	const db = await getDB()
	const all = await db.getAllFromIndex('products', 'by-updated')
	return all.reverse()
}

export async function deleteProduct(id: string): Promise<void> {
	const db = await getDB()
	await db.delete('products', id)
}

// ---- Submission CRUD ----

export async function saveSubmission(
	data: Omit<SubmissionRecord, 'id' | 'createdAt' | 'updatedAt'>
): Promise<SubmissionRecord> {
	const db = await getDB()
	const now = Date.now()
	const record: SubmissionRecord = {
		...data,
		id: crypto.randomUUID(),
		createdAt: now,
		updatedAt: now,
	}
	await db.put('submissions', record)
	return record
}

export async function updateSubmission(submission: SubmissionRecord): Promise<SubmissionRecord> {
	const db = await getDB()
	const updated = { ...submission, updatedAt: Date.now() }
	await db.put('submissions', updated)
	return updated
}

export async function getSubmission(id: string): Promise<SubmissionRecord | undefined> {
	const db = await getDB()
	return db.get('submissions', id)
}

export async function getSubmissionBySite(siteName: string): Promise<SubmissionRecord | undefined> {
	const db = await getDB()
	return db.getFromIndex('submissions', 'by-site', siteName)
}

export async function listSubmissions(): Promise<SubmissionRecord[]> {
	const db = await getDB()
	const all = await db.getAllFromIndex('submissions', 'by-updated')
	return all.reverse()
}

export async function listSubmissionsByProduct(productId: string): Promise<SubmissionRecord[]> {
	const db = await getDB()
	return db.getAllFromIndex('submissions', 'by-product', productId)
}

export async function deleteSubmission(id: string): Promise<void> {
	const db = await getDB()
	await db.delete('submissions', id)
}

export async function clearSubmissions(): Promise<void> {
	const db = await getDB()
	await db.clear('submissions')
}

// ---- Site CRUD ----

/** Seed sites from sites.json into IndexedDB. Uses put (upsert) so existing records are preserved. */
export async function seedSites(sites: SiteData[]): Promise<void> {
	const db = await getDB()
	const tx = db.transaction('sites', 'readwrite')
	const now = Date.now()
	for (const site of sites) {
		const existing = await tx.store.get(site.name)
		if (!existing) {
			const record: SiteRecord = {
				...site,
				source: 'curated',
				createdAt: now,
				updatedAt: now,
			}
			await tx.store.put(record)
		}
	}
	await tx.done
}

export async function getSite(name: string): Promise<SiteRecord | undefined> {
	const db = await getDB()
	return db.get('sites', name)
}

export async function listSites(): Promise<SiteRecord[]> {
	const db = await getDB()
	return db.getAll('sites')
}

export async function addSite(site: SiteRecord): Promise<void> {
	const db = await getDB()
	await db.put('sites', site)
}

export async function updateSite(site: SiteRecord): Promise<SiteRecord> {
	const db = await getDB()
	const updated = { ...site, updatedAt: Date.now() }
	await db.put('sites', updated)
	return updated
}

export async function deleteSite(name: string): Promise<void> {
	const db = await getDB()
	await db.delete('sites', name)
}

export async function clearSites(): Promise<void> {
	const db = await getDB()
	await db.clear('sites')
}
