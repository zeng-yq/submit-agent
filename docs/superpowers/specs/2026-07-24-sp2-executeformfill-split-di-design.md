# SP-2 设计：领域层抽取 + executeFormFill 拆分 + 依赖注入

- **日期**：2026-07-24
- **状态**：待评审
- **分支**：`dev`
- **系列**：自动提交外链代码分层重构的第 2 个子项目（SP-2 / 共 5）

---

## 0. 上下文

5 层架构重构的第 2 步。**SP-1（消息契约层 L3）已完成**：`src/messaging/` 提供 `ExtensionMessage` 判别联合、`MessageRouter`、类型化发送封装 `sendToTab<R>` / `sendProgress`。本 SP 在此之上抽取领域层（L4）并把 `executeFormFill` 拆为可测管道。

| 序号 | 子项目 | 层 | 状态 |
|---|---|---|---|
| SP-1 | 消息契约层 | L3 | ✅ 完成 |
| **SP-2** | **领域层抽取 + executeFormFill 拆分 + DI（本 spec）** | **L2 / L4** | **进行中** |
| SP-3 | SiteType 策略 + dom-utils 拆分 | L4 / L5 | 待定 |
| SP-4 | FloatButton 拆 UI/Store | L1 / L2 | 待定 |
| SP-5 | 技术债清理 | — | 待定 |

目标分层：L1 表现 / L2 编排 / L3 消息契约 / L4 领域（纯、可测）/ L5 基础设施。

---

## 1. 背景与目标

### 1.1 现状问题

`FormFillEngine.executeFormFill`（`src/agent/FormFillEngine.ts`，约 326 行）是全系统最长、最不可测的函数：

1. **5 个 Step 混在一个 try 块**：analyze / prompt+llm / parse+match / fill / submit+verify，职责未分离。
2. **无依赖注入**：直接调 `sendToTab`（chrome.tabs.sendMessage）、`callLLM`、`sendProgress`，无法在单测中注入 mock → `FormFillEngine.test.ts` 只测了 `fuzzyMatchField`，整条管道零覆盖。
3. **纯逻辑与副作用混杂**：prompt 选择、字段匹配（精确+fuzzy）、解析决策等纯逻辑与 IPC/LLM 副作用交织。

**对照**：同文件的 `runSubmitAndVerify(deps: SubmitFlowDeps)` 已用依赖注入，`submit-flow.test.ts` 完整可测——这是本 SP 要推广的成功范式。

### 1.2 目标

- G1：把 5 个 Step 拆成独立 phase 函数（`analyzePhase` / `llmPhase` / `matchFields` / `fillPhase`，submit 复用 `runSubmitAndVerify`），每 phase 单一职责、可独立理解。
- G2：定义 `FormFillDeps` 接口注入副作用依赖（IPC / LLM / 进度 / 验证 / 日志），镜像 `SubmitFlowDeps`。
- G3：`executeFormFill` 瘦身为 L2 编排——组装 deps、顺序调 phase、管 try/catch/status/log。
- G4：纯逻辑（字段匹配）抽到 L4 领域，无 deps、可直接单测。
- G5：每个 phase + 整条管道获得单测覆盖（注入 mock deps）。

### 1.3 非目标（明确不做）

- **不改调用方**：`useFormFillEngine` 调 `executeFormFill(config)` 的签名不变（DI 是 executeFormFill 内部细节，通过可选 `deps?` 参数暴露给测试）。
- **不改 `runSubmitAndVerify` / `SubmitFlowDeps`**：submit phase 直接复用。
- **不动 `prompts/` 模块**（`buildBlogCommentPrompt` 等已是独立纯模块，本 SP 只调用）。
- **不引入 SiteType 策略对象**（SP-3）。
- **不改 `llm-utils.ts` 的 `parseLLMJson`/`injectHrefNewline`**（已是纯函数，直接复用）。
- **不改任何业务语义**：phase 是"搬运"不是"重写"，行为等价。

---

## 2. 目标设计

### 2.1 模块结构（新增 `src/agent/pipeline/`，L4 领域层）

```
src/agent/pipeline/
├── types.ts       FormFillDeps 接口 + 各 phase input/output 类型
├── match.ts       matchFields(analysis, fieldValues) → MatchResult   【纯函数，无 deps】
├── analyze.ts     analyzePhase(deps, input) → { analysis, pageContent }
├── llm.ts         llmPhase(deps, input) → FieldValueMap             【含 parse + injectHrefNewline + onLLMFields】
├── fill.ts        fillPhase(deps, input) → { filled, failed }       【含 annotate-active 高亮循环】
└── __tests__/
    ├── match.test.ts
    ├── analyze.test.ts
    ├── llm.test.ts
    └── fill.test.ts
```

