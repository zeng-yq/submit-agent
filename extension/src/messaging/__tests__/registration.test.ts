// src/messaging/__tests__/registration.test.ts
// 注册覆盖测试：直接调 registerContentHandlers/registerBackgroundHandlers，
// 断言 ExtensionMessage 联合里每个 type/action 都有对应 handler（spec §2.4 注册覆盖守门）。
import { describe, it, expect, vi } from 'vitest'

// WXT 在构建期通过 Vite 插件注入 defineBackground/defineContentScript 全局；
// vitest 不加载该插件，这两个标识函数源码里只是 identity（见 wxt/dist/utils/*.mjs），
// 在此为 globalThis 打桩，使导入 entrypoints/* 时不抛 ReferenceError。
// vi.hoisted 在所有 import 之前执行，保证 stub 先于模块求值生效。
vi.hoisted(() => {
	;(globalThis as { defineBackground?: unknown }).defineBackground = (arg: unknown) => arg
	;(globalThis as { defineContentScript?: unknown }).defineContentScript = (arg: unknown) => arg
})

import { MessageRouter } from '@/messaging/router'
import { registerContentHandlers } from '@/entrypoints/content'
import { registerBackgroundHandlers } from '@/entrypoints/background'
import type { ExtensionMessage } from '@/messaging/messages'

describe('handler 注册覆盖', () => {
	it('content 侧 TAB_COMMAND 全部 action 已注册', () => {
		const router = new MessageRouter()
		registerContentHandlers(router)
		const actions = [
			'analyze', 'fill', 'submit',
			'annotate', 'annotate-active', 'annotate-clear',
			'scroll-to-first', 'verify-moderation',
		] as const
		for (const a of actions) {
			expect(
				router.hasHandler({ type: 'TAB_COMMAND', action: a } as ExtensionMessage),
			).toBe(true)
		}
	})

	it('background 侧单一职责 type 已注册', () => {
		const router = new MessageRouter()
		registerBackgroundHandlers(router)
		// FILL_PROGRESS 在 background 为 simple 注册（2 参 router.on），探测时带 action='start'
		// 仅因 FillProgressMessage 类型要求；其余是无 action 的单一职责 type。
		const cases: Array<{ type: ExtensionMessage['type']; action?: string }> = [
			{ type: 'SUBMIT_CONTROL' },
			{ type: 'FETCH_PAGE_CONTENT' },
			{ type: 'FLOAT_BUTTON_TOGGLE' },
			{ type: 'FILL_PROGRESS', action: 'start' },
			{ type: 'SUBMISSION_STATUS_CHANGED' },
			{ type: 'STATUS_UPDATE' },
			{ type: 'CHECK_SITE_MATCH' },
			{ type: 'DELETE_SITE' },
			{ type: 'FLOAT_ADD_SITE' },
			{ type: 'ADD_SITE' },
			{ type: 'CLOSE_TAB' },
		]
		for (const c of cases) {
			expect(
				router.hasHandler(c as ExtensionMessage),
			).toBe(true)
		}
	})
})
