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

/**
 * Match current URL against known sites' submit_url.
 * Returns the matching site or undefined.
 */
export function matchCurrentPage(sites: SiteData[], currentUrl: string): SiteData | undefined {
	const url = new URL(currentUrl)
	const hostname = url.hostname.replace(/^www\./, '')
	const pathname = url.pathname.replace(/\/+$/, '')

	return sites.find((site) => {
		if (!site.submit_url) return false
		try {
			const siteUrl = new URL(site.submit_url)
			const siteHost = siteUrl.hostname.replace(/^www\./, '')
			const sitePath = siteUrl.pathname.replace(/\/+$/, '')
			return hostname === siteHost && pathname.startsWith(sitePath)
		} catch {
			return false
		}
	})
}

/**
 * Pick a random unsubmitted site from the list.
 * Filters to submittable sites, sorts by DR descending, picks top N, then random.
 */
export function getRandomUnsubmitted(
	sites: SiteData[],
	submittedNames: Set<string>,
	count = 10
): SiteData | undefined {
	const eligible = sites
		.filter((s) => s.submit_url && !submittedNames.has(s.name))
		.sort((a, b) => (b.dr ?? 0) - (a.dr ?? 0))

	if (eligible.length === 0) return undefined

	const pool = eligible.slice(0, count)
	return pool[Math.floor(Math.random() * pool.length)]
}
