import type { SubmissionRecord, SubmissionStatus } from './types'

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
