# SP-3a 设计：SiteType 策略对象 + fuzzy 函数下沉

- **日期**：2026-07-24
- **状态**：待评审
- **分支**：`dev`
- **系列**：自动提交外链代码分层重构；SP-3 拆分为 SP-3a（本 spec）+ SP-3b（dom-utils 拆分 + 字段去重，后续）

---

## 0. 上下文

5 层架构重构进行中。**SP-1（消息契约层 L3）、SP-2（executeFormFill 拆分 + DI）已完成**。SP-3 原含 4 块独立重构（SiteType 策略 / dom-utils 拆分 / 字段去重 / fuzzy 下沉），评审时因触及不同子系统、风险高，**拆为 SP-3a（本 spec：策略 + fuzzy，围绕 FormFillEngine/pipeline）+ SP-3b（dom-utils 拆分 + 字段去重，围绕 DOM 层，后续独立循环）**。

| 序号 | 子项目 | 层 | 状态 |
|---|---|---|---|
| SP-1 | 消息契约层 | L3 | ✅ 完成 |
| SP-2 | executeFormFill 拆分 + DI | L2/L4 | ✅ 完成 |
| **SP-3a** | **SiteType 策略 + fuzzy 下沉（本 spec）** | **L4** | **进行中** |
| SP-3b | dom-utils 拆分 + 字段去重 | L4/L5 | 待定 |
| SP-4 | FloatButton 拆 UI/Store | L1/L2 | 待定 |
| SP-5 | 技术债清理 | — | 待定 |

---

## 1. 背景与目标

### 1.1 现状问题

**SiteType 分支散落 7 处**：
- `pipeline/llm.ts`（SP-2 产物）4 处：`buildSystemPrompt`（blog→buildBlogCommentPrompt 否则 buildDirectorySubmitPrompt）、`buildUserPrompt` 文案、`temperature`（0.7/0.3）、日志 `label`（'博客评论'/'目录提交'）。
- `FormFillEngine.ts` executeFormFill 1 处：submit 分支 `siteType === 'blog_comment' && failed === 0 && filled > 0`。
- `useFormFillEngine.ts` 2 处：`:85` 和 `:158` 的 `site.category === 'blog_comment' ? 'blog_comment' : 'directory_submit'` 映射重复。

这是典型的「该用策略对象却用了 if 链」——新增一个 siteType 要改 7 处。

**fuzzy 循环依赖**（SP-2 review 移交的 Minor）：`pipeline/match.ts` import `fuzzyMatchField` from `@/agent/FormFillEngine`，`FormFillEngine` import `matchFields` from `./pipeline/match`——成环。运行时无碍（hoisted exports），但 pipeline 模块不自包含，是代码异味。

### 1.2 目标

- G1：把 7 处 siteType 分支收敛为 `SITE_TYPE_STRATEGIES: Record<SiteType, SiteTypeStrategy>` 配置对象 + `siteTypeFromCategory()` helper。新增 siteType 从改 7 处降到加 1 项策略 + 联合加成员（compiler 强制策略完备）。
- G2：把 `tokenize`/`tokenSimilarity`/`matchesField`/`fuzzyMatchField` 从 FormFillEngine.ts 下沉到 `pipeline/fuzzy.ts`，斩断 match↔FormFillEngine 循环依赖，pipeline 模块自包含。
- G3：行为等价——策略与下沉都是「搬运」现有逻辑，不改语义。

### 1.3 非目标

