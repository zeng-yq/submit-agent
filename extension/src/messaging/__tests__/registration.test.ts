// src/messaging/__tests__/registration.test.ts
// 注册覆盖测试：直接调 registerContentHandlers/registerBackgroundHandlers，
// 断言各侧 expected 列表里的 type/action 都有对应 handler（spec §2.4 注册覆盖守门）。
import { describe, it, expect, vi } from 'vitest'
import type { ExtensionMessage, TabCommandAction } from '@/messaging/messages'
import { MessageRouter } from '@/messaging/router'
import { registerContentHandlers } from '@/entrypoints/content'
import { registerBackgroundHandlers } from '@/entrypoints/background'

// WXT 在构建期通过 Vite 插件注入 defineBackground/defineContentScript 全局；
// vitest 不加载该插件，这两个标识函数源码里只是 identity（见 wxt/dist/utils/*.mjs），
// 在此为 globalThis 打桩，使导入 entrypoints/* 时不抛 ReferenceError。
// vi.hoisted 在所有 import 之前执行，保证 stub 先于模块求值生效。
vi.hoisted(() => {
	;(globalThis as { defineBackground?: unknown }).defineBackground = (arg: unknown) => arg
	;(globalThis as { defineContentScript?: unknown }).defineContentScript = (arg: unknown) => arg
})

/* ---------- content 侧：TAB_COMMAND 全 action 覆盖（编译期 + 测试期双重守门） ---------- */
// content 是 TAB_COMMAND 唯一消费者，须注册整个 TabCommandAction 联合。
const CONTENT_EXPECTED_TAB_ACTIONS = [
	'analyze', 'fill', 'submit',
	'annotate', 'annotate-active', 'annotate-clear',
	'scroll-to-first', 'verify-moderation',
] as const
// 编译期覆盖断言（spec §2.4）：EXPECTED 须覆盖全部 TabCommandAction。
// 新增 TabCommandAction 成员但忘加上方列表（或列表里拼错 action 名）→ _MissingContent 非 never
// → 下一行把 true 赋给 `never` 编译报错。这是本 SP 能做到的最强穷尽性守门。
type _MissingContent = Exclude<TabCommandAction, (typeof CONTENT_EXPECTED_TAB_ACTIONS)[number]>
const _contentCoverageCheck: _MissingContent extends never ? true : never = true
void _contentCoverageCheck // 标记为有意保留的编译期断言，避免工具链误报未使用

/* ---------- background 侧：单一职责 type 子集（弱·类型约束守门） ---------- */
// background 只注册其负责的 type 子集（TAB_COMMAND 等由 content 处理，故不含），无法对整个
// ExtensionMessage['type'] 联合做覆盖断言。此处列表元素以 ExtensionMessage['type'] 标注——
// 拼错 type 名（如 'CLOSE_TBA'）即编译报错。但**新增 type 不强制加入此列表**：
// 新增 background 须处理的 type 时，必须手动加入，否则 registration.test 不覆盖（spec §2.4 诚实记录）。
const BACKGROUND_EXPECTED_TYPES: Array<{ type: ExtensionMessage['type']; action?: string }> = [
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

describe('handler 注册覆盖', () => {
	it('content 侧 TAB_COMMAND 全部 action 已注册', () => {
		const router = new MessageRouter()
		registerContentHandlers(router)
		for (const a of CONTENT_EXPECTED_TAB_ACTIONS) {
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
		for (const c of BACKGROUND_EXPECTED_TYPES) {
			expect(
				router.hasHandler(c as ExtensionMessage),
			).toBe(true)
		}
	})
})
