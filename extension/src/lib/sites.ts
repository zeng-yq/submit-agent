import type { SiteData, SitesDatabase } from './types'
import { seedSites, listSites } from './db'

let cachedSites: SiteData[] | null = null

export async function loadSites(): Promise<SiteData[]> {
	if (cachedSites) return cachedSites

	// Try loading from IndexedDB first
	const records = await listSites()
	if (records.length > 0) {
		cachedSites = records
		return cachedSites
	}

	// DB is empty — seed from bundled sites.json, then read back
	const url = chrome.runtime.getURL('sites.json')
	const resp = await fetch(url)
	const data: SitesDatabase = await resp.json()
	await seedSites(data.sites)
	cachedSites = await listSites()
	return cachedSites
}

/** Force reload from IndexedDB (bypasses in-memory cache). */
export async function reloadSites(): Promise<SiteData[]> {
	const records = await listSites()
	cachedSites = records
	return cachedSites
}

export function sortByDR(sites: SiteData[]): SiteData[] {
	return [...sites].sort((a, b) => (b.dr ?? 0) - (a.dr ?? 0))
}

export function filterByCategory(sites: SiteData[], category: string): SiteData[] {
	return sites.filter((s) => s.category === category)
}

export function filterSubmittable(sites: SiteData[]): SiteData[] {
	return sites.filter((s) => s.submit_url !== null)
}

export function getCategories(sites: SiteData[]): string[] {
	return [...new Set(sites.map((s) => s.category))]
}

export function getSiteByName(sites: SiteData[], name: string): SiteData | undefined {
	return sites.find((s) => s.name === name)
}
