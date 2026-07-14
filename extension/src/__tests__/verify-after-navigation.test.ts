import { describe, it, expect, vi } from 'vitest'
import { verifyAfterNavigation, applyNavigationVerdict } from '@/agent/verify-after-navigation'

const noopSleep = () => Promise.resolve()

describe('verifyAfterNavigation', () => {
	it('URL 落定 + 待审核 → moderation', async () => {
		const getTabUrl = vi.fn().mockResolvedValue('https://x.com/post?unapproved=1&moderation-hash=a#comment-1')
		const sendVerify = vi.fn().mockResolvedValue({ ok: true, moderation: true })
		expect(await verifyAfterNavigation(1, { getTabUrl, sendVerify, sleep: noopSleep })).toBe('moderation')
	})

	it('URL 落定 + 已发布 → confirmed', async () => {
		const getTabUrl = vi.fn().mockResolvedValue('https://x.com/post#comment-1')
		const sendVerify = vi.fn().mockResolvedValue({ ok: true, moderation: false })
		expect(await verifyAfterNavigation(1, { getTabUrl, sendVerify, sleep: noopSleep })).toBe('confirmed')
	})

	it('sendVerify 持续失败 → unverified', async () => {
		const getTabUrl = vi.fn().mockResolvedValue('https://x.com/post#comment-1')
		const sendVerify = vi.fn().mockRejectedValue(new Error('no response'))
		expect(await verifyAfterNavigation(1, { getTabUrl, sendVerify, sleep: noopSleep, pollMs: 1, settleTimeoutMs: 2 })).toBe('unverified')
	})

	it('URL 一直未落定 + sendVerify 失败 → unverified', async () => {
		const getTabUrl = vi.fn().mockResolvedValue('https://x.com/wp-comments-post.php')
		const sendVerify = vi.fn().mockRejectedValue(new Error('no response'))
		expect(await verifyAfterNavigation(1, { getTabUrl, sendVerify, sleep: noopSleep, pollMs: 1, settleTimeoutMs: 2 })).toBe('unverified')
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
