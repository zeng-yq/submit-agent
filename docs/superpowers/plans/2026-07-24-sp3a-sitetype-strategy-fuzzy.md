# SP-3a SiteType 策略对象 + fuzzy 下沉 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 7 处散落的 `siteType === 'blog_comment'` 分支收敛为 `SITE_TYPE_STRATEGIES` 配置对象 + `siteTypeFromCategory` helper，并把 fuzzy 函数下沉到 `pipeline/fuzzy.ts` 斩断 match↔FormFillEngine 循环依赖。

**Architecture:** 新增 `pipeline/site-type.ts`（L4 配置：`Record<SiteType, SiteTypeStrategy>` + category→siteType helper）与 `pipeline/fuzzy.ts`（L4 纯函数，从 FormFillEngine 搬运）。llmPhase/executeFormFill/useFormFillEngine 改用策略/helper 消除 if 链。均为「搬运」现有逻辑，行为等价。

**Tech Stack:** TypeScript（strict, strictNullChecks）、WXT、Vitest + jsdom。别名 `@/*` → `src/*`。

## Global Constraints

- 测试命令：`pnpm test`（基线 **336 测试 / 24 文件全绿**，SP-2 后）。每个任务结束必须全绿。
- 类型检查：`pnpm exec tsc --noEmit`（基线约 26 错）净零新增错误。
- **行为等价（硬约束）**：策略与下沉都是「搬运」现有逻辑。temperature（0.7/0.3）、prompt 选择、autoSubmit 条件、文案、fuzzy 算法逐字保留。
- **不动**：prompts/*（buildBlogCommentPrompt/buildDirectorySubmitPrompt）、runSubmitAndVerify、各 phase 内部逻辑、dom-utils、form-analyzer（SP-3b）、messaging/。
- 提交规范：中文 conventional commit（如 `refactor(pipeline): ...`）。

---

## File Structure

| 文件 | 职责 | 任务 |
|---|---|---|
| `src/agent/pipeline/fuzzy.ts` | tokenize/tokenSimilarity/matchesField/fuzzyMatchField（从 FormFillEngine 搬运） | T1 |
| `src/agent/pipeline/site-type.ts` | SiteTypeStrategy + SITE_TYPE_STRATEGIES + siteTypeFromCategory + SystemPromptCtx | T2 |
| `src/agent/pipeline/__tests__/site-type.test.ts` | 策略单测 | T2 |
| `src/agent/pipeline/match.ts` | fuzzyMatchField import 改 ./fuzzy | T1 |
| `src/agent/pipeline/llm.ts` | 4 处 siteType 分支 → strategy | T3 |
| `src/agent/FormFillEngine.ts` | 删 fuzzy 函数；submit 分支用 strategy.autoSubmit | T1, T4 |
| `src/__tests__/FormFillEngine.test.ts` | fuzzyMatchField import 改源头 | T1 |
| `src/hooks/useFormFillEngine.ts` | 两处 category→siteType 用 siteTypeFromCategory | T4 |

---

## Task 1: fuzzy 函数下沉到 `pipeline/fuzzy.ts`（斩断循环依赖）

**Files:**
- Create: `src/agent/pipeline/fuzzy.ts`
- Modify: `src/agent/pipeline/match.ts:4`
- Modify: `src/__tests__/FormFillEngine.test.ts:2`
- Modify: `src/agent/FormFillEngine.ts:22-103`（删除 4 函数）+ imports 清理

**Interfaces:**
- Produces: `fuzzyMatchField(llmKey, fields, usedCanonicalIds, formIndex?) => FormAnalysisResult['fields'][number] | null`（签名不变，仅换文件）。

- [ ] **Step 1: 建 `pipeline/fuzzy.ts`（逐字搬运 FormFillEngine.ts:22-103）**

```ts
// src/agent/pipeline/fuzzy.ts
import type { FormAnalysisResult } from '@/agent/FormAnalyzer'

/** Normalize a string for comparison: lowercase, split on non-alphanumeric. */
function tokenize(s: string): Set<string> {
	return new Set(
		s.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim().split(/\s+/).filter(Boolean)
	)
}

/** Compute Jaccard token similarity between two strings. Returns 0–1. */
function tokenSimilarity(a: string, b: string): number {
	const ta = tokenize(a)
	const tb = tokenize(b)
	if (ta.size === 0 && tb.size === 0) return 0
	const intersection = new Set([...ta].filter(t => tb.has(t)))
	const union = new Set([...ta, ...tb])
	return intersection.size / union.size
}

/**
 * Check if an LLM key matches a form field.
 * Uses exact normalized match first, then token similarity with > 0.5 threshold.
 */
