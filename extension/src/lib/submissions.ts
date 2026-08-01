import type { ProductProfile, SubmissionRecord, SubmissionStatus } from './types'
import { extractDomain } from './backlinks'

/** 状态优先级：数值越大，合并时越优先保留（决定 Dashboard 显示哪条）。
 *  approved(已通过) > submitted(已提交) > rejected > failed > skipped > in_progress > not_started */
const STATUS_PRIORITY: Record<SubmissionStatus, number> = {
	approved: 7,
	submitted: 6,
	rejected: 5,
	failed: 4,
	skipped: 3,
	in_progress: 2,
	not_started: 1,
}

/**
 * 把多条提交记录（可能跨产品、同 siteName 重复）按 siteName 合并为 Map，
 * 每个 siteName 只保留「最强状态」的那条。
 *
 * 用于跨页面去重场景：同一网站的不同页面被建为多个产品后，
 * 查询「同域名产品组」的所有提交记录会出现同 siteName 的多条记录，
 * 合并后前端按 siteName 索引时只取最强状态，避免重复显示与重复提交。
 */
export function mergeSubmissionsBySite(records: SubmissionRecord[]): Map<string, SubmissionRecord> {
	const map = new Map<string, SubmissionRecord>()
	for (const r of records) {
		const prev = map.get(r.siteName)
		if (!prev || STATUS_PRIORITY[r.status] > STATUS_PRIORITY[prev.status]) {
			map.set(r.siteName, r)
		}
	}
	return map
}

export interface ProductGroup {
	/** 组键：有 url 时为域名，无 url 时为产品自身 id（保证无 url 产品各自独立成组） */
	key: string
	/** 该组展示用的域名标签（无 url 产品为空串） */
	domain: string
	products: ProductProfile[]
}

/**
 * 把产品按 URL 域名分组，用于 UI 展示：同域名产品连续排列，不同域名之间可加分隔线。
 *
 * - 组顺序：按组内最新 updatedAt 倒序（保持"最近编辑优先"的心智）
 * - 组内顺序：按 updatedAt 倒序
 * - 无 url / url 无效的产品：各自单独成组，避免误聚合，排在最后
 *
 * 入参应已按 updatedAt 倒序（如 listProducts 的返回），本函数保持其稳定。
 */
export function groupProductsByDomain(products: ProductProfile[]): ProductGroup[] {
	const byKey = new Map<string, ProductProfile[]>()
	for (const p of products) {
		// 仅当 url 能解析出含点的真实域名时才归组，否则视为无 url（各自独立成组）
		const raw = p.url ? extractDomain(p.url) : ''
		const domain = raw && raw.includes('.') ? raw : ''
		const key = domain || `__noid__${p.id}`
		const arr = byKey.get(key)
		if (arr) arr.push(p)
		else byKey.set(key, [p])
	}
	return Array.from(byKey.entries())
		.map(([key, items]) => {
			// 组内按 updatedAt 倒序，不依赖调用方预排序
			const sorted = [...items].sort((a, b) => b.updatedAt - a.updatedAt)
			return {
				key,
				domain: key.startsWith('__noid__') ? '' : key,
				products: sorted,
			}
		})
		.sort((a, b) => {
			// 无 url 组（domain 为空）排在所有有效域名组之后
			const aNoUrl = a.domain === '' ? 1 : 0
			const bNoUrl = b.domain === '' ? 1 : 0
			if (aNoUrl !== bNoUrl) return aNoUrl - bNoUrl
			// 同类内按组内最新 updatedAt 倒序
			const aMax = a.products[0]?.updatedAt ?? 0
			const bMax = b.products[0]?.updatedAt ?? 0
			return bMax - aMax
		})
}
