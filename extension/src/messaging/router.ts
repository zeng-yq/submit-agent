// src/messaging/router.ts
import type { ExtensionMessage, FillProgressAction, TabCommandAction } from './messages'

export interface MsgCtx {
	sender: chrome.runtime.MessageSender
	tabId?: number
}

type Handler = (msg: any, ctx: MsgCtx) => unknown | Promise<unknown>

/** 类型化发送到 content tab，带超时；与原 FormFillEngine.sendToTab 行为等价 */
export function sendToTab<R>(tabId: number, message: ExtensionMessage, timeoutMs: number): Promise<R> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`Content script did not respond within ${timeoutMs}ms`))
		}, timeoutMs)
		chrome.tabs.sendMessage(tabId, message, (response) => {
			clearTimeout(timer)
			if (chrome.runtime.lastError) {
				reject(new Error(chrome.runtime.lastError.message))
				return
			}
			resolve(response as R)
		})
	})
}

/** 类型化广播 FILL_PROGRESS（fire-and-forget，吞错） */
export function sendProgress(action: FillProgressAction, payload?: unknown): void {
	chrome.runtime.sendMessage({ type: 'FILL_PROGRESS', action, payload }).catch(() => {})
}

/** 类型化广播任意消息 */
export function sendMessage(message: ExtensionMessage): Promise<unknown> {
	return chrome.runtime.sendMessage(message)
}

export class MessageRouter {
	private actionHandlers = new Map<string, Map<string, Handler>>()
	private simpleHandlers = new Map<string, Handler>()

	/** 注册无 action 的 type */
	on<T extends ExtensionMessage['type']>(type: T, handler: Handler): void
	/** 注册带 action 的 type（FILL_PROGRESS / TAB_COMMAND） */
	on<T extends ExtensionMessage['type']>(type: T, action: string, handler: Handler): void
	on(...args: [string, (string | Handler), Handler?]): void {
		if (args.length === 3) {
			const [type, action, handler] = args
			if (!this.actionHandlers.has(type)) this.actionHandlers.set(type, new Map())
			this.actionHandlers.get(type)!.set(action as string, handler!)
		} else {
			this.simpleHandlers.set(args[0], args[1] as Handler)
		}
	}

	/** 是否有 handler 处理该消息（注册覆盖守门用） */
	hasHandler(message: ExtensionMessage): boolean {
		const type = message.type
		const action = (message as { action?: string }).action
		if (action !== undefined && this.actionHandlers.has(type)) {
			return this.actionHandlers.get(type)!.has(action)
		}
		return this.simpleHandlers.has(type)
	}

	/** 分发；返回 true 表示保活通道（异步），undefined 表示同步完成。由 onMessage listener 调用。 */
	dispatch(message: ExtensionMessage, ctx: MsgCtx, sendResponse: (r: unknown) => void): true | undefined {
		const handler = this.findHandler(message)
		if (!handler) return undefined
		try {
			const ret = handler(message, ctx)
			if (ret instanceof Promise) {
				ret.then(
					(response) => sendResponse(response),
					(err) => sendResponse({ error: err instanceof Error ? err.message : String(err) }),
				)
				return true
			}
			sendResponse(ret)
			return undefined
		} catch (err) {
			sendResponse({ error: err instanceof Error ? err.message : String(err) })
			return undefined
		}
	}

	/**
	 * 形状分发（非 switch，无 assertNever）。
	 *
	 * 优先级：消息带 `action` 字段且该 type 已在 actionHandlers 注册 → 按 action 查；
	 * 否则回退 simpleHandlers。注意「按 action 查」若该具体 action 未注册会返回 undefined，
	 * **不会**再回退 simple（action 分支独占该 type 后即旁路 simple）。
	 *
	 * 不变量：同一 type 只能在 actionHandlers 与 simpleHandlers 之一注册，不可混注。
	 * 例如 background 的 `FILL_PROGRESS` 用 simple（2 参）注册以一个 handler 处理所有 action；
	 * 若又给它补一个 action handler，则带 action 的 FILL_PROGRESS 消息会走 action 分支，
	 * 未注册的 action 将查不到 → simple 被旁路 → 消息丢失。新增注册前先确认该 type 现有的注册形态。
	 */
	private findHandler(message: ExtensionMessage): Handler | undefined {
		const type = message.type
		const action = (message as { action?: string }).action
		if (action !== undefined && this.actionHandlers.has(type)) {
			return this.actionHandlers.get(type)!.get(action)
		}
		return this.simpleHandlers.get(type)
	}

	/** 绑定到 chrome.runtime.onMessage，内部统一管 sendResponse + return true */
	attachRuntimeListener(): void {
		chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
			const ctx: MsgCtx = { sender, tabId: sender.tab?.id }
			return this.dispatch(message as ExtensionMessage, ctx, sendResponse)
		})
	}
}
