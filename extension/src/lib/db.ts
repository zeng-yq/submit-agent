import { type DBSchema, type IDBPDatabase, openDB } from 'idb'
import type { ProductProfile, SiteRecord, SiteData, SubmissionRecord, BacklinkRecord, BacklinkStatus, SiteCategory } from './types'
import { extractDomain } from './backlinks'

const DB_NAME = 'submit-agent'
const DB_VERSION = 6

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
			'by-domain': string
		}
	}
	backlinks: {
		key: string
		value: BacklinkRecord
		indexes: {
			'by-status': string
			'by-url': string
			'by-updated': number
		}
	}
}

let dbPromise: Promise<IDBPDatabase<SubmitAgentDB>> | null = null

function getDB() {
	if (!dbPromise) {
		dbPromise = openDB<SubmitAgentDB>(DB_NAME, DB_VERSION, {
			upgrade(db, oldVersion, _newVersion, tx) {
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
					}
				if (oldVersion < 3) {
					const backlinks = db.createObjectStore('backlinks', { keyPath: 'id' })
					backlinks.createIndex('by-status', 'status')
					backlinks.createIndex('by-url', 'sourceUrl')
					backlinks.createIndex('by-updated', 'updatedAt')
				}
				if (oldVersion < 4) {
					// Schema-less: new optional fields (error, failedAt) need no index changes
				}
				if (oldVersion < 6) {
					if (db.objectStoreNames.contains('sites')) {
						tx.objectStore('sites').createIndex('by-domain', 'domain')
					}
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

export async function bulkPutProducts(records: ProductProfile[]): Promise<void> {
	const db = await getDB()
	const tx = db.transaction('products', 'readwrite')
	await tx.store.clear()
	for (const record of records) {
		await tx.store.put(record)
	}
	await tx.done
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

export async function bulkPutSubmissions(records: SubmissionRecord[]): Promise<void> {
	const db = await getDB()
	const tx = db.transaction('submissions', 'readwrite')
	await tx.store.clear()
	for (const record of records) {
		await tx.store.put(record)
	}
	await tx.done
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
			const raw = site.category as string
			const category: SiteCategory = raw === 'Non-Blog Comment' ? 'others' : raw as SiteCategory
			const record: SiteRecord = {
				...site,
				category,
				domain: site.submit_url ? extractDomain(site.submit_url) : undefined,
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

export async function updateSiteCategory(name: string, category: SiteCategory): Promise<SiteRecord> {
	const db = await getDB()
	const site = await db.get('sites', name)
	if (!site) throw new Error(`Site not found: ${name}`)
	const updated = { ...site, category, updatedAt: Date.now() }
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

export async function bulkPutSites(records: SiteRecord[]): Promise<void> {
	const db = await getDB()
	const tx = db.transaction('sites', 'readwrite')
	await tx.store.clear()
	for (const record of records) {
		await tx.store.put(record)
	}
	await tx.done
}

export async function deleteSubmissionsBySite(siteName: string): Promise<void> {
	const db = await getDB()
	const tx = db.transaction('submissions', 'readwrite')
	let cursor = await tx.store.index('by-site').openCursor(siteName)
	while (cursor) {
		await cursor.delete()
		cursor = await cursor.continue()
	}
	await tx.done
}

// ---- Backlink CRUD ----

export async function saveBacklink(
	data: Omit<BacklinkRecord, 'id' | 'createdAt' | 'updatedAt'>
): Promise<BacklinkRecord> {
	const db = await getDB()
	const now = Date.now()
	const record: BacklinkRecord = {
		...data,
		domain: data.domain ?? extractDomain(data.sourceUrl),
		id: crypto.randomUUID(),
		createdAt: now,
		updatedAt: now,
	}
	await db.put('backlinks', record)
	return record
}

export async function updateBacklink(backlink: BacklinkRecord): Promise<BacklinkRecord> {
	const db = await getDB()
	const updated = { ...backlink, updatedAt: Date.now() }
	await db.put('backlinks', updated)
	return updated
}

export async function getBacklink(id: string): Promise<BacklinkRecord | undefined> {
	const db = await getDB()
	return db.get('backlinks', id)
}

export async function getBacklinkByUrl(sourceUrl: string): Promise<BacklinkRecord | undefined> {
	const db = await getDB()
	return db.getFromIndex('backlinks', 'by-url', sourceUrl)
}

export async function getSiteByDomain(domain: string): Promise<SiteRecord | undefined> {
	const db = await getDB()
	return db.getFromIndex('sites', 'by-domain', domain)
}

export async function listBacklinks(): Promise<BacklinkRecord[]> {
	const db = await getDB()
	const all = await db.getAllFromIndex('backlinks', 'by-updated')
	return all.reverse()
}

export async function listBacklinksByStatus(status: BacklinkStatus): Promise<BacklinkRecord[]> {
	const db = await getDB()
	return db.getAllFromIndex('backlinks', 'by-status', status)
}

export async function deleteBacklink(id: string): Promise<void> {
	const db = await getDB()
	await db.delete('backlinks', id)
}

export async function clearBacklinks(): Promise<void> {
	const db = await getDB()
	await db.clear('backlinks')
}

export async function bulkPutBacklinks(records: BacklinkRecord[]): Promise<void> {
	const db = await getDB()
	const tx = db.transaction('backlinks', 'readwrite')
	await tx.store.clear()
	for (const record of records) {
		await tx.store.put(record)
	}
	await tx.done
}