function matchesField(
	key: string,
	field: FormAnalysisResult['fields'][number],
): boolean {
	// Exact match fast path (normalized string equality)
	const normalizedKey = key.toLowerCase().replace(/[-_\s]/g, '')

	const identifiers = [
		field.canonical_id,
		field.name,
		field.id,
		field.label,
		field.placeholder,
		field.inferred_purpose,
	]

	for (const id of identifiers) {
		if (!id) continue
		const norm = id.toLowerCase().replace(/[-_\s]/g, '')
		if (norm === normalizedKey) return true
	}

	// Token similarity match (threshold > 0.5)
	for (const id of identifiers) {
		if (!id) continue
		if (tokenSimilarity(key, id) > 0.5) return true
	}

	return false
}

/**
 * Try to fuzzy-match an LLM key to a form field.
 * Prefers fields within the same form (formIndex) when provided,
 * falls back to global match if no same-form match found.
 */
export function fuzzyMatchField(
	llmKey: string,
	fields: FormAnalysisResult['fields'],
	usedCanonicalIds: Set<string>,
	formIndex?: number,
): FormAnalysisResult['fields'][number] | null {
	const key = llmKey

	// Phase 1: Try same-form match first
	if (formIndex !== undefined) {
		for (const field of fields) {
			if (usedCanonicalIds.has(field.canonical_id)) continue
			if (field.form_index !== formIndex) continue
			if (matchesField(key, field)) return field
		}
	}

	// Phase 2: Fall back to global match
	for (const field of fields) {
		if (usedCanonicalIds.has(field.canonical_id)) continue
		if (matchesField(key, field)) return field
	}

	return null
}
```

- [ ] **Step 2: `match.ts` 改 import**

把 `src/agent/pipeline/match.ts:4` 的 `import { fuzzyMatchField } from '@/agent/FormFillEngine'` 改为：

```ts
import { fuzzyMatchField } from './fuzzy'
```

- [ ] **Step 3: `FormFillEngine.test.ts` 改 import**

把 `src/__tests__/FormFillEngine.test.ts:2` 的 `import { fuzzyMatchField, executeFormFill } from '@/agent/FormFillEngine'` 拆为：

```ts
import { fuzzyMatchField } from '@/agent/pipeline/fuzzy'
import { executeFormFill } from '@/agent/FormFillEngine'
```

- [ ] **Step 4: `FormFillEngine.ts` 删除 4 个 fuzzy 函数**

删除 `src/agent/FormFillEngine.ts:22-103`（tokenize/tokenSimilarity/matchesField/fuzzyMatchField 四个函数整体）。核查 FormFillEngine.ts 顶部 import：`FormAnalysisResult`（:9）若仅被这 4 函数使用则一并删除（grep 确认 FormFillEngine.ts 内零 `FormAnalysisResult` 引用后删）；`callLLM`（:13）、`matchFields`（:16）等仍被 buildRealDeps/executeFormFill 用，保留。

- [ ] **Step 5: 断环验证 + tsc + 测试**

Run: `grep -rn "from '@/agent/FormFillEngine'" extension/src/agent/pipeline/` → **无输出**（match.ts 不再反向依赖 FormFillEngine）。
Run: `pnpm exec tsc --noEmit` → 净零新增。
Run: `pnpm test` → 336 全绿（既有 fuzzyMatchField 用例 import 改源头后仍过，证明搬运等价）。

- [ ] **Step 6: 提交**

```bash
git add src/agent/pipeline/fuzzy.ts src/agent/pipeline/match.ts src/agent/FormFillEngine.ts src/__tests__/FormFillEngine.test.ts
git commit -m "refactor(pipeline): fuzzy 函数下沉到 pipeline/fuzzy.ts，斩断 match↔FormFillEngine 循环依赖"
```

---

## Task 2: `pipeline/site-type.ts`（策略对象 + helper）+ 单测

**Files:**
- Create: `src/agent/pipeline/site-type.ts`
- Create: `src/agent/pipeline/__tests__/site-type.test.ts`

**Interfaces:**
- Produces: `SiteTypeStrategy`、`SystemPromptCtx`、`SITE_TYPE_STRATEGIES: Record<SiteType, SiteTypeStrategy>`、`siteTypeFromCategory(category) => SiteType`。

- [ ] **Step 1: 写 `pipeline/site-type.ts`**

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

- [ ] **Step 2: 写 `site-type.test.ts`**

```ts
// src/agent/pipeline/__tests__/site-type.test.ts
import { describe, it, expect } from 'vitest'
import { SITE_TYPE_STRATEGIES, siteTypeFromCategory } from '@/agent/pipeline/site-type'

