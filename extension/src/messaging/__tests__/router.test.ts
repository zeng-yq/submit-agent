// src/messaging/__tests__/router.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MessageRouter, sendToTab, sendProgress, sendMessage } from '@/messaging/router'
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

	it('非白名单 type 用 3 参 action 注册仍能被分发（合成 type 回归，锁定按形状分发）', () => {
		// 旧实现用 type 白名单（FILL_PROGRESS/TAB_COMMAND）决定是否走 action 二级分发，
		// 导致任意非白名单 type 上用 3 参注册的 handler 永不被调用。
		// 用合成 type 名验证「按形状分发」机制对任意 type 都生效（type 名是任意的）。
		const router = new MessageRouter()
		const handler = vi.fn(() => ({ ok: true, analysis: { fields: [] } }))
		router.on('__TEST_ACTION_TYPE__' as any, 'analyze', handler)
		expect(router.hasHandler({ type: '__TEST_ACTION_TYPE__', action: 'analyze' } as any)).toBe(true)
		const ret = router.dispatch(
			{ type: '__TEST_ACTION_TYPE__', action: 'analyze', payload: { siteType: 'blog_comment' } } as any,
			ctx,
			sendResponse,
		)
		expect(handler).toHaveBeenCalledOnce()
		expect(sendResponse).toHaveBeenCalledWith({ ok: true, analysis: { fields: [] } })
		expect(ret).toBeUndefined() // 同步 → 不保活
	})
})

describe('发送封装：sendToTab / sendProgress / sendMessage', () => {
	let tabsSend: ReturnType<typeof vi.fn<(tabId: number, msg: unknown, cb: (r: unknown) => void) => void>>
	let runtimeSend: ReturnType<typeof vi.fn<(msg: unknown) => Promise<unknown>>>

	beforeEach(() => {
		tabsSend = vi.fn<(tabId: number, msg: unknown, cb: (r: unknown) => void) => void>()
		runtimeSend = vi.fn<(msg: unknown) => Promise<unknown>>()
		vi.stubGlobal('chrome', {
			runtime: {
				sendMessage: runtimeSend,
				lastError: undefined as { message: string } | undefined,
			},
			tabs: { sendMessage: tabsSend },
		})
	})
	afterEach(() => {
		vi.unstubAllGlobals()
		vi.useRealTimers()
	})

	it('sendToTab 超时 → reject', async () => {
		vi.useFakeTimers()
		// chrome.tabs.sendMessage 不回调 → 计时器到点触发 reject
		const p = sendToTab(1, { type: 'CLOSE_TAB' } as ExtensionMessage, 50)
		vi.advanceTimersByTime(50)
		await expect(p).rejects.toThrow(/did not respond within 50ms/)
	})

	it('sendToTab chrome.runtime.lastError 存在 → reject', async () => {
		tabsSend.mockImplementation((_tabId, _msg, cb) => {
			;(chrome.runtime as { lastError?: { message: string } }).lastError = {
				message: 'Receiving end does not exist',
			}
			cb(undefined)
		})
		await expect(sendToTab(1, { type: 'CLOSE_TAB' } as ExtensionMessage, 1000)).rejects.toThrow(
			/Receiving end does not exist/,
		)
	})

	it('sendToTab 正常 → resolve 响应', async () => {
		tabsSend.mockImplementation((_tabId, _msg, cb) => {
			cb({ ok: true, value: 42 })
		})
		await expect(sendToTab(1, { type: 'CLOSE_TAB' } as ExtensionMessage, 1000)).resolves.toEqual({
			ok: true,
			value: 42,
		})
	})

	it('sendProgress → 发 FILL_PROGRESS 且吞错不 throw（fire-and-forget）', async () => {
		runtimeSend.mockRejectedValue(new Error('no receiver'))
		expect(() => sendProgress('progress', { filled: 1 })).not.toThrow()
		await new Promise((r) => setTimeout(r, 0)) // flush 微任务，让被吞的 reject 落定
		expect(runtimeSend).toHaveBeenCalledWith({
			type: 'FILL_PROGRESS',
			action: 'progress',
			payload: { filled: 1 },
		})
	})

	it('sendMessage → 类型化透传 chrome.runtime.sendMessage', async () => {
		runtimeSend.mockResolvedValue({ ok: true })
		const r = await sendMessage({ type: 'SITES_CHANGED' } as ExtensionMessage)
		expect(runtimeSend).toHaveBeenCalledWith({ type: 'SITES_CHANGED' })
		expect(r).toEqual({ ok: true })
	})
})
