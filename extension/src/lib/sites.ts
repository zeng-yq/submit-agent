import type { SiteData, SitesDatabase, SiteCategory, SitePricing } from './types'
import { seedSites, listSites, addSite, updateSite, getSiteByDomain } from './db'
import { parseCsv, extractDomain } from './backlinks'

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

export function filterByCategory(sites: SiteData[], category: SiteCategory): SiteData[] {
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

export interface SiteImportResult {
	imported: number
	updated: number
	skipped: number
	errors: number
}

/** CSV「价格」中文 → 结构化枚举；非标准值 → undefined */
function mapPricingType(raw: string | undefined): SitePricing | undefined {
	const v = raw?.trim()
	if (v === '免费') return 'free'
	if (v === '付费') return 'paid'
	if (v === '混合') return 'mixed'
	return undefined
}

/** CSV「需要登录」中文 → boolean；非标准值 → undefined */
function mapRequiresLogin(raw: string | undefined): boolean | undefined {
	const v = raw?.trim()
	if (v === '是') return true
	if (v === '否') return false
	return undefined
}

/**
 * 导入 AI 目录外链 CSV（表头：名称,url,价格,需要登录）到 sites store。
 * - 按 domain 去重：已存在 → 仅补 pricing_type/requires_login（保留原分类与其余字段）；
 *   不存在 → 新建 category='ai_directory'、dr=null、无 submission（默认未提交）。
 * - 单行异常计入 errors 并继续。
 */
export async function importAiDirectoryFromCsv(csvText: string): Promise<SiteImportResult> {
	const rows = parseCsv(csvText)
	let imported = 0
	let updated = 0
	let skipped = 0
	let errors = 0

	for (const row of rows) {
		try {
			const url = row['url']?.trim()
			if (!url) {
				skipped++
				continue
			}
			const name = row['名称']?.trim() || url
			const domain = extractDomain(url)
			const pricing_type = mapPricingType(row['价格'])
			const requires_login = mapRequiresLogin(row['需要登录'])

			const existing = await getSiteByDomain(domain)
			if (existing) {
				await updateSite({ ...existing, pricing_type, requires_login })
				updated++
			} else {
				const now = Date.now()
				await addSite({
					name,
					submit_url: url,
					category: 'ai_directory',
					dr: null,
					pricing_type,
					requires_login,
					domain,
					createdAt: now,
					updatedAt: now,
				})
				imported++
			}
		} catch {
			errors++
		}
	}

	return { imported, updated, skipped, errors }
}