**submit 不新建文件**：executeFormFill 的 submit 分支直接调 `runSubmitAndVerify`（已 DI 化）。

### 2.2 FormFillDeps 接口

```ts
// pipeline/types.ts
import type { ExtensionMessage, FillProgressAction, ProgressPayload } from '@/messaging/messages'
import type { LLMSettings } from '@/lib/types'
import type { LogLevel, LogPhase, LLMFieldData } from '@/agent/types'
import type { ModerationVerdict } from '@/agent/verify-after-navigation'

export interface FormFillDeps {
  /** 发送到 content tab（已绑定 tabId） */
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
  log: (level: LogLevel, phase: LogPhase, message: string, data?: unknown, url?: string) => void
  /** LLM 字段值展示回调（可选） */
  onLLMFields?: (data: LLMFieldData) => void
}
```

> 设计要点：deps 只含**副作用端口**（IPC / LLM / 进度 / 验证 / 日志）。纯逻辑（prompt 选择、字段匹配）不进 deps，是普通函数。

### 2.3 Phase 签名

```ts
// pipeline/analyze.ts
export interface AnalyzePhaseInput { tabId: number; siteType: SiteType }
export interface AnalyzePhaseOutput { analysis: FormAnalysisResult; pageContent?: PageContent }
export async function analyzePhase(deps: FormFillDeps, input: AnalyzePhaseInput): Promise<AnalyzePhaseOutput>
// 行为：sendToTabMessage(analyze) → 取 analysis+pageContent；**若 analysis.fields.length>0** 才
//       sendProgress('progress') + sendToTabMessage(annotate) + sendToTabMessage(scroll-to-first)
//       （均 .catch 吞错，与现状一致——现状这些在空字段早退之后才执行）。
//       fields.length===0 的错误返回（onError/onStatusChange/FillResult）留给 executeFormFill（属编排决策）；
//       analyzePhase 仅负责不在空字段时触发后续 UX 副作用。

// pipeline/llm.ts
export interface LlmPhaseInput {
  analysis: FormAnalysisResult; pageContent?: PageContent
  product: ProductProfile; site: SiteData; siteType: SiteType; llmConfig: LLMSettings; signal?: AbortSignal
}
export async function llmPhase(deps: FormFillDeps, input: LlmPhaseInput): Promise<FieldValueMap>
// 行为：pickAnchorText/pickFounderName + buildProductContext；按 siteType 选 buildBlogCommentPrompt
//       或 buildDirectorySubmitPrompt；构造 userPrompt；callLLM（temperature blog=0.7/dir=0.3）；
//       parseLLMJson → injectHrefNewline 逐字段；触发 deps.onLLMFields。返回 fieldValues。

// pipeline/match.ts（纯）
export interface MatchResult { fieldsToFill: FieldsToFill; skipped: number; matchedViaFuzzy: boolean }
export function matchFields(analysis: FormAnalysisResult, fieldValues: FieldValueMap): MatchResult
// 行为：先精确匹配（fieldValues[canonical_id] 非空）；若空且 valueCount>0，回退 fuzzyMatchField
//       （含单表单 formIndex 优先逻辑，搬现状代码）。返回 fieldsToFill + skipped + 是否走了 fuzzy。

// pipeline/fill.ts
export interface FillPhaseInput { tabId: number; fieldsToFill: FieldsToFill }
export interface FillPhaseOutput { filled: number; failed: number }
export async function fillPhase(deps: FormFillDeps, input: FillPhaseInput): Promise<FillPhaseOutput>
// 行为：逐字段 sendToTabMessage(annotate-active) → sleep 150ms → sendToTabMessage(fill)；
//       累加 filled/failed（搬现状循环）。
```

> `FieldsToFill = Array<{ canonical_id: string; value: string; selector: string }>`（定义在 types.ts）。

### 2.4 `executeFormFill` 瘦身为 L2 编排

