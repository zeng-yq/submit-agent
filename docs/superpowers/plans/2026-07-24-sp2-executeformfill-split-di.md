# SP-2 executeFormFill 拆分 + 依赖注入 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 326 行的 `executeFormFill` 拆为 `src/agent/pipeline/` 下 5 个可测 phase（analyze/llm/match/fill，submit 复用 runSubmitAndVerify），通过 `FormFillDeps` 注入副作用依赖，使整条管道可单测。

**Architecture:** 新增 `pipeline/` 模块（L4 领域层）。每个 phase 是 `(deps, input) => output`，副作用端口（IPC/LLM/进度/验证/日志）经 `FormFillDeps` 注入，纯逻辑（字段匹配）无 deps。`executeFormFill(config, deps?)` 瘦身为 L2 编排：`deps ?? buildRealDeps(config)` 组装真实 ports、顺序调 phase、管 try/catch/status。调用方零改动。镜像同文件 `runSubmitAndVerify`/`SubmitFlowDeps` 的成功 DI 范式。

**Tech Stack:** TypeScript（strict, strictNullChecks）、WXT、Vitest + jsdom。别名 `@/*` → `src/*`。

## Global Constraints

- 测试命令：`pnpm test`（基线 **318 测试 / 20 文件全绿**，SP-1 后）。每个任务结束必须全绿。
- 类型检查：`pnpm exec tsc --noEmit`（基线约 26 错）净零新增错误。
- **行为等价（硬约束）**：phase 是「搬运」不是「重写」。除明确标注外，逻辑、日志文案、时序常量（analyze 10s / fill 10s / 高亮 150ms / submit 20s / annotate 3s）逐字保留。
- **调用方零改动**：`useFormFillEngine` 调 `executeFormFill(config)` 不变（DI 通过可选 `deps?` 暴露给测试）。
- **不动**：`runSubmitAndVerify`/`SubmitFlowDeps`/`resolveLostSignal`、`fuzzyMatchField`/`matchesField`/`tokenize`/`tokenSimilarity`、`prompts/*`、`llm-utils.ts`、`verify-after-navigation.ts`、SP-1 的 `messaging/`。
- 提交规范：中文 conventional commit（如 `refactor(pipeline): ...`）。

---

## File Structure

| 文件 | 职责 | 任务 |
|---|---|---|
| `src/agent/pipeline/types.ts` | `FormFillDeps` 接口 + phase I/O 类型 + `FieldsToFill`/`MatchResult` | T1 |
| `src/agent/pipeline/match.ts` | `matchFields(analysis, fieldValues)` 纯函数（精确+fuzzy） | T1 |
| `src/agent/pipeline/analyze.ts` | `analyzePhase(deps, input)` | T2 |
| `src/agent/pipeline/llm.ts` | `llmPhase(deps, input)`（prompt+callLLM+parse+injectHrefNewline+onLLMFields） | T3 |
| `src/agent/pipeline/fill.ts` | `fillPhase(deps, input)`（annotate-active+fill 循环） | T4 |
| `src/agent/FormFillEngine.ts` | `executeFormFill(config, deps?)` 瘦身为编排 + `buildRealDeps` | T2-T5 |
| `src/agent/pipeline/__tests__/{match,analyze,llm,fill}.test.ts` | 各 phase 单测 | T1-T4 |
| `src/__tests__/FormFillEngine.test.ts` | 补 executeFormFill 端到端测试 | T5 |

---

## Task 1: `pipeline/types.ts` + 纯函数 `matchFields` + 单测

**Files:**
- Create: `src/agent/pipeline/types.ts`
- Create: `src/agent/pipeline/match.ts`
- Create: `src/agent/pipeline/__tests__/match.test.ts`
- Modify: `src/agent/FormFillEngine.ts`（Step 4a 匹配段 329-366 改调 `matchFields`）

**Interfaces:**
- Produces: `FormFillDeps`（types.ts，本任务定义但暂不全用）、`FieldsToFill`、`MatchResult`、`matchFields()`。后续任务消费这些类型。

- [ ] **Step 1: 写 `pipeline/types.ts`**

```ts
// src/agent/pipeline/types.ts
import type { ExtensionMessage, FillProgressAction, ProgressPayload } from '@/messaging/messages'
import type { LLMSettings } from '@/lib/types'
import type { ProductProfile, SiteData } from '@/lib/types'
import type { FormAnalysisResult } from '@/agent/FormAnalyzer'
import type { PageContent } from '@/agent/PageContentExtractor'
import type { FieldValueMap, LogLevel, LLMFieldData, SiteType } from '@/agent/types'
import type { ModerationVerdict } from '@/agent/verify-after-navigation'

/** 已解析的待填字段（canonical_id → value + selector） */
export type FieldsToFill = Array<{ canonical_id: string; value: string; selector: string }>

/** 注入到各 phase 的副作用端口（镜像 SubmitFlowDeps） */
export interface FormFillDeps {
  /** 发消息到 content tab（已绑定 tabId） */
  sendToTabMessage: <R>(msg: ExtensionMessage, timeoutMs: number) => Promise<R>
  /** 广播 UI 进度信号 */
  sendProgress: (action: FillProgressAction, payload?: ProgressPayload) => void
  /** 调 LLM（已绑定 llmConfig） */
  callLLM: (opts: {
    systemPrompt: string
    userPrompt: string
    temperature: number
    maxTokens: number
    signal?: AbortSignal
    jsonMode: boolean
  }) => Promise<string>
  /** 跨页面验证（供 submit phase） */
  verifyNavigation: () => Promise<ModerationVerdict>
  /** 日志 */
  log: (level: LogLevel, phase: 'analyze' | 'llm' | 'fill' | 'system', message: string, data?: unknown, url?: string) => void
  /** LLM 字段值展示回调（可选） */
  onLLMFields?: (data: LLMFieldData) => void
}

export interface AnalyzePhaseInput { siteType: SiteType }
export interface AnalyzePhaseOutput { analysis: FormAnalysisResult; pageContent?: PageContent }

export interface LlmPhaseInput {
  analysis: FormAnalysisResult
  pageContent?: PageContent
  product: ProductProfile
  site: SiteData
  siteType: SiteType
  signal?: AbortSignal
}

export interface FillPhaseInput { fieldsToFill: FieldsToFill }
export interface FillPhaseOutput { filled: number; failed: number }

export interface MatchResult {
  fieldsToFill: FieldsToFill
  skipped: number
  matchedViaFuzzy: boolean
}
```