const mkCtx = (over: any = {}) => ({
  productContext: 'pc',
  pageInfo: { title: 't', description: 'd', headings: [], content_preview: '' },
  fields: [],
  forms: [],
  ...over,
})

describe('SITE_TYPE_STRATEGIES', () => {
  it('blog_comment: label/temperature/autoSubmit 正确', () => {
    const s = SITE_TYPE_STRATEGIES.blog_comment
    expect(s.label).toBe('博客评论')
    expect(s.temperature).toBe(0.7)
    expect(s.autoSubmit).toBe(true)
  })

  it('directory_submit: label/temperature/autoSubmit 正确', () => {
    const s = SITE_TYPE_STRATEGIES.directory_submit
    expect(s.label).toBe('目录提交')
    expect(s.temperature).toBe(0.3)
    expect(s.autoSubmit).toBe(false)
  })

  it('blog buildUserPrompt 含 "comment form"', () => {
    const s = SITE_TYPE_STRATEGIES.blog_comment
    expect(s.buildUserPrompt({ name: 'S', submit_url: 'https://x' } as any)).toContain('comment form')
  })

  it('directory buildUserPrompt 含 "submission form"', () => {
    const s = SITE_TYPE_STRATEGIES.directory_submit
    expect(s.buildUserPrompt({ name: 'S', submit_url: 'https://x' } as any)).toContain('submission form')
  })

  it('blog buildSystemPrompt 有 pageContent → 返回非空（走 buildBlogCommentPrompt）', () => {
    const s = SITE_TYPE_STRATEGIES.blog_comment
    const prompt = s.buildSystemPrompt(mkCtx({ pageContent: { title: 'pc', paragraphs: [], headings: [] } as any }))
    expect(typeof prompt).toBe('string')
    expect(prompt.length).toBeGreaterThan(0)
  })

  it('blog buildSystemPrompt 无 pageContent → 仍返回非空（回退 directory prompt）', () => {
    const s = SITE_TYPE_STRATEGIES.blog_comment
    const prompt = s.buildSystemPrompt(mkCtx())  // 无 pageContent
    expect(typeof prompt).toBe('string')
    expect(prompt.length).toBeGreaterThan(0)
  })

  it('directory buildSystemPrompt → 返回非空', () => {
    const s = SITE_TYPE_STRATEGIES.directory_submit
    const prompt = s.buildSystemPrompt(mkCtx())
    expect(prompt.length).toBeGreaterThan(0)
  })

  it('Record 完备性：每个 SiteType 都有策略', () => {
    const types: import('@/agent/types').SiteType[] = ['blog_comment', 'directory_submit']
    for (const t of types) {
      expect(SITE_TYPE_STRATEGIES[t]).toBeDefined()
    }
  })
})

describe('siteTypeFromCategory', () => {
  it('blog_comment category → blog_comment siteType', () => {
    expect(siteTypeFromCategory('blog_comment')).toBe('blog_comment')
  })
  it('其它 category（ai_directory/others）→ directory_submit', () => {
    expect(siteTypeFromCategory('ai_directory')).toBe('directory_submit')
    expect(siteTypeFromCategory('others')).toBe('directory_submit')
  })
})
```

- [ ] **Step 3: 跑测试确认通过**

Run: `pnpm test -- src/agent/pipeline/__tests__/site-type.test.ts` → PASS（10 tests）

- [ ] **Step 4: tsc + 全量测试**

Run: `pnpm exec tsc --noEmit` → 净零新增。Run: `pnpm test` → 336 + 10 = 346 全绿。

- [ ] **Step 5: 提交**

```bash
git add src/agent/pipeline/site-type.ts src/agent/pipeline/__tests__/site-type.test.ts
git commit -m "refactor(pipeline): 新增 SITE_TYPE_STRATEGIES 配置 + siteTypeFromCategory helper"
```

---

## Task 3: llmPhase 改用策略（消除 4 处 siteType 分支）

**Files:**
- Modify: `src/agent/pipeline/llm.ts`（整段重写 prompt 构建 + callLLM，消除 4 分支）

**Interfaces:**
- Consumes: `SITE_TYPE_STRATEGIES`（T2）。
- Produces: llmPhase 内部零 `siteType === 'blog_comment'` 分支。

- [ ] **Step 1: 重写 `pipeline/llm.ts`**

替换整个文件为：

```ts
// src/agent/pipeline/llm.ts
import type { FieldValueMap, LLMFieldValue } from '@/agent/types'
import { parseLLMJson, injectHrefNewline } from '@/agent/llm-utils'
import { buildProductContext, pickAnchorText, pickFounderName } from '@/agent/prompts/product-context'
import { SITE_TYPE_STRATEGIES } from './site-type'
import type { FormFillDeps, LlmPhaseInput } from './types'

