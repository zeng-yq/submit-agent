import { describe, it, expect, vi } from 'vitest'
import { verifyAfterNavigation, applyNavigationVerdict } from '@/agent/verify-after-navigation'

const noopSleep = () => Promise.resolve()

describe('verifyAfterNavigation', () => {
	it('URL 落定 + 待审核 → moderation', async () => {
		const getTabUrl = vi.fn().mockResolvedValue('https://x.com/post?unapproved=1&moderation-hash=a#comment-1')
		const sendVerify = vi.fn().mockResolvedValue({ ok: true, moderation: true, commentVisible: true })
		expect(await verifyAfterNavigation(1, { getTabUrl, sendVerify, sleep: noopSleep })).toBe('moderation')
	})

	it('URL 落定 + 已发布 → confirmed', async () => {
		const getTabUrl = vi.fn().mockResolvedValue('https://x.com/post#comment-1')
		const sendVerify = vi.fn().mockResolvedValue({ ok: true, moderation: false, commentVisible: true })
		expect(await verifyAfterNavigation(1, { getTabUrl, sendVerify, sleep: noopSleep })).toBe('confirmed')
	})

	it('moderation=false 但评论不可见 → unverified（后台静默审核）', async () => {
		// 复现用户反馈的 bug：评论进后台审核队列，跳转后页面既无待审核提示、也看不到评论内容。
		// 应判失败，而非沿用旧行为（moderation=false 即 confirmed）误入库。
		const getTabUrl = vi.fn().mockResolvedValue('https://x.com/post#comment-1')
		const sendVerify = vi.fn().mockResolvedValue({ ok: true, moderation: false, commentVisible: false })
		expect(await verifyAfterNavigation(1, { getTabUrl, sendVerify, sleep: noopSleep, pollMs: 1, verifyTimeoutMs: 2 })).toBe('unverified')
	})

	it('评论异步渲染：首搜 commentVisible=false，重试后 true → confirmed', async () => {
		// WP REST/Blogger 等评论节点异步注入：CS 就绪时评论尚未渲染，需在预算内重试等待。
		const getTabUrl = vi.fn().mockResolvedValue('https://x.com/post#comment-1')
		const sendVerify = vi.fn()
			.mockResolvedValueOnce({ ok: true, moderation: false, commentVisible: false })
			.mockResolvedValueOnce({ ok: true, moderation: false, commentVisible: true })
		expect(await verifyAfterNavigation(1, { getTabUrl, sendVerify, sleep: noopSleep, pollMs: 1, verifyTimeoutMs: 100 })).toBe('confirmed')
	})

	it('commentText 透传给 sendVerify', async () => {
		const getTabUrl = vi.fn().mockResolvedValue('https://x.com/post#comment-1')
		const sendVerify = vi.fn().mockResolvedValue({ ok: true, moderation: false, commentVisible: true })
		await verifyAfterNavigation(1, { getTabUrl, sendVerify, sleep: noopSleep }, 'my comment text')
		expect(sendVerify).toHaveBeenCalledWith(1, 'my comment text')
	})

	it('sendVerify 持续失败 → unverified', async () => {
		const getTabUrl = vi.fn().mockResolvedValue('https://x.com/post#comment-1')
		const sendVerify = vi.fn().mockRejectedValue(new Error('no response'))
		expect(await verifyAfterNavigation(1, { getTabUrl, sendVerify, sleep: noopSleep, pollMs: 1, settleTimeoutMs: 2, verifyTimeoutMs: 2 })).toBe('unverified')
	})

	it('URL 一直未落定 + sendVerify 失败 → unverified', async () => {
		const getTabUrl = vi.fn().mockResolvedValue('https://x.com/wp-comments-post.php')
		const sendVerify = vi.fn().mockRejectedValue(new Error('no response'))
		expect(await verifyAfterNavigation(1, { getTabUrl, sendVerify, sleep: noopSleep, pollMs: 1, settleTimeoutMs: 2, verifyTimeoutMs: 2 })).toBe('unverified')
	})

	it('content script 延迟注入：前几次 receiving-end-not-exist，后续就绪 → confirmed', async () => {
		// 真实场景：整页跳转后 URL 落定早于 content script 注入，
		// chrome.tabs.sendMessage 因 "Receiving end does not exist" 立即 reject；
		// 应在预算内持续重试，等 content script 就绪后判定，而非 3 次就放弃。
		const getTabUrl = vi.fn().mockResolvedValue('https://x.com/post#comment-1')
		const sendVerify = vi.fn()
			.mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'))
			.mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'))
			.mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'))
			.mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'))
			.mockResolvedValueOnce({ ok: true, moderation: false, commentVisible: true })
		expect(await verifyAfterNavigation(1, { getTabUrl, sendVerify, sleep: noopSleep, pollMs: 1, settleTimeoutMs: 2, verifyTimeoutMs: 100 })).toBe('confirmed')
	})

	it('content script 延迟注入后返回待审核 → moderation', async () => {
		const getTabUrl = vi.fn().mockResolvedValue('https://x.com/post#comment-1')
		const sendVerify = vi.fn()
			.mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'))
			.mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'))
			.mockResolvedValueOnce({ ok: true, moderation: true, commentVisible: true })
		expect(await verifyAfterNavigation(1, { getTabUrl, sendVerify, sleep: noopSleep, pollMs: 1, settleTimeoutMs: 2, verifyTimeoutMs: 100 })).toBe('moderation')
	})
})

describe('applyNavigationVerdict', () => {
	it('navigating + moderation → pending_moderation', () => {
		expect(applyNavigationVerdict('navigating', 'moderation')).toBe('pending_moderation')
	})
	it('pagehide + unverified → unverified', () => {
		expect(applyNavigationVerdict('pagehide', 'unverified')).toBe('unverified')
	})
	it('navigating + confirmed → 维持 navigating', () => {
		expect(applyNavigationVerdict('navigating', 'confirmed')).toBe('navigating')
	})
	it('ajax（非跳转）→ 不受 verdict 影响', () => {
		expect(applyNavigationVerdict('ajax', 'moderation')).toBe('ajax')
	})
})