> 注：`log` 的 `phase` 参数收窄为 `'analyze'|'llm'|'fill'|'system'`（与 `LogPhase` 一致，`LogPhase` 见 `agent/types.ts:67`）。

- [ ] **Step 2: 写失败的 `match.test.ts`**

```ts
// src/agent/pipeline/__tests__/match.test.ts
import { describe, it, expect } from 'vitest'
import { matchFields } from '@/agent/pipeline/match'
import type { FormAnalysisResult } from '@/agent/FormAnalyzer'

const field = (over: Partial<FormAnalysisResult['fields'][number]> = {}): FormAnalysisResult['fields'][number] => ({
  canonical_id: 'f1', name: 'name', id: 'name', label: 'Name', placeholder: '',
  type: 'input', effective_type: 'author', inferred_purpose: 'author',
  required: false, form_index: 0, selector: '#name', ...over,
} as FormAnalysisResult['fields'][number])

const analysis = (fields: FormAnalysisResult['fields'], forms: any[] = [{ form_index: 0, filtered: false }]): FormAnalysisResult =>
  ({ fields, forms, page_info: { title: '', description: '' } }) as FormAnalysisResult

describe('matchFields', () => {
  it('精确匹配：fieldValues 命中 canonical_id', () => {
    const a = analysis([field({ canonical_id: 'f1' })])
    const r = matchFields(a, { f1: 'Alice' })
    expect(r.fieldsToFill).toHaveLength(1)
    expect(r.fieldsToFill[0]).toMatchObject({ canonical_id: 'f1', value: 'Alice', selector: '#name' })
    expect(r.matchedViaFuzzy).toBe(false)
    expect(r.skipped).toBe(0)
  })

  it('精确匹配忽略空字符串值', () => {
    const a = analysis([field({ canonical_id: 'f1' })])
    const r = matchFields(a, { f1: '' })
    expect(r.fieldsToFill).toHaveLength(0)
  })

  it('精确为空 + 有值 → 回退 fuzzy 命中', () => {
    const a = analysis([field({ canonical_id: 'f1', label: 'Email' })])
    const r = matchFields(a, { user_email: 'a@b.c' })  // tokenSimilarity(email, user_email) 命中
    expect(r.fieldsToFill).toHaveLength(1)
    expect(r.matchedViaFuzzy).toBe(true)
  })

  it('精确为空 + 有值 + fuzzy 也不命中 → 空，matchedViaFuzzy 仍 true（进了 fuzzy 分支）', () => {
    const a = analysis([field({ canonical_id: 'f1', label: 'Name' })])
    const r = matchFields(a, { xyz_unrelated: 'v' })
    expect(r.fieldsToFill).toHaveLength(0)
    expect(r.matchedViaFuzzy).toBe(true)
  })

  it('无任何值（valueCount===0）→ 不进 fuzzy，空结果', () => {
    const a = analysis([field({ canonical_id: 'f1' })])
    const r = matchFields(a, {})
    expect(r.fieldsToFill).toHaveLength(0)
    expect(r.matchedViaFuzzy).toBe(false)
  })

  it('skipped = 总字段 - 命中数', () => {
    const a = analysis([field({ canonical_id: 'f1' }), field({ canonical_id: 'f2', selector: '#f2' })])
    const r = matchFields(a, { f1: 'v' })
    expect(r.skipped).toBe(1)
  })
})
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `pnpm test -- src/agent/pipeline/__tests__/match.test.ts`
Expected: FAIL（`Cannot find module '@/agent/pipeline/match'`）

- [ ] **Step 4: 写 `pipeline/match.ts`（搬运 Step 4a 现状逻辑）**

```ts
// src/agent/pipeline/match.ts
import type { FormAnalysisResult } from '@/agent/FormAnalyzer'
import type { FieldValueMap } from '@/agent/types'
import { fuzzyMatchField } from '@/agent/FormFillEngine'
import type { FieldsToFill, MatchResult } from './types'

/**
 * 把 LLM 返回的 fieldValues 映射到表单字段（精确 canonical_id → 失败回退 fuzzy）。
 * 纯函数，无副作用。搬运自原 executeFormFill Step 4a（FormFillEngine.ts:329-366）。
 */
