// src/agent/pipeline/__tests__/fill.test.ts
import { describe, it, expect, vi } from 'vitest'
import { fillPhase } from '@/agent/pipeline/fill'
import type { FormFillDeps, FillPhaseInput } from '@/agent/pipeline/types'

describe('fillPhase', () => {
	it('逐字段 annotate-active + fill，累加 filled/failed', async () => {
		const sendToTabMessage = vi.fn(async (_msg: any, _t: number) => ({ ok: true, filled: 1, failed: 0 }))
		const deps = { sendToTabMessage, sendProgress: vi.fn(), callLLM: vi.fn(), verifyNavigation: vi.fn(), log: vi.fn(), onLLMFields: vi.fn() } as any
		const input: FillPhaseInput = {
			fieldsToFill: [
				{ canonical_id: 'f1', value: 'v1', selector: '#f1' },
				{ canonical_id: 'f2', value: 'v2', selector: '#f2' },
			],
		}
		const out = await fillPhase(deps, input)
		expect(out).toEqual({ filled: 2, failed: 0 })
		// 每字段 2 次（annotate-active + fill）= 4 次
		expect(sendToTabMessage).toHaveBeenCalledTimes(4)
	})

	it('fill 返回 failed 计入 failedCount', async () => {
		const sendToTabMessage = vi.fn(async (_msg: any, _t: number) => ({ ok: true, filled: 0, failed: 1 }))
		const deps = { sendToTabMessage, sendProgress: vi.fn(), callLLM: vi.fn(), verifyNavigation: vi.fn(), log: vi.fn(), onLLMFields: vi.fn() } as any
		const out = await fillPhase(deps, { fieldsToFill: [{ canonical_id: 'f1', value: 'v', selector: '#f1' }] })
		expect(out).toEqual({ filled: 0, failed: 1 })
	})
})