```ts
export async function executeFormFill(
  config: FormFillEngineConfig,
  deps?: FormFillDeps,
): Promise<FillResult> {
  const { product, site, siteType, tabId, callbacks, signal } = config
  const d = deps ?? buildRealDeps(config)   // 默认构造真实 ports（绑 tabId/llmConfig）
  const { onStatusChange, onError } = callbacks

  try {
    onStatusChange('analyzing'); d.log('info', 'system', `开始填写: ${site.name} (tab ${tabId})`, ...)

    // Step 1: analyze
    const { analysis, pageContent } = await analyzePhase(d, { tabId, siteType })
    if (analysis.fields.length === 0) {
      d.log('error', 'analyze', '页面未发现可填写的表单字段')
      onStatusChange('error'); onError(new Error('页面未发现可填写的表单字段'))
      return { filled: 0, skipped: 0, failed: 0, notes: 'No form fields found on this page.' }
    }

    // Step 2+3: llm + parse
    const fieldValues = await llmPhase(d, { analysis, pageContent, product, site, siteType, llmConfig: config.llmConfig, signal })

    // Step 4a: match（纯）
    const { fieldsToFill, skipped, matchedViaFuzzy } = matchFields(analysis, fieldValues)
    if (matchedViaFuzzy) d.log('info', 'llm', `模糊匹配成功: ${fieldsToFill.length} 个字段`, ...)
    if (fieldsToFill.length === 0) {
      // valueCount>0 但无匹配 / valueCount===0 两类错误（搬现状分支 + onStatusChange/onError）
      ...return mismatch error FillResult
    }

    // Step 4b: fill
    onStatusChange('filling')
    const { filled, failed } = await fillPhase(d, { tabId, fieldsToFill })

    // Step 5: submit（仅 blog_comment && failed===0 && filled>0）
    let submitted: boolean | undefined; let verifyResult: VerifyResult | undefined; let submitError: string | undefined
    if (siteType === 'blog_comment' && failed === 0 && filled > 0) {
      const outcome = await runSubmitAndVerify({
        sendSubmit: () => d.sendToTabMessage<SubmitResponse>({ type:'TAB_COMMAND', action:'submit', payload:{ fields: ... } }, 20_000),
        verifyNavigation: d.verifyNavigation,
        log: (level, message) => d.log(level, 'fill', message),
      })
      submitted = outcome.submitted; verifyResult = outcome.verifyResult; submitError = outcome.submitError
    }

    d.sendProgress('done')
    onStatusChange('done')
    return { filled, skipped, failed, notes: `Filled ${filled} of ${analysis.fields.length} fields.`, submitted, verifyResult, submitError }
  } catch (error) {
    // AbortError → idle return；else sendProgress('error') + onError（搬现状）
  }
}

/** 从 config 构造真实 deps（生产路径） */
function buildRealDeps(config: FormFillEngineConfig): FormFillDeps {
  const { tabId, llmConfig, callbacks } = config
  return {
    sendToTabMessage: (msg, timeoutMs) => sendToTab(tabId, msg, timeoutMs),  // SP-1 的 router.sendToTab
    sendProgress,
    callLLM: (opts) => callLLM({ config: llmConfig, ...opts }),
    verifyNavigation: () => verifyAfterNavigation(tabId, { /* 现状 getTabUrl/sendVerify/sleep */ }),
    log: (level, phase, message, data, url) => callbacks.onLog?.({ id: ++logId, timestamp: Date.now(), level, phase, message, data, url }),
    onLLMFields: callbacks.onLLMFields,
  }
}
```

- **调用方零改动**：`useFormFillEngine` 仍 `executeFormFill(config)`。
- **可测**：测试 `executeFormFill(config, mockDeps)` 跑整条管道。

---

## 3. 迁移计划（增量，每步测试绿，单 commit）

| 步 | 内容 | 风险 |
|---|---|---|
| 1 | 新增 `pipeline/types.ts`（FormFillDeps + phase I/O 类型 + FieldsToFill），不动现有代码 | 零 |
| 2 | 抽 `matchFields` 到 `pipeline/match.ts`（纯，搬现状精确+fuzzy 逻辑）；executeFormFill Step 4 的匹配段改为调它；补 `match.test.ts` | 低 |
| 3 | 抽 `analyzePhase`（搬 Step 1）；executeFormFill 调用（此步 phase 内仍直接用 sendToTab/sendProgress，DI 在步骤 6 接入）；补 `analyze.test.ts`（先测能跑的部分） | 低 |
| 4 | 抽 `llmPhase`（搬 Step 2+3）；补 `llm.test.ts` | 中 |
| 5 | 抽 `fillPhase`（搬 Step 4 填充循环）；补 `fill.test.ts` | 中 |
| 6 | 接入 FormFillDeps：phase 形参改 `(deps, input)`，phase 内用 `deps.sendToTabMessage`/`deps.callLLM` 等；executeFormFill 加 `deps?` 参数 + `buildRealDeps`；删除 phase 内残留的直接 chrome/callLLM 引用 | 中 |
| 7 | 补 `executeFormFill` 端到端测试（全 mock deps：成功 / 无字段 / LLM 不匹配 / Abort）；清理 FormFillEngine.ts 的死 import；最终 grep 确认 executeFormFill 行数大幅下降 | 低 |