export function matchFields(analysis: FormAnalysisResult, fieldValues: FieldValueMap): MatchResult {
  // 1. 精确匹配
  let fieldsToFill: FieldsToFill = analysis.fields
    .filter((f) => fieldValues[f.canonical_id] !== undefined && fieldValues[f.canonical_id] !== '')
    .map((f) => ({
      canonical_id: f.canonical_id,
      value: fieldValues[f.canonical_id] as string,
      selector: f.selector,
    }))

  const valueCount = Object.keys(fieldValues).length

  // 2. 精确为空且有值 → 回退 fuzzy
  let matchedViaFuzzy = false
  if (fieldsToFill.length === 0 && valueCount > 0) {
    matchedViaFuzzy = true
    const usedCanonicalIds = new Set<string>()
    fieldsToFill = []
    for (const [llmKey, llmValue] of Object.entries(fieldValues)) {
      if (typeof llmValue !== 'string' || llmValue === '') continue
      // 仅一个未过滤表单时传其 index 做同表单优先；否则跳过 formIndex
      const targetFormIndex = analysis.forms.filter(f => !f.filtered).length === 1
        ? analysis.forms.find(f => !f.filtered)!.form_index
        : undefined
      const matched = fuzzyMatchField(llmKey, analysis.fields, usedCanonicalIds, targetFormIndex)
      if (matched) {
        usedCanonicalIds.add(matched.canonical_id)
        fieldsToFill.push({ canonical_id: matched.canonical_id, value: llmValue, selector: matched.selector })
      }
    }
  }

  return {
    fieldsToFill,
    skipped: analysis.fields.length - fieldsToFill.length,
    matchedViaFuzzy,
  }
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `pnpm test -- src/agent/pipeline/__tests__/match.test.ts`
Expected: PASS（6 tests）

- [ ] **Step 6: `executeFormFill` Step 4a 改调 `matchFields`**

把 `src/agent/FormFillEngine.ts` 的 329-366 行（精确匹配 + fuzzy 回退整段）替换为：

```ts
		// Map LLM field values → form fields (exact match → fuzzy fallback). Pure.
		const { fieldsToFill, matchedViaFuzzy } = matchFields(analysis, fieldValues)
		if (matchedViaFuzzy && fieldsToFill.length > 0) {
			log('info', 'llm', `模糊匹配成功: ${fieldsToFill.length} 个字段`, {
				matchedFields: fieldsToFill.map(f => f.canonical_id),
			})
		}
```

并在文件顶部加 import：`import { matchFields } from './pipeline/match'`。

> `fieldsToFill` 现在是 `const`（matchFields 返回）。后续 368 行起的 `if (fieldsToFill.length === 0)` 错误分支、Step 4b 填充循环引用 `fieldsToFill` 不变（仍是数组）。`valueCount` 在错误分支仍需用——保留现状 369 行 `valueCount` 引用：因 matchFields 内部化了 valueCount，此处需在 executeFormFill 重新可见。把 368 行错误分支前加 `const valueCount = Object.keys(fieldValues).length`（若尚未在作用域）。核查：原代码 `valueCount` 定义在 310 行（Step 3），仍在作用域内——保留即可，无需重复定义。

- [ ] **Step 7: tsc + 全量测试**

Run: `pnpm exec tsc --noEmit` → 净零新增。Run: `pnpm test` → 318 + 6 = 324 全绿。

- [ ] **Step 8: 提交**

```bash
git add src/agent/pipeline/ src/agent/FormFillEngine.ts
git commit -m "refactor(pipeline): 抽出纯函数 matchFields + FormFillDeps 类型定义"
```

---

## Task 2: `analyzePhase` + 引入 `deps?` / `buildRealDeps`

**Files:**
- Create: `src/agent/pipeline/analyze.ts`
- Create: `src/agent/pipeline/__tests__/analyze.test.ts`
- Modify: `src/agent/FormFillEngine.ts`（加 `deps?` 参数 + `buildRealDeps`；Step 1 改调 `analyzePhase`）

**Interfaces:**
- Consumes: `FormFillDeps`、`AnalyzePhaseInput/Output`（T1）、SP-1 的 `sendToTab`/`sendProgress`（router）。
- Produces: `analyzePhase(deps, input)`、`executeFormFill(config, deps?)`、`buildRealDeps(config)`。

- [ ] **Step 1: 写 `pipeline/analyze.ts`（搬运 Step 1：FormFillEngine.ts:206-266）**

```ts
// src/agent/analyze.ts → 实际路径 src/agent/pipeline/analyze.ts
import type { ExtensionMessage } from '@/messaging/messages'
import type { AnalyzeResponse } from '@/messaging/messages'
import type { FormFillDeps, AnalyzePhaseInput, AnalyzePhaseOutput } from './types'

const ANALYZE_TIMEOUT_MS = 10_000

/**
 * 分析表单：发 analyze → 取 analysis+pageContent；字段非空时广播 progress + annotate + scroll-to-first。
 * 搬运自原 executeFormFill Step 1（FormFillEngine.ts:206-266）。
 * fields.length===0 时不触发 progress/annotate/scroll（与现状一致——现状这些在空字段早退之后）。
 */
export async function analyzePhase(deps: FormFillDeps, input: AnalyzePhaseInput): Promise<AnalyzePhaseOutput> {
  const analyzeMsg: ExtensionMessage = { type: 'TAB_COMMAND', action: 'analyze', payload: { siteType: input.siteType } }
  const analyzeResponse = await deps.sendToTabMessage<AnalyzeResponse>(analyzeMsg, ANALYZE_TIMEOUT_MS)

  if (!analyzeResponse?.ok || !analyzeResponse.analysis) {
    throw new Error('Form analysis failed')
  }

  const { analysis, pageContent } = analyzeResponse

  deps.log('success', 'analyze', `表单分析完成: 发现 ${analysis.fields.length} 个字段`, {
    fields: analysis.fields.map(f => ({
      id: f.canonical_id,
      type: f.effective_type || f.type,
      label: f.label || f.inferred_purpose || '(unknown)',
      placeholder: f.placeholder || undefined,
      required: f.required,
    })),
    pageInfo: {
      title: analysis.page_info.title,
      description: analysis.page_info.description?.slice(0, 200),
    },
  })

  // 字段非空才触发后续 UX 副作用（与现状空字段早退一致）
  if (analysis.fields.length > 0) {
    deps.sendProgress('progress')
    await deps.sendToTabMessage(
      { type: 'TAB_COMMAND', action: 'annotate', payload: { fields: analysis.fields.map(f => ({ selector: f.selector })) } },
      5000,
    ).catch(() => {})
    await deps.sendToTabMessage(
      { type: 'TAB_COMMAND', action: 'scroll-to-first', payload: { fields: analysis.fields.map(f => ({ selector: f.selector })) } },
      5000,
    ).catch(() => {})
  }

  return { analysis, pageContent }
}
```

- [ ] **Step 2: 写 `analyze.test.ts`**

```ts
// src/agent/pipeline/__tests__/analyze.test.ts
import { describe, it, expect, vi } from 'vitest'
import { analyzePhase } from '@/agent/pipeline/analyze'
import type { FormFillDeps } from '@/agent/pipeline/types'
import type { AnalyzeResponse } from '@/messaging/messages'

const mkDeps = (analyzeResp: AnalyzeResponse): { deps: FormFillDeps; sendToTabMessage: ReturnType<typeof vi.fn> } => {
  const sendToTabMessage = vi.fn(async () => analyzeResp)
  const deps: FormFillDeps = {
    sendToTabMessage,
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
```

- [ ] **Step 3: 跑测试确认通过**

Run: `pnpm test -- src/agent/pipeline/__tests__/analyze.test.ts` → PASS（3 tests）

- [ ] **Step 4: `executeFormFill` 引入 `deps?` + `buildRealDeps`，Step 1 改调 `analyzePhase`**

修改 `src/agent/FormFillEngine.ts`：

(a) `executeFormFill` 签名改为 `export async function executeFormFill(config: FormFillEngineConfig, deps?: FormFillDeps): Promise<FillResult>`。函数体开头把 `const d = deps ?? buildRealDeps(config)`，并把内部 `log` 闭包改为委托 `d.log`（或保留本地 `log` 闭包但同时赋给 deps——见下）。

(b) 在文件内（executeFormFill 之外）新增：

```ts
/** 从 config 构造真实 FormFillDeps（生产路径；测试可注入 mock） */
function buildRealDeps(config: FormFillEngineConfig): FormFillDeps {
  const { tabId, llmConfig, callbacks } = config
  let logId = 0
  return {
    sendToTabMessage: (msg, timeoutMs) => sendToTab<unknown>(tabId, msg, timeoutMs),
    sendProgress,
    callLLM: (opts) => callLLM({ config: llmConfig, ...opts }),
    verifyNavigation: () => verifyAfterNavigation(tabId, {
      getTabUrl: async (id) => {
        try { const tab = await chrome.tabs.get(id); return tab.url ?? '' } catch { return '' }
      },
      sendVerify: (id) => sendToTab<VerifyModerationResponse>(id, { type: 'TAB_COMMAND', action: 'verify-moderation' }, 2000),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    }),
    log: (level, phase, message, data, url) => {
      if (callbacks.onLog) callbacks.onLog({ id: ++logId, timestamp: Date.now(), level, phase, message, data, url })
    },
    onLLMFields: callbacks.onLLMFields,
  }
}
```

> `sendToTabMessage` 返回 `Promise<unknown>` 但调用方用 `sendToTabMessage<AnalyzeResponse>` 收窄——`sendToTab<unknown>` 的返回 `Promise<unknown>` 赋给 `<R>(...)=>Promise<R>` 签名时需确认 TS 接受。若 tsc 报错，改为 `sendToTabMessage: ((msg: ExtensionMessage, timeoutMs: number) => sendToTab<unknown>(tabId, msg, timeoutMs)) as FormFillDeps['sendToTabMessage']`。

(c) 把 `let logId = 0; const log = ...`（198-203 行）从 executeFormFill 移除（已进 buildRealDeps），executeFormFill 内改用 `d.log`。所有原 `log(...)` 调用改为 `d.log(...)`。注意：现状 executeFormFill 内大量 `log(...)` 调用——本任务把 Step 1 区段的 `log` 改 `d.log`；Step 2-5 区段的 `log` 可暂保留为本地别名 `const log = d.log.bind(d)`（在函数开头加一行），最小改动。

(d) Step 1（206-266 行，analyze+空字段检查+progress+annotate+scroll）替换为：

```ts
		// Step 1: Analyze form
		onStatusChange('analyzing')
		d.log('info', 'system', `开始填写: ${site.name} (tab ${tabId})`, undefined, site.submit_url ?? undefined)
		d.log('info', 'analyze', '正在发送表单分析请求...')

		const { analysis, pageContent } = await analyzePhase(d, { siteType })

		if (analysis.fields.length === 0) {
			const msg = '页面未发现可填写的表单字段'
			d.log('error', 'analyze', msg)
			onStatusChange('error')
			onError(new Error(msg))
			return { filled: 0, skipped: 0, failed: 0, notes: 'No form fields found on this page.' }
		}
```

> 顶部加 `import { analyzePhase } from './pipeline/analyze'`、`import type { FormFillDeps } from './pipeline/types'`。

- [ ] **Step 5: tsc + 全量测试**

Run: `pnpm exec tsc --noEmit` → 净零新增。Run: `pnpm test` → 324 + 3 = 327 全绿（既有 FormFillEngine.test.ts 的 fuzzyMatchField 仍过）。

- [ ] **Step 6: 提交**

```bash
git add src/agent/pipeline/analyze.ts src/agent/pipeline/__tests__/analyze.test.ts src/agent/FormFillEngine.ts
git commit -m "refactor(pipeline): 抽出 analyzePhase + executeFormFill 引入 FormFillDeps/buildRealDeps"
```

---

## Task 3: `llmPhase`（Step 2+3）

**Files:**
- Create: `src/agent/pipeline/llm.ts`
- Create: `src/agent/pipeline/__tests__/llm.test.ts`
- Modify: `src/agent/FormFillEngine.ts`（Step 2+3 改调 `llmPhase`）

**Interfaces:**
- Consumes: `FormFillDeps`、`LlmPhaseInput`（T1）、`buildProductContext`/`pickAnchorText`/`pickFounderName`/`buildBlogCommentPrompt`/`buildDirectorySubmitPrompt`/`callLLM`/`parseLLMJson`/`injectHrefNewline`。
- Produces: `llmPhase(deps, input) => Promise<FieldValueMap>`。

- [ ] **Step 1: 写 `pipeline/llm.ts`（搬运 Step 2+3：FormFillEngine.ts:268-327）**

```ts
// src/agent/pipeline/llm.ts
import type { FieldValueMap } from '@/agent/types'
import { callLLM, parseLLMJson, injectHrefNewline } from '@/agent/llm-utils'
import { buildProductContext, pickAnchorText, pickFounderName } from '@/agent/prompts/product-context'
import { buildBlogCommentPrompt } from '@/agent/prompts/blog-comment-prompt'
import { buildDirectorySubmitPrompt } from '@/agent/prompts/directory-submit-prompt'
import type { LLMFieldValue } from '@/agent/types'
import type { FormFillDeps, LlmPhaseInput } from './types'

/**
 * 建 prompt → callLLM → parse → injectHrefNewline → 触发 onLLMFields。返回 fieldValues。
 * 搬运自原 executeFormFill Step 2+3（FormFillEngine.ts:268-327）。
 */
export async function llmPhase(deps: FormFillDeps, input: LlmPhaseInput): Promise<FieldValueMap> {
  const { analysis, pageContent, product, site, siteType, signal } = input

  // Step 2: build prompt
  const selectedAnchor = pickAnchorText(product)
  const selectedFounderName = pickFounderName(product)
  const productContext = buildProductContext(product, selectedAnchor, selectedFounderName)
  let systemPrompt: string
  if (siteType === 'blog_comment' && pageContent) {
    systemPrompt = buildBlogCommentPrompt({ productContext, pageContent, fields: analysis.fields, forms: analysis.forms })
  } else {
    systemPrompt = buildDirectorySubmitPrompt({ productContext, pageInfo: analysis.page_info, fields: analysis.fields, forms: analysis.forms })
  }
  const userPrompt = siteType === 'blog_comment'
    ? `Fill the comment form on ${site.name}. Page URL: ${site.submit_url || 'current page'}.`
    : `Fill the submission form on ${site.name}. Submit URL: ${site.submit_url || 'current page'}.`

  const promptType = siteType === 'blog_comment' ? '博客评论' : '目录提交'
  deps.log('info', 'llm', `正在调用 LLM (${promptType})...`, {
    systemPromptLength: systemPrompt.length,
    userPromptLength: userPrompt.length,
    systemPrompt,
    userPrompt,
    fieldCount: analysis.fields.length,
  })

  const rawResponse = await deps.callLLM({
    systemPrompt,
    userPrompt,
    temperature: siteType === 'blog_comment' ? 0.7 : 0.3,
    maxTokens: 2048,
    signal,
    jsonMode: true,
  })

  // Step 3: parse
  const fieldValues = parseLLMJson(rawResponse) as FieldValueMap
  for (const key of Object.keys(fieldValues)) {
    fieldValues[key] = injectHrefNewline(fieldValues[key])
  }
  const valueCount = Object.keys(fieldValues).length
  deps.log('success', 'llm', `LLM 响应已解析: ${valueCount} 个字段值`, { fieldValues, rawResponse, responseLength: rawResponse.length })

  if (deps.onLLMFields && valueCount > 0) {
    const fieldLabelMap = new Map(analysis.fields.map(f => [f.canonical_id, f.label || f.inferred_purpose || f.name || f.canonical_id]))
    const llmFields: LLMFieldValue[] = Object.entries(fieldValues).map(([key, value]) => ({
      label: fieldLabelMap.get(key) || key,
      value: typeof value === 'string' ? value : String(value),
    }))
    if (llmFields.length > 0) deps.onLLMFields({ fields: llmFields })
  }

  return fieldValues
}
```

> 注：原 285 行 log 含 `model: llmConfig.model`——llmConfig 在 deps 内绑定，phase 拿不到。去掉该字段（或改为不含 model；属日志字段微调，不影响业务）。在 report 注明。

- [ ] **Step 2: 写 `llm.test.ts`**

```ts
// src/agent/pipeline/__tests__/llm.test.ts
import { describe, it, expect, vi } from 'vitest'
import { llmPhase } from '@/agent/pipeline/llm'
import type { FormFillDeps, LlmPhaseInput } from '@/agent/pipeline/types'

const baseInput = (over: Partial<LlmPhaseInput> = {}): LlmPhaseInput => ({
  analysis: { fields: [{ canonical_id: 'f1', label: 'Name', selector: '#f1', form_index: 0 } as any], forms: [{ form_index: 0, filtered: false }], page_info: { title: 't', description: 'd' } } as any,
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
    const out = await llmPhase(deps, baseInput({ pageContent: { title: 'pc' } as any }))
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
```

- [ ] **Step 3: 跑测试确认通过**

Run: `pnpm test -- src/agent/pipeline/__tests__/llm.test.ts` → PASS（3 tests）

- [ ] **Step 4: `executeFormFill` Step 2+3 改调 `llmPhase`**

把 `src/agent/FormFillEngine.ts` 的 268-327 行（pickAnchor 到 onLLMFields 整段）替换为：

```ts
		// Step 2+3: build prompt + callLLM + parse
		const fieldValues = await llmPhase(d, { analysis, pageContent, product, site, siteType, signal })
		const valueCount = Object.keys(fieldValues).length
```

> `valueCount` 此处重新定义（matchFields 内部用过同名但不冲突——本作用域）。顶部加 `import { llmPhase } from './pipeline/llm'`。Step 4a 的 `matchFields` 已在 T1 接入，其后的错误分支引用 `valueCount` 仍有效。

- [ ] **Step 5: tsc + 全量测试**

Run: `pnpm exec tsc --noEmit` → 净零新增。Run: `pnpm test` → 327 + 3 = 330 全绿。

- [ ] **Step 6: 提交**

```bash
git add src/agent/pipeline/llm.ts src/agent/pipeline/__tests__/llm.test.ts src/agent/FormFillEngine.ts
git commit -m "refactor(pipeline): 抽出 llmPhase（prompt+callLLM+parse）"
```

---

## Task 4: `fillPhase`（Step 4b）

**Files:**
- Create: `src/agent/pipeline/fill.ts`
- Create: `src/agent/pipeline/__tests__/fill.test.ts`
- Modify: `src/agent/FormFillEngine.ts`（Step 4b 改调 `fillPhase`）

**Interfaces:**
- Consumes: `FormFillDeps`、`FillPhaseInput/Output`（T1）、SP-1 `sendToTab`。
- Produces: `fillPhase(deps, input) => Promise<{filled, failed}>`。

- [ ] **Step 1: 写 `pipeline/fill.ts`（搬运 Step 4b：FormFillEngine.ts:386-427）**

```ts
// src/agent/pipeline/fill.ts
import type { FillResponse } from '@/messaging/messages'
import type { FormFillDeps, FillPhaseInput, FillPhaseOutput } from './types'

const FILL_TIMEOUT_MS = 10_000

/**
 * 逐字段高亮+填写：annotate-active → sleep 150ms → fill，累加 filled/failed。
 * 搬运自原 executeFormFill Step 4b（FormFillEngine.ts:386-427）。
 */
export async function fillPhase(deps: FormFillDeps, input: FillPhaseInput): Promise<FillPhaseOutput> {
  const { fieldsToFill } = input

  deps.log('info', 'fill', `正在填写 ${fieldsToFill.length} 个字段...`, {
    fields: fieldsToFill.map(f => ({ id: f.canonical_id, value: f.value.slice(0, 50) })),
  })

  let filledCount = 0
  let failedCount = 0

  for (let i = 0; i < fieldsToFill.length; i++) {
    const field = fieldsToFill[i]

    await deps.sendToTabMessage(
      { type: 'TAB_COMMAND', action: 'annotate-active', payload: { index: i } },
      3000,
    ).catch(() => {})

    await new Promise(r => setTimeout(r, 150))

    const fillResponse = await deps.sendToTabMessage<FillResponse>(
      { type: 'TAB_COMMAND', action: 'fill', payload: { fields: [field] } },
      FILL_TIMEOUT_MS,
    )

    filledCount += fillResponse?.filled ?? 0
    failedCount += fillResponse?.failed ?? 0

    deps.log('info', 'fill', `字段 ${field.canonical_id}: ${fillResponse?.filled ? '成功' : '失败'}`, {
      canonicalId: field.canonical_id,
      value: field.value.slice(0, 50),
    })
  }

  if (failedCount > 0) {
    deps.log('warning', 'fill', `填写完成: ${filledCount} 成功, ${failedCount} 失败`)
  } else {
    deps.log('success', 'fill', `填写完成: ${filledCount} 个字段已成功填写`)
  }

  return { filled: filledCount, failed: failedCount }
}
```

> 注：原 log phase 类型 `'warning'` 是 LogLevel（非 LogPhase），`deps.log(level, 'fill', ...)` 的第二参是 phase='fill'，第一参 level ∈ LogLevel（含 'warning'）。types.ts 的 `log` 签名第一参 `LogLevel`、第二参 phase——一致。

- [ ] **Step 2: 写 `fill.test.ts`**

```ts
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
```

- [ ] **Step 3: 跑测试确认通过**

Run: `pnpm test -- src/agent/pipeline/__tests__/fill.test.ts` → PASS（2 tests）

- [ ] **Step 4: `executeFormFill` Step 4b 改调 `fillPhase`**

把 `src/agent/FormFillEngine.ts` 的 386-427 行（filling 状态 + 填充循环 + 完成日志）替换为：

```ts
		// Step 4b: Fill form — sequential with annotation
		onStatusChange('filling')
		const { filled: filledCount, failed: failedCount } = await fillPhase(d, { fieldsToFill })
```

> 顶部加 `import { fillPhase } from './pipeline/fill'`。`ANALYZE_TIMEOUT_MS`/`FILL_TIMEOUT_MS` 常量若仅被已搬走的代码使用，可从 FormFillEngine.ts 删除（现移至 phase 内）——核查后删 `const FILL_TIMEOUT_MS`（analyze 的已在 analyzePhase）。`filledCount`/`failedCount` 变量名保持，供 Step 5 submit 分支与 result 使用。

- [ ] **Step 5: tsc + 全量测试**

Run: `pnpm exec tsc --noEmit` → 净零新增。Run: `pnpm test` → 330 + 2 = 332 全绿。

- [ ] **Step 6: 提交**

```bash
git add src/agent/pipeline/fill.ts src/agent/pipeline/__tests__/fill.test.ts src/agent/FormFillEngine.ts
git commit -m "refactor(pipeline): 抽出 fillPhase（逐字段高亮+填写循环）"
```

---

## Task 5: submit 分支用 `d.verifyNavigation` + 端到端测试 + 清理

**Files:**
- Modify: `src/agent/FormFillEngine.ts`（submit 分支 429-485 改用 `d.sendToTabMessage`/`d.verifyNavigation`；清理死 import；删除残留 `log` 别名若已全替换）
- Modify: `src/__tests__/FormFillEngine.test.ts`（补 executeFormFill 端到端测试）

**Interfaces:**
- Consumes: 全部前置 phase + `FormFillDeps`。

- [ ] **Step 1: submit 分支改用 deps**

把 `src/agent/FormFillEngine.ts` 的 435-471 行（runSubmitAndVerify 调用的 sendSubmit/verifyNavigation 闭包）改为：

```ts
			const outcome = await runSubmitAndVerify({
				sendSubmit: () => d.sendToTabMessage<SubmitResponse>(
					{
						type: 'TAB_COMMAND',
						action: 'submit',
						payload: {
							fields: analysis.fields.map((f) => ({
								selector: f.selector,
								type: f.type,
								effective_type: f.effective_type,
								name: f.name,
								id: f.id,
								canonical_id: f.canonical_id,
							})),
						},
					},
					20_000,
				),
				verifyNavigation: d.verifyNavigation,
				log: (level, message) => d.log(level, 'fill', message),
			})
```

> sendSubmit 从直接 `sendToTab(tabId, ...)` 改为 `d.sendToTabMessage(...)`（tabId 已绑定）；verifyNavigation 从内联 `verifyAfterNavigation(tabId, {...})` 改为 `d.verifyNavigation`（buildRealDeps 已构造等价闭包）。行为等价。

- [ ] **Step 2: 清理 FormFillEngine.ts 死 import / 残留**

- 移除现在仅在 phase 内使用的 import（若 FormFillEngine.ts 不再直接用）：`callLLM, parseLLMJson, injectHrefNewline`（移到 llmPhase）、`buildProductContext, pickAnchorText, pickFounderName, buildBlogCommentPrompt, buildDirectorySubmitPrompt`（移到 llmPhase）、`verifyAfterNavigation`（仅 buildRealDeps 用——保留）。逐个 grep 确认 FormFillEngine.ts 内是否还直接引用，只删零引用的。
- `ANALYZE_TIMEOUT_MS` 常量若已移到 analyzePhase 且 FormFillEngine.ts 无引用 → 删。
- 确认 `log` 别名（T2 加的 `const log = d.log.bind(d)`）若已全改为 `d.log` 则删除该别名；若仍有 `log(...)` 调用则保留。
- 核查 executeFormFill 主体行数应大幅下降（从 ~326 行降到编排 ~60-80 行）。

- [ ] **Step 3: 补 executeFormFill 端到端测试**

在 `src/__tests__/FormFillEngine.test.ts` 末尾追加（全 mock deps）：

```ts
import { executeFormFill } from '@/agent/FormFillEngine'
import type { FormFillDeps } from '@/agent/pipeline/types'
import type { AnalyzeResponse, FillResponse, SubmitResponse } from '@/messaging/messages'
import type { FormFillEngineConfig } from '@/agent/FormFillEngine'

const mkConfig = (): FormFillEngineConfig => ({
  llmConfig: { apiKey: 'k', baseUrl: 'u', model: 'm' },
  product: { id: 'p1', name: 'P', url: 'u', description: 'd', anchorTexts: 'a', founderName: 'F', founderEmail: 'e', createdAt: 0, updatedAt: 0 },
  site: { name: 'S', submit_url: 'https://x', category: 'blog_comment', dr: 0 },
  siteType: 'blog_comment',
  tabId: 1,
  callbacks: { onStatusChange: () => {}, onError: () => {}, onLog: () => {}, onLLMFields: () => {} },
})

const mkDeps = (over: Partial<FormFillDeps> = {}): FormFillDeps => ({
  sendToTabMessage: vi.fn(async (msg: any) => {
    if (msg.action === 'analyze') return { ok: true, analysis: { fields: [{ canonical_id: 'f1', selector: '#f1', form_index: 0, type: 'input', effective_type: 'comment' } as any], forms: [{ form_index: 0, filtered: false }], page_info: { title: 't', description: 'd' } } } as AnalyzeResponse
    if (msg.action === 'fill') return { ok: true, filled: 1, failed: 0 } as FillResponse
    if (msg.action === 'submit') return { ok: true, clicked: true, verifyResult: 'ajax' } as SubmitResponse
    return { ok: true }
  }) as any,
  sendProgress: vi.fn(),
  callLLM: vi.fn().mockResolvedValue('{"f1":"hello"}'),
  verifyNavigation: vi.fn().mockResolvedValue('confirmed'),
  log: vi.fn(),
  onLLMFields: vi.fn(),
  ...over,
}) as any

describe('executeFormFill (end-to-end, mock deps)', () => {
  it('成功路径：analyze→llm→match→fill→submit，返回 filled=1 submitted', async () => {
    const r = await executeFormFill(mkConfig(), mkDeps())
    expect(r.filled).toBe(1)
    expect(r.failed).toBe(0)
    expect(r.submitted).toBe(true)
    expect(r.verifyResult).toBe('ajax')
  })

  it('无字段 → filled=0 早退，不调 callLLM', async () => {
    const deps = mkDeps({ sendToTabMessage: vi.fn(async () => ({ ok: true, analysis: { fields: [], forms: [], page_info: { title: '', description: '' } } } as any)) as any })
    const r = await executeFormFill(mkConfig(), deps)
    expect(r.filled).toBe(0)
    expect(deps.callLLM).not.toHaveBeenCalled()
  })

  it('directory_submit → 不自动提交（无 submit 消息）', async () => {
    const cfg = { ...mkConfig(), siteType: 'directory_submit' as const }
    const deps = mkDeps()
    const r = await executeFormFill(cfg, deps)
    expect(r.submitted).toBeUndefined()
  })
})
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test -- src/__tests__/FormFillEngine.test.ts` → PASS（既有 fuzzyMatchField 例 + 新增 3 例）

- [ ] **Step 5: tsc + 全量测试 + 行数核查**

Run: `pnpm exec tsc --noEmit` → 净零新增。Run: `pnpm test` → 332 + 3 = 335 全绿。Run: `wc -l src/agent/FormFillEngine.ts` → executeFormFill 主体（194-523 原区间）应大幅缩短，phase 逻辑在 `pipeline/`。

- [ ] **Step 6: 手动验证（交付用户）**

`pnpm build` 加载扩展，真实站点验证矩阵：WP 博客评论自动提交（含提交验证）、directory 站点填充、无字段站点早退、Blogger iframe（桥梁未动）。Expected: 与 SP-1 后一致。

- [ ] **Step 7: 提交**

```bash
git add src/agent/FormFillEngine.ts src/__tests__/FormFillEngine.test.ts
git commit -m "refactor(pipeline): submit 分支用 FormFillDeps + executeFormFill 端到端测试

executeFormFill 收尾：sendSubmit/verifyNavigation 走 deps；清理死 import；
补端到端测试（成功/无字段/directory 不提交）。主体从 ~326 行降至编排 ~70 行。"
```

---

## Self-Review 笔记

**Spec 覆盖**：
- G1 5 phase 拆分 → T1(match)/T2(analyze)/T3(llm)/T4(fill)/submit 复用 runSubmitAndVerify（T5 接 deps）✅
- G2 FormFillDeps → T1 定义、T2 buildRealDeps ✅
- G3 executeFormFill 瘦身 → T2-T5 渐进 ✅
- G4 纯逻辑 matchFields → T1 ✅
- G5 每 phase + 端到端测试 → T1-T5 ✅

**类型一致性**：`FormFillDeps.sendToTabMessage<R>(msg, timeout)` 各 phase 用法一致；`AnalyzePhaseInput{siteType}`/`LlmPhaseInput{...}`/`FillPhaseInput{fieldsToFill}` 与 types.ts 定义一致；`matchFields` 返回 `MatchResult{fieldsToFill, skipped, matchedViaFuzzy}`。

**风险已处理**：
- 两段式降险：T1(match 纯)→T2-T4 各 phase 出生即带 deps（无"先搬运再改签名"返工）✅
- `logId` 闭包从 executeFormFill 移到 buildRealDeps（per-call 计数）✅
- llmPhase 拿不到 `llmConfig.model`（绑在 deps）→ log 去掉 model 字段（已在 T3 注明，非业务）✅
- analyzePhase 空字段跳过 progress/annotate/scroll（spec §2.3 修正项）✅

**后续 SP 衔接**：llmPhase 内 `siteType === 'blog_comment'` 分支（prompt/temperature）→ SP-3 SITE_TYPE_STRATEGIES；deps.verifyNavigation → P0 正向成功信号注入点。
