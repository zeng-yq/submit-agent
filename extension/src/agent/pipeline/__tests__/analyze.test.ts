// src/agent/pipeline/__tests__/analyze.test.ts
import { describe, it, expect, vi } from 'vitest'
import { analyzePhase } from '@/agent/pipeline/analyze'
import type { FormFillDeps } from '@/agent/pipeline/types'
import type { AnalyzeResponse } from '@/messaging/messages'

const mkDeps = (analyzeResp: AnalyzeResponse): { deps: FormFillDeps; sendToTabMessage: ReturnType<typeof vi.fn> } => {
  const sendToTabMessage = vi.fn(async () => analyzeResp)
  const deps: FormFillDeps = {
    // vi.fn 返回固定 AnalyzeResponse，无法自动满足 <R>(...)=>Promise<R> 泛型签名；测试侧 cast 不影响运行期行为
    sendToTabMessage: sendToTabMessage as unknown as FormFillDeps['sendToTabMessage'],
    sendProgress: vi.fn(),
    callLLM: vi.fn(),
    verifyNavigation: vi.fn(),
    log: vi.fn(),
    onLLMFields: vi.fn(),
  }
  return { deps, sendToTabMessage }
}

describe('analyzePhase', () => {
  it('发 analyze 并返回 analysis+pageContent；字段非空时触发 progress/annotate/scroll', async () => {
    const resp: AnalyzeResponse = {
      ok: true,
      analysis: { fields: [{ canonical_id: 'f1', selector: '#f1' } as any], forms: [], page_info: { title: 't', description: 'd' } } as any,
      pageContent: { title: 'pc' } as any,
    }
    const { deps, sendToTabMessage } = mkDeps(resp)
    const out = await analyzePhase(deps, { siteType: 'blog_comment' })
    expect(out.analysis.fields).toHaveLength(1)
    expect(out.pageContent).toBeDefined()
    // analyze + annotate + scroll-to-first = 3 次 sendToTabMessage
    expect(sendToTabMessage).toHaveBeenCalledTimes(3)
    expect(deps.sendProgress).toHaveBeenCalledWith('progress')
  })

  it('字段为空时不触发 progress/annotate/scroll（仅 analyze 一次）', async () => {
    const resp: AnalyzeResponse = { ok: true, analysis: { fields: [], forms: [], page_info: { title: '', description: '' } } as any }
    const { deps, sendToTabMessage } = mkDeps(resp)
    await analyzePhase(deps, { siteType: 'directory_submit' })
    expect(sendToTabMessage).toHaveBeenCalledTimes(1)
    expect(deps.sendProgress).not.toHaveBeenCalled()
  })

  it('analyze 返回 ok:false → 抛 Form analysis failed', async () => {
    const { deps } = mkDeps({ ok: false, error: 'boom' } as any)
    await expect(analyzePhase(deps, { siteType: 'blog_comment' })).rejects.toThrow('Form analysis failed')
  })
})