- **不引入新 siteType**（如 forum_post）——本 SP 只把现有 blog_comment/directory_submit 策略化，新增留作策略化的首次实践后的后续需求。
- **不动 dom-utils / form-analyzer**（SP-3b）。
- **不改 prompts/* 模块**（buildBlogCommentPrompt/buildDirectorySubmitPrompt 仍是独立纯模块，策略对象只调用）。
- **不改 runSubmitAndVerify / 各 phase 的内部逻辑**（只改 llmPhase 用策略、executeFormFill submit 用 autoSubmit 标志）。
- **不改业务语义**——温度、prompt 选择、autoSubmit 条件、文案逐字保留。

---

## 2. 目标设计

### 2.1 fuzzy 下沉

新增 `src/agent/pipeline/fuzzy.ts`，**逐字搬运** FormFillEngine.ts:22-103 的 4 个函数：

```ts
// src/agent/pipeline/fuzzy.ts
import type { FormAnalysisResult } from '@/agent/FormAnalyzer'

function tokenize(s: string): Set<string> { /* 现状逐字 */ }
function tokenSimilarity(a: string, b: string): number { /* 现状逐字 */ }
function matchesField(key: string, field: FormAnalysisResult['fields'][number]): boolean { /* 现状逐字 */ }
export function fuzzyMatchField(llmKey, fields, usedCanonicalIds, formIndex?): FormAnalysisResult['fields'][number] | null { /* 现状逐字 */ }
```

- `tokenize`/`tokenSimilarity`/`matchesField` 保持模块内私有（不导出），`fuzzyMatchField` 导出（与现状一致）。
- `pipeline/match.ts`：`import { fuzzyMatchField } from './fuzzy'`（替代 `from '@/agent/FormFillEngine'`）。
- `FormFillEngine.test.ts`：`import { fuzzyMatchField } from '@/agent/pipeline/fuzzy'`（替代 `from '@/agent/FormFillEngine'`）。
- FormFillEngine.ts：**删除**这 4 个函数（SP-2 后 FormFillEngine 自身不再调用 fuzzyMatchField——matchFields 在 pipeline/match.ts）。删后 grep 确认 FormFillEngine.ts 无 fuzzyMatchField 残留引用。

### 2.2 SiteType 策略对象

新增 `src/agent/pipeline/site-type.ts`（L4 配置）：

```ts
// src/agent/pipeline/site-type.ts
import type { SiteData, SiteCategory } from '@/lib/types'
import type { FormAnalysisResult, PageInfo } from '@/agent/FormAnalyzer'
import type { PageContent } from '@/agent/PageContentExtractor'
import type { SiteType } from '@/agent/types'
import { buildBlogCommentPrompt } from '@/agent/prompts/blog-comment-prompt'
import { buildDirectorySubmitPrompt } from '@/agent/prompts/directory-submit-prompt'

export interface SystemPromptCtx {
  productContext: string
  pageContent?: PageContent
  pageInfo: PageInfo
  fields: FormAnalysisResult['fields']
  forms: FormAnalysisResult['forms']
}

export interface SiteTypeStrategy {
  /** 日志标签 */
  label: string
  /** LLM temperature */
  temperature: number
  /** 构建 system prompt */
  buildSystemPrompt: (ctx: SystemPromptCtx) => string
  /** 构建 user prompt */
  buildUserPrompt: (site: SiteData) => string
  /** 是否在填写成功后自动提交（blog_comment:true，directory_submit:false） */
  autoSubmit: boolean
}

export const SITE_TYPE_STRATEGIES: Record<SiteType, SiteTypeStrategy> = {
  blog_comment: {
    label: '博客评论',
    temperature: 0.7,
    autoSubmit: true,
    buildSystemPrompt: (ctx) => ctx.pageContent
      ? buildBlogCommentPrompt({ productContext: ctx.productContext, pageContent: ctx.pageContent, fields: ctx.fields, forms: ctx.forms })
      : buildDirectorySubmitPrompt({ productContext: ctx.productContext, pageInfo: ctx.pageInfo, fields: ctx.fields, forms: ctx.forms }),
    buildUserPrompt: (site) => `Fill the comment form on ${site.name}. Page URL: ${site.submit_url || 'current page'}.`,
  },
  directory_submit: {
    label: '目录提交',
    temperature: 0.3,
    autoSubmit: false,
    buildSystemPrompt: (ctx) => buildDirectorySubmitPrompt({ productContext: ctx.productContext, pageInfo: ctx.pageInfo, fields: ctx.fields, forms: ctx.forms }),
    buildUserPrompt: (site) => `Fill the submission form on ${site.name}. Submit URL: ${site.submit_url || 'current page'}.`,
  },
}

