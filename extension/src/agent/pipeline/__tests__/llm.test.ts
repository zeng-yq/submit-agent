// src/agent/pipeline/__tests__/llm.test.ts
import { describe, it, expect, vi } from 'vitest'
import { llmPhase } from '@/agent/pipeline/llm'
import type { FormFillDeps, LlmPhaseInput } from '@/agent/pipeline/types'

const baseInput = (over: Partial<LlmPhaseInput> = {}): LlmPhaseInput => ({
  analysis: { fields: [{ canonical_id: 'f1', label: 'Name', selector: '#f1', form_index: 0 } as any], forms: [{ form_index: 0, filtered: false }], page_info: { title: 't', description: 'd', headings: [] } } as any,
  product: { name: 'P', anchorTexts: 'a\nb', founderName: 'F', founderEmail: 'e', description: 'd', url: 'u', id: 'p1', createdAt: 0, updatedAt: 0 } as any,
  site: { name: 'S', submit_url: 'https://x', category: 'blog_comment', dr: 0 } as any,
  siteType: 'blog_comment',
  ...over,
} as LlmPhaseInput)

describe('llmPhase', () => {
  it('调 callLLM、parse、injectHrefNewline、触发 onLLMFields，返回 fieldValues', async () => {
    const callLLM = vi.fn().mockResolvedValue('{"f1":"Alice"}')
    const onLLMFields = vi.fn()
    const deps = { sendToTabMessage: vi.fn(), sendProgress: vi.fn(), callLLM, verifyNavigation: vi.fn(), log: vi.fn(), onLLMFields } as any
    // pageContent 提供 → 走 blog_comment prompt
    const out = await llmPhase(deps, baseInput({ pageContent: { title: 'pc', description: 'd', headings: [], content_preview: '' } as any }))
    expect(callLLM).toHaveBeenCalledOnce()
    expect(callLLM.mock.calls[0][0]).toMatchObject({ temperature: 0.7, jsonMode: true, maxTokens: 2048 })
    expect(out).toEqual({ f1: expect.any(String) })
    expect(onLLMFields).toHaveBeenCalledOnce()
  })

  it('siteType=directory_submit → temperature 0.3 + directory prompt', async () => {
    const callLLM = vi.fn().mockResolvedValue('{"f1":"v"}')
    const deps = { sendToTabMessage: vi.fn(), sendProgress: vi.fn(), callLLM, verifyNavigation: vi.fn(), log: vi.fn(), onLLMFields: vi.fn() } as any
    await llmPhase(deps, baseInput({ siteType: 'directory_submit' }))
    expect(callLLM.mock.calls[0][0].temperature).toBe(0.3)
  })

  it('LLM 无值 → 不触发 onLLMFields', async () => {
    const callLLM = vi.fn().mockResolvedValue('{}')
    const onLLMFields = vi.fn()
    const deps = { sendToTabMessage: vi.fn(), sendProgress: vi.fn(), callLLM, verifyNavigation: vi.fn(), log: vi.fn(), onLLMFields } as any
    const out = await llmPhase(deps, baseInput())
    expect(out).toEqual({})
    expect(onLLMFields).not.toHaveBeenCalled()
  })
})