/**
 * 建 prompt → callLLM → parse → injectHrefNewline → 触发 onLLMFields。返回 fieldValues。
 * prompt 选择/temperature/label 走 SITE_TYPE_STRATEGIES（消除 siteType 分支）。
 */
export async function llmPhase(deps: FormFillDeps, input: LlmPhaseInput): Promise<FieldValueMap> {
  const { analysis, pageContent, product, site, siteType, signal } = input
  const strategy = SITE_TYPE_STRATEGIES[siteType]

  // Step 2: build prompt
  const selectedAnchor = pickAnchorText(product)
  const selectedFounderName = pickFounderName(product)
  const productContext = buildProductContext(product, selectedAnchor, selectedFounderName)
  const systemPrompt = strategy.buildSystemPrompt({
    productContext,
    pageContent,
    pageInfo: analysis.page_info,
    fields: analysis.fields,
    forms: analysis.forms,
  })
  const userPrompt = strategy.buildUserPrompt(site)

  deps.log('info', 'llm', `正在调用 LLM (${strategy.label})...`, {
    systemPromptLength: systemPrompt.length,
    userPromptLength: userPrompt.length,
    systemPrompt,
    userPrompt,
    fieldCount: analysis.fields.length,
  })

  const rawResponse = await deps.callLLM({
    systemPrompt,
    userPrompt,
    temperature: strategy.temperature,
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

> 移除了 `buildBlogCommentPrompt`/`buildDirectorySubmitPrompt` 直接 import（它们进 site-type.ts）；FieldValueMap/LLMFieldValue 合并为同源 import（顺带清 SP-2 的 M1 风格项）。

- [ ] **Step 2: 更新 llm.test.ts（temperature 断言走 strategy，仍可直接断言值）**

`src/agent/pipeline/__tests__/llm.test.ts` 既有用例（blog temperature 0.7、directory 0.3、jsonMode/maxTokens、onLLMFields 触发）应继续过（断言的是 callLLM 收到的 temperature 值，策略化后值不变）。**不需改测试**——跑确认通过即可。若某用例因 mock fixture 缺字段（如 pageContent）失败，按 SP-2 T3 同样方式补 mock 数据。

- [ ] **Step 3: tsc + 全量测试**

Run: `pnpm exec tsc --noEmit` → 净零新增。Run: `pnpm test` → 346 全绿（llm.test 既有用例不变）。
Run: `grep -n "siteType === 'blog_comment'" extension/src/agent/pipeline/llm.ts` → **无输出**（4 处分支全消除）。

- [ ] **Step 4: 提交**

```bash
git add src/agent/pipeline/llm.ts
git commit -m "refactor(pipeline): llmPhase 改用 SITE_TYPE_STRATEGIES，消除 4 处 siteType 分支"
```

---

## Task 4: executeFormFill submit + useFormFillEngine 用策略/helper

**Files:**
- Modify: `src/agent/FormFillEngine.ts`（submit 分支条件）
- Modify: `src/hooks/useFormFillEngine.ts:85,158`（两处 category→siteType 映射）

**Interfaces:**
- Consumes: `SITE_TYPE_STRATEGIES`、`siteTypeFromCategory`（T2）。

- [ ] **Step 1: executeFormFill submit 分支用 autoSubmit**

在 `src/agent/FormFillEngine.ts` 顶部加 import：`import { SITE_TYPE_STRATEGIES } from './pipeline/site-type'`。

找到 submit 分支条件（原 `if (siteType === 'blog_comment' && failedCount === 0 && filledCount > 0)`，SP-2 后在 executeFormFill 内），改为：

```ts
		if (SITE_TYPE_STRATEGIES[siteType].autoSubmit && failedCount === 0 && filledCount > 0) {
```

- [ ] **Step 2: useFormFillEngine 两处用 siteTypeFromCategory**

在 `src/hooks/useFormFillEngine.ts` 顶部加 import：`import { siteTypeFromCategory } from '@/agent/pipeline/site-type'`。

把 `:85` 的 `const siteType: SiteType = site.category === 'blog_comment' ? 'blog_comment' : 'directory_submit'` 改为：

```ts
				const siteType = siteTypeFromCategory(site.category)
```

把 `:158` 的同样映射同样改为 `const siteType = siteTypeFromCategory(site.category)`。

> 若 `SiteType` 类型 import 在 useFormFillEngine.ts 内仅用于这两处声明，删除后改用 helper 推断类型（siteTypeFromCategory 返回 SiteType）；若 SiteType 仍在别处用则保留 import。grep 确认。

- [ ] **Step 3: tsc + 全量测试**

Run: `pnpm exec tsc --noEmit` → 净零新增。Run: `pnpm test` → 346 全绿（executeFormFill e2e 的 directory 不提交用例由 strategy.autoSubmit=false 守卫，仍过）。
Run: `grep -n "category === 'blog_comment'" extension/src/hooks/useFormFillEngine.ts` → **无输出**（2 处重复消除）。

- [ ] **Step 4: 提交**

```bash
git add src/agent/FormFillEngine.ts src/hooks/useFormFillEngine.ts
git commit -m "refactor(pipeline): submit 用 strategy.autoSubmit，useFormFillEngine 用 siteTypeFromCategory"
```

---

## Task 5: 清理 + 回归 + 手动验证

**Files:**
- Modify: `src/agent/FormFillEngine.ts`（清理 fuzzy 删除后可能残留的 import）

**Interfaces:**
- Consumes: 全部前置任务。

- [ ] **Step 1: 清理 FormFillEngine.ts 残留 import**

grep `FormFillEngine.ts` 的 import 区，确认 T1 删 fuzzy 后无 orphan（`FormAnalysisResult` 若零引用则删；`SiteType` 若仅 submit 分支用现在改 strategy 则可能仍用——核查）。tsc 是最终守门。

- [ ] **Step 2: 终态校验（对照 spec §6 验收）**

- Run: `grep -rn "from '@/agent/FormFillEngine'" extension/src/agent/pipeline/` → 无输出 ✅（断环）
- Run: `grep -n "siteType === 'blog_comment'" extension/src/agent/pipeline/llm.ts` → 无输出 ✅
- Run: `grep -n "category === 'blog_comment'" extension/src/hooks/useFormFillEngine.ts` → 无输出 ✅
- Run: `grep -n "function tokenize\|function tokenSimilarity\|function matchesField\|function fuzzyMatchField" extension/src/agent/FormFillEngine.ts` → 无输出 ✅（fuzzy 已移走）
- Run: `pnpm exec tsc --noEmit` → 净零新增 ✅
- Run: `pnpm test` → 全绿（346）✅

- [ ] **Step 3: 手动验证（交付用户）**

`pnpm build` 加载扩展，真实站点验证：WP 博客评论自动提交（blog_comment → autoSubmit=true，温度 0.7，blog prompt）、directory 站点填充不自动提交（autoSubmit=false，温度 0.3，directory prompt）、Abort 中断。Expected: 与 SP-2 后一致（策略化是搬运，行为等价）。

- [ ] **Step 4: 提交（若 Step 1 有清理）**

```bash
git add src/agent/FormFillEngine.ts
git commit -m "refactor(pipeline): SP-3a 收尾清理 orphan import"
```
> 若 Step 1 无可清，跳过本步。

---

## Self-Review 笔记

**Spec 覆盖**：
- G1 7 处 siteType 分支收敛 → T2(策略定义)+T3(llmPhase 4处)+T4(executeFormFill 1处 + useFormFillEngine 2处) ✅
- G2 fuzzy 下沉斩环 → T1 ✅
- G3 行为等价 → 各任务「搬运」+ 既有测试守门 ✅

**类型一致性**：`SiteTypeStrategy{label,temperature,buildSystemPrompt(ctx),buildUserPrompt(site),autoSubmit}` 在 T2 定义、T3 消费（strategy.label/temperature/buildSystemPrompt/buildUserPrompt）、T4 消费（strategy.autoSubmit）一致；`SystemPromptCtx{productContext,pageContent?,pageInfo,fields,forms}` 一致；`siteTypeFromCategory(category)=>SiteType` 一致；`fuzzyMatchField` 签名 T1 不变。

**风险已处理**：
- fuzzy 搬运逐字（T1 Step 1 含完整 4 函数代码）+ 既有 fuzzyMatchField 测试守门 ✅
- pageContent 回退在 blog 策略 buildSystemPrompt 内保留 + site-type.test 显式覆盖 ✅
- 断环用 grep 验证（match.ts 不再 import FormFillEngine）✅
- Record 完备性：site-type.test 的「每 SiteType 有策略」+ compiler（新增 type 缺策略即报错）✅

**后续衔接**：策略对象为首个新 siteType（forum_post 等）验证扩展性；SP-3b 处理 dom-utils/字段去重；P0 仍延后。