/** SiteCategory → SiteType（消除 useFormFillEngine 两处重复映射） */
export function siteTypeFromCategory(category: SiteCategory): SiteType {
  return category === 'blog_comment' ? 'blog_comment' : 'directory_submit'
}
```

> **pageContent 回退保留**：blog_comment 策略的 buildSystemPrompt 在 `pageContent` 缺失时降级用 directory prompt——这是现状行为（`siteType === 'blog_comment' && pageContent` 才用 blog prompt）。实际 blog_comment 总有 pageContent（analyzePhase 对 blog_comment 提取），回退永不触发，但属防御代码，逐字保留以行为等价。

### 2.3 消费点改造

**llmPhase**（`pipeline/llm.ts`）——消除 4 处分支：

```ts
export async function llmPhase(deps, input): Promise<FieldValueMap> {
  const { analysis, pageContent, product, site, siteType, signal } = input
  const strategy = SITE_TYPE_STRATEGIES[siteType]

  const selectedAnchor = pickAnchorText(product)
  const selectedFounderName = pickFounderName(product)
  const productContext = buildProductContext(product, selectedAnchor, selectedFounderName)
  const systemPrompt = strategy.buildSystemPrompt({ productContext, pageContent, pageInfo: analysis.page_info, fields: analysis.fields, forms: analysis.forms })
  const userPrompt = strategy.buildUserPrompt(site)

  deps.log('info', 'llm', `正在调用 LLM (${strategy.label})...`, {
    systemPromptLength: systemPrompt.length, userPromptLength: userPrompt.length,
    systemPrompt, userPrompt, fieldCount: analysis.fields.length,
  })

  const rawResponse = await deps.callLLM({
    systemPrompt, userPrompt,
    temperature: strategy.temperature,
    maxTokens: 2048, signal, jsonMode: true,
  })
  // ... parse + injectHrefNewline + onLLMFields 不变
}
```

llmPhase 不再直接 import buildBlogCommentPrompt/buildDirectorySubmitPrompt（它们进 site-type.ts）。

**executeFormFill**（`FormFillEngine.ts`）——submit 分支：

```ts
// 原：if (siteType === 'blog_comment' && failedCount === 0 && filledCount > 0)
if (SITE_TYPE_STRATEGIES[siteType].autoSubmit && failedCount === 0 && filledCount > 0) { ... }
```

**useFormFillEngine**（`:85`、`:158`）：

```ts
// 原：const siteType: SiteType = site.category === 'blog_comment' ? 'blog_comment' : 'directory_submit'
import { siteTypeFromCategory } from '@/agent/pipeline/site-type'
const siteType = siteTypeFromCategory(site.category)
```

### 2.4 扩展性收益

新增一个 siteType（如 `forum_post`）：
1. `SiteType` 联合加 `'forum_post'`（agent/types.ts）。
2. `SITE_TYPE_STRATEGIES` 加一项（compiler 强制——Record<SiteType,_> 缺成员即报错）。
3. 如有新 category，`siteTypeFromCategory` 加映射。

对比现状 7 处分散改动。这是 `comment-system-detector.ts` 已验证的配置驱动范式推广到 siteType。

---

## 3. 迁移计划（增量，每步测试绿，单 commit）

| 步 | 内容 | 风险 |
|---|---|---|
| 1 | 新增 `pipeline/fuzzy.ts`（搬运 4 函数）；match.ts 改 import；FormFillEngine.test.ts 改 import；FormFillEngine.ts 删 4 函数；grep 确认断环（无 FormFillEngine→fuzzy 反向依赖） | 低 |
| 2 | 新增 `pipeline/site-type.ts`（SiteTypeStrategy + SITE_TYPE_STRATEGIES + siteTypeFromCategory）；补策略单测（每 siteType 的 label/temperature/autoSubmit/buildUserPrompt + blog 的 pageContent 回退） | 低 |
| 3 | llmPhase 改用 strategy（消除 4 分支）；移除 llm.ts 对 buildBlogCommentPrompt/buildDirectorySubmitPrompt 的直接 import；llm.test.ts 更新（temperature 断言走 strategy） | 中 |
| 4 | executeFormFill submit 分支用 `SITE_TYPE_STRATEGIES[siteType].autoSubmit`；useFormFillEngine 两处用 `siteTypeFromCategory` | 低 |
| 5 | 全量回归 + 清理（FormFillEngine.ts 移除不再用的 import）；手动验证矩阵 | 低 |

---

## 4. 测试策略

- **fuzzy 下沉**：既有 `FormFillEngine.test.ts` 的 fuzzyMatchField 用例（import 改源头后）继续过——证明搬运等价。可选补 fuzzy.ts 的直接单测。
- **site-type 策略单测**（新 `pipeline/__tests__/site-type.test.ts`）：
  - 每个 siteType 的 `label`/`temperature`/`autoSubmit` 正确。
  - `buildUserPrompt(site)` 文案逐字（blog 含 "comment form"、directory 含 "submission form"）。
  - blog 的 `buildSystemPrompt` 有 pageContent → 调 buildBlogCommentPrompt；无 pageContent → 回退 buildDirectorySubmitPrompt。
  - directory 的 `buildSystemPrompt` → buildDirectorySubmitPrompt。
  - `siteTypeFromCategory('blog_comment')` → 'blog_comment'；其它 category → 'directory_submit'。
- **llmPhase 回归**：llm.test.ts 既有用例（temperature 0.7/0.3、prompt 选择）继续过——证明策略化等价。
- **executeFormFill 端到端**：既有 3 例（成功/无字段/directory 不提交）继续过；directory 不提交由 strategy.autoSubmit=false 守卫。
- **既有 336 测试维持全绿**（行为等价硬约束）。

---

## 5. 风险与回滚

| 风险 | 缓解 |
|---|---|
| fuzzy 搬运引入回归（tokenize/tokenSimilarity 逻辑） | 逐字搬运 + 既有 fuzzyMatchField 测试守门；步骤 1 单 commit 可回滚 |
| 策略化改变 prompt 选择/temperature | site-type 单测断言每 siteType 的 temperature/label/buildUserPrompt；llm.test 回归 |
| pageContent 回退被误删 | site-type 单测显式覆盖 blog 无 pageContent → directory prompt |
| FormFillEngine.ts 删 fuzzy 后有残留引用 | grep 确认零引用 + tsc |
| 断环未真正生效 | grep 确认 pipeline/match.ts 不再 import from FormFillEngine |

---

## 6. 验收标准

- ✅ `pnpm exec tsc --noEmit` 净零新增错误（基线约 26 错）
- ✅ 全量 `pnpm test` 全绿（336 + 新增 site-type 策略测试）
- ✅ `pipeline/match.ts` 不再 `import from '@/agent/FormFillEngine'`（循环依赖斩断）；`pipeline/` 模块自包含
- ✅ FormFillEngine.ts 不再定义 tokenize/tokenSimilarity/matchesField/fuzzyMatchField
- ✅ llmPhase 内零 `siteType === 'blog_comment'` 分支（4 处全消除，改用 strategy）
- ✅ executeFormFill submit 分支用 `SITE_TYPE_STRATEGIES[siteType].autoSubmit`；useFormFillEngine 用 `siteTypeFromCategory`（2 处重复消除）
- ✅ 行为等价：真实站点手动验证矩阵（WP 评论自动提交 + directory 不提交）与 SP-2 后一致
- ✅ 新增 siteType 时，`SITE_TYPE_STRATEGIES` 缺成员 → compiler 报错（Record 完备性强制）

---

## 7. 未涵盖（后续）

- **SP-3b**：dom-utils.ts 拆分（L5 writers + L4 filter，蜜罐常量命名化）+ form-analyzer 字段构建去重。
- **新 siteType 实践**：本 SP 只策略化现有两类；首个新 siteType（如 forum_post）将验证策略对象的扩展性。
- **P0（验证正确性）**：仍延后。
