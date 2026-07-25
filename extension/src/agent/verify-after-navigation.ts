/**
 * verify-after-navigation —— 整页跳转后的待审核验证（DI 纯函数）。
 * 提交触发 navigating/pagehide 时，旧 content script 上下文看不到新页面状态，
 * 故由引擎在跳转落定后向新页面 content script 复核；本模块封装该流程，便于单测注入。
 */
import type { VerifyResult } from './types'

export type ModerationVerdict = 'confirmed' | 'moderation' | 'unverified' | 'cloudflare'

export interface VerifyAfterNavigationDeps {
	/** 读取目标 tab 当前 URL（真实实现对接 chrome.tabs.get） */
	getTabUrl: (tabId: number) => Promise<string>
	/** 向新页面 content script 发 verify-moderation（携带评论文本）并等待回复（真实实现对接 sendToTab） */
	sendVerify: (tabId: number, commentText?: string) => Promise<{ ok: boolean; moderation: boolean; commentVisible: boolean; cloudflare: boolean }>
	/** 延时（真实实现 = setTimeout） */
	sleep: (ms: number) => Promise<void>
	/** 等 URL 落定的总预算（ms），默认 6000 */
	settleTimeoutMs?: number
	/** 轮询/重试间隔（ms），默认 500 */
	pollMs?: number
	/** 阶段 2 向新页面 content script 复核的总预算（ms），默认 8000。
	 *  整页跳转后 URL 落定通常早于 content script 注入（runAt: document_end），
	 *  此时 chrome.tabs.sendMessage 会因 "Receiving end does not exist" 立即 reject，
	 *  故按时间预算持续重试等其就绪，而非固定次数。 */
	verifyTimeoutMs?: number
}

/** 跳转后最终页面的 URL 标记：评论锚点或 WP moderation 参数（仅重定向落定后出现） */
const FINAL_URL_MARKER = /#comment|unapproved=|moderation-hash=/i

/**
 * 整页跳转后验证评论发布状态。
 * 阶段 1：轮询 tab URL 等重定向落定（出现最终页标记，或连续两次相同）。
 * 阶段 2：向新页面 content script 发 verify-moderation（携带评论文本），在 verifyTimeoutMs 预算内重试：
 *   - cloudflare=true（落定页是 Cloudflare 整页挑战页）→ 'cloudflare'（优先拦截 commentVisible 降级误判）
 *   - moderation=true（URL 参数/DOM 待审核标记）→ 'moderation'
 *   - moderation=false 且页面搜到评论文本（commentVisible）→ 'confirmed'（已发布）
 *   - moderation=false 但评论不可见：可能异步加载中，继续重试等待渲染；预算耗尽仍不可见 → 'unverified'（保守失败）
 * commentText 缺省时 content script 返回 commentVisible=true（降级，退化为只看 moderation）。
 */
export async function verifyAfterNavigation(
	tabId: number,
	deps: VerifyAfterNavigationDeps,
	commentText?: string,
): Promise<ModerationVerdict> {
	const { getTabUrl, sendVerify, sleep } = deps
	const settleTimeoutMs = deps.settleTimeoutMs ?? 6000
	const pollMs = deps.pollMs ?? 500
	const verifyTimeoutMs = deps.verifyTimeoutMs ?? 8000
	const maxSettlePolls = Math.max(1, Math.round(settleTimeoutMs / pollMs))

	// 阶段 1：等重定向落定
	let prevUrl = ''
	for (let i = 0; i < maxSettlePolls; i++) {
		let url = ''
		try {
			url = await getTabUrl(tabId)
		} catch {
			url = ''
		}
		if (FINAL_URL_MARKER.test(url) || (url && url === prevUrl)) break
		prevUrl = url
		await sleep(pollMs)
	}

	// 阶段 2：问新页面 content script（在预算内持续重试，等 document_end 注入完成 + 评论异步渲染）
	//   整页跳转后 URL 落定往往早于 content script 就绪：chrome.tabs.sendMessage 会因
	//   "Receiving end does not exist" 立即 reject，故按 verifyTimeoutMs 预算重试而非固定次数。
	//   commentVisible=false 时也不立即判失败：评论可能异步加载（WP REST/Blogger/Lazy Load），
	//   继续重试等待渲染；预算耗尽仍不可见才判 unverified。
	const maxVerifyPolls = Math.max(1, Math.round(verifyTimeoutMs / pollMs))
	for (let i = 0; i < maxVerifyPolls; i++) {
		try {
			const r = await sendVerify(tabId, commentText)
			if (r?.ok === true) {
				// 整页 Cloudflare 挑战页：评论显然未发布，优先判定（拦截 commentVisible 降级导致的 confirmed 误判）
				if (r.cloudflare) return 'cloudflare'
				if (r.moderation) return 'moderation'
				if (r.commentVisible) return 'confirmed'
				// moderation=false && commentVisible=false：评论可能异步加载中，继续重试
			}
		} catch {
			// content script 未就绪/出错 → 在预算内继续重试
		}
		await sleep(pollMs)
	}
	return 'unverified'
}

/**
 * 把「跳转后验证」结论应用到 verifyResult。
 * 仅 navigating/pagehide 受影响：moderation→pending_moderation，cloudflare→blocked_cloudflare，unverified→unverified，confirmed→维持原值。
 * 非跳转结果（ajax/cleared/...）原样返回。
 */
export function applyNavigationVerdict(verifyResult: VerifyResult, verdict: ModerationVerdict): VerifyResult {
	if (verifyResult !== 'navigating' && verifyResult !== 'pagehide') return verifyResult
	if (verdict === 'moderation') return 'pending_moderation'
	if (verdict === 'cloudflare') return 'blocked_cloudflare'
	if (verdict === 'unverified') return 'unverified'
	return verifyResult
}
