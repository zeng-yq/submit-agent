// src/messaging/__tests__/router.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MessageRouter } from '@/messaging/router'
import type { ExtensionMessage } from '@/messaging/messages'

describe('MessageRouter', () => {
	let sendResponse: ReturnType<typeof vi.fn>
	let ctx: { sender: chrome.runtime.MessageSender; tabId?: number }

	beforeEach(() => {
		sendResponse = vi.fn()
		ctx = { sender: { tab: { id: 7 } } as chrome.runtime.MessageSender, tabId: 7 }
	})

	it('无 action 的 type 命中已注册 handler 并回传同步返回值', () => {
		const router = new MessageRouter()
		const handler = vi.fn(() => ({ ok: true }))
		router.on('CLOSE_TAB', handler)
		const ret = router.dispatch({ type: 'CLOSE_TAB' } as ExtensionMessage, ctx, sendResponse)
		expect(handler).toHaveBeenCalledOnce()
		expect(sendResponse).toHaveBeenCalledWith({ ok: true })
		expect(ret).toBeUndefined() // 同步 → 不保活
	})

	it('带 action 的 type 按 action 二级路由', () => {
		const router = new MessageRouter()
		const analyze = vi.fn(() => ({ ok: true }))
		const fill = vi.fn(() => ({ ok: true }))
		router.on('TAB_COMMAND', 'analyze', analyze)
		router.on('TAB_COMMAND', 'fill', fill)
		router.dispatch({ type: 'TAB_COMMAND', action: 'fill', payload: { fields: [] } } as ExtensionMessage, ctx, sendResponse)
		expect(fill).toHaveBeenCalledOnce()
		expect(analyze).not.toHaveBeenCalled()
	})

	it('异步 handler 返回 true 保活通道，resolve 后回传', async () => {
		const router = new MessageRouter()
		router.on('TAB_COMMAND', 'analyze', () => Promise.resolve({ ok: true, analysis: { fields: [] } }))
		const ret = router.dispatch({ type: 'TAB_COMMAND', action: 'analyze', payload: { siteType: 'blog_comment' } } as ExtensionMessage, ctx, sendResponse)
		expect(ret).toBe(true)
		await new Promise((r) => setTimeout(r, 0))
		expect(sendResponse).toHaveBeenCalledWith({ ok: true, analysis: { fields: [] } })
	})

	it('handler 抛异常被捕获，回传 error，不崩', () => {
		const router = new MessageRouter()
		router.on('CLOSE_TAB', () => { throw new Error('boom') })
		const ret = router.dispatch({ type: 'CLOSE_TAB' } as ExtensionMessage, ctx, sendResponse)
		expect(ret).toBeUndefined()
		expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ error: 'boom' }))
	})

	it('未注册 handler → 返回 undefined，不调 sendResponse', () => {
		const router = new MessageRouter()
		const ret = router.dispatch({ type: 'CLOSE_TAB' } as ExtensionMessage, ctx, sendResponse)
		expect(ret).toBeUndefined()
		expect(sendResponse).not.toHaveBeenCalled()
	})

	it('hasHandler：遍历联合判断是否每个 type 至少有一条注册（注册覆盖守门）', () => {
		// 此测试由后续任务逐步补全到所有 type 都注册；此处仅验证机制
		const router = new MessageRouter()
		expect(router.hasHandler({ type: 'CLOSE_TAB' } as ExtensionMessage)).toBe(false)
		router.on('CLOSE_TAB', () => undefined)
		expect(router.hasHandler({ type: 'CLOSE_TAB' } as ExtensionMessage)).toBe(true)
	})

	it('非白名单 type 用 3 参 action 注册仍能被分发（FLOAT_FILL 回归，锁定按形状分发）', () => {
		// 旧实现用 type 白名单（FILL_PROGRESS/TAB_COMMAND）决定是否走 action 二级分发，
		// 导致 FLOAT_FILL 等 type 上用 3 参注册的 handler 永不被调用。
		const router = new MessageRouter()
		const handler = vi.fn(() => ({ ok: true, analysis: { fields: [] } }))
		// FLOAT_FILL 暂未纳入 ExtensionMessage 联合（T4 改名 TAB_COMMAND 时补齐），
		// 同 content.ts/registerContentHandlers 的过渡模式用 as any 绕过守门。
		router.on('FLOAT_FILL' as any, 'analyze', handler)
		expect(router.hasHandler({ type: 'FLOAT_FILL', action: 'analyze' } as any)).toBe(true)
		const ret = router.dispatch(
			{ type: 'FLOAT_FILL', action: 'analyze', payload: { siteType: 'blog_comment' } } as any,
			ctx,
			sendResponse,
		)
		expect(handler).toHaveBeenCalledOnce()
		expect(sendResponse).toHaveBeenCalledWith({ ok: true, analysis: { fields: [] } })
		expect(ret).toBeUndefined() // 同步 → 不保活
	})
})