**关键降险**：步骤 2-5 是"搬运"（逻辑等价，executeFormFill 调用新 phase），步骤 6 才"接 DI"。两段式避免一次同时改结构+改依赖。

---

## 4. 测试策略

- **`matchFields`**（纯）：精确匹配命中 / 精确为空回退 fuzzy / fuzzy 命中 / 全不匹配 / valueCount===0 / 单表单 formIndex 优先。
- **`analyzePhase`**：mock `sendToTabMessage` 返回 analysis；断言调了 analyze/annotate/scroll-to-first、sendProgress('progress')、返回 {analysis,pageContent}。
- **`llmPhase`**：mock `callLLM` 返回 JSON 串；断言按 siteType 选了正确 prompt builder、parseLLMJson+injectHrefNewline 生效、触发 onLLMFields、返回 fieldValues。
- **`fillPhase`**：mock `sendToTabMessage`；断言逐字段 annotate-active + fill、filled/failed 累加正确。
- **`executeFormFill`**（端到端，全 mock deps）：成功路径（analyze→llm→match→fill→submit）/ 无字段早退 / LLM 返回但无匹配 / LLM 无值 / Abort 中断。
- **既有 318 测试维持全绿**（行为等价硬约束）。

> 时序常量（analyze 10s / fill 10s / 高亮 150ms / submit 20s）维持现状硬编码，集中化留作 SP-5。

---

## 5. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 搬运 phase 引入回归（如 match 的 formIndex 逻辑、fill 的 filled/failed 累加） | 每 phase 单测 + 既有 318 测试双守门；步骤 2-5 单 commit 可单独回滚 |
| DI 接入（步骤 6）改 phase 签名 | 步骤 6 单 commit；端到端测试覆盖 |
| `buildRealDeps` 的 verifyNavigation 闭包与现状 `verifyAfterNavigation(tabId, {...})` 不等价 | 逐字段对照现状 getTabUrl/sendVerify/sleep 注入；submit-flow.test.ts 已覆盖 runSubmitAndVerify |
| logId 闭包计数从 executeFormFill 移到 buildRealDeps | 确保每条 log 的 id 仍递增唯一（搬现状闭包） |

---

## 6. 验收标准

- ✅ `pnpm exec tsc --noEmit` 净零新增错误（基线约 26 错）
- ✅ 全量 `pnpm test` 全绿（318 + 新增 phase/pipeline 测试）
- ✅ `executeFormFill` 主体行数大幅下降（从 ~326 行降到编排 ~60-80 行），5 个 Step 逻辑在 `pipeline/` 各文件
- ✅ `FormFillEngine.test.ts` 之外新增 `pipeline/__tests__/` 覆盖每个 phase + executeFormFill 端到端
- ✅ 行为等价：真实站点手动验证矩阵（WP 评论自动提交 / directory 填充 / 无字段站点 / Blogger iframe）与 SP-1 后一致
- ✅ 调用方 `useFormFillEngine` 零改动
- ✅ `runSubmitAndVerify` / `fuzzyMatchField` / `parseLLMJson` 未被修改

---

## 7. 未涵盖（后续 SP）

- SP-3：把 `llmPhase` 内的 `siteType === 'blog_comment'` prompt/temperature 分支抽成 `SITE_TYPE_STRATEGIES` 配置对象（本 SP 仅搬运分支，不策略化）。
- SP-3：`fillPhase` 的 `fillAndVerify` 依赖（dom-utils 拆分）。
- SP-4：`useFormFillEngine` 的 category→siteType 映射重复（两处）收敛。
- P0（验证正确性）：仍延后；SP-2 把 `verifyNavigation` 抽进 deps，为 P0 在 verifyAfterNavigation 加正向成功信号预留了注入点。
