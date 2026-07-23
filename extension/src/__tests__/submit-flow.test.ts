import { describe, it, expect, vi } from 'vitest'
import { runSubmitAndVerify } from '@/agent/FormFillEngine'
import type { SubmitResponse } from '@/agent/comment-submit'
import { VERIFIED_SUCCESS } from '@/agent/types'

const ok = (over: Partial<SubmitResponse> = {}): SubmitResponse => ({
	ok: true,
	clicked: true,
	verifyResult: 'ajax',
	...over,
})

describe('runSubmitAndVerify', () => {
	it('submit 响应丢失（整页跳转销毁上下文）+ 跳转后确认已发布 → 判成功', async () => {
		// 复现 Blogger 跨域 iframe 场景：submit 因顶层导航 reject（端口关闭），
		// 但评论实际已发布 → 跨页面验证 confirmed → 应判成功，而非 not_attempted 失败。
		const r = await runSubmitAndVerify({
			sendSubmit: vi.fn().mockRejectedValue(new Error('The message port closed before a response was received')),
			verifyNavigation: vi.fn().mockResolvedValue('confirmed'),
		})
		expect(VERIFIED_SUCCESS).toContain(r.verifyResult)
		expect(r.submitted).toBe(true)
	})

	it('submit 响应丢失 + 跳转后待审核 → pending_moderation', async () => {
		const r = await runSubmitAndVerify({
			sendSubmit: vi.fn().mockRejectedValue(new Error('port closed')),
			verifyNavigation: vi.fn().mockResolvedValue('moderation'),
		})
		expect(r.verifyResult).toBe('pending_moderation')
	})

	it('submit 响应丢失 + 跳转后无法确认 → not_attempted（保守失败）', async () => {
		const r = await runSubmitAndVerify({
			sendSubmit: vi.fn().mockRejectedValue(new Error('port closed')),
			verifyNavigation: vi.fn().mockResolvedValue('unverified'),
		})
		expect(r.verifyResult).toBe('not_attempted')
		expect(r.submitError).toMatch(/丢失|无法确认/)
	})

	it('submit 成功 + navigating + confirmed → 维持 navigating（成功）', async () => {
		const r = await runSubmitAndVerify({
			sendSubmit: vi.fn().mockResolvedValue(ok({ verifyResult: 'navigating' })),
			verifyNavigation: vi.fn().mockResolvedValue('confirmed'),
		})
		expect(r.verifyResult).toBe('navigating')
		expect(VERIFIED_SUCCESS).toContain(r.verifyResult)
	})

	it('submit 成功 + navigating + moderation → pending_moderation', async () => {
		const r = await runSubmitAndVerify({
			sendSubmit: vi.fn().mockResolvedValue(ok({ verifyResult: 'pagehide' })),
			verifyNavigation: vi.fn().mockResolvedValue('moderation'),
		})
		expect(r.verifyResult).toBe('pending_moderation')
	})

	it('submit 成功 + ajax（无需跨页面验证）→ ajax，且不调用 verifyNavigation', async () => {
		const verifyNavigation = vi.fn().mockResolvedValue('confirmed')
		const r = await runSubmitAndVerify({
			sendSubmit: vi.fn().mockResolvedValue(ok({ verifyResult: 'ajax' })),
			verifyNavigation,
		})
		expect(r.verifyResult).toBe('ajax')
		expect(verifyNavigation).not.toHaveBeenCalled()
	})

	it('submit 返回 ok=false（如未找到按钮）→ not_attempted，不调用 verifyNavigation', async () => {
		const verifyNavigation = vi.fn().mockResolvedValue('confirmed')
		const r = await runSubmitAndVerify({
			sendSubmit: vi.fn().mockResolvedValue({ ok: false, clicked: false, verifyResult: 'not_attempted', error: '未找到提交按钮' }),
			verifyNavigation,
		})
		expect(r.verifyResult).toBe('not_attempted')
		expect(verifyNavigation).not.toHaveBeenCalled()
	})
})
