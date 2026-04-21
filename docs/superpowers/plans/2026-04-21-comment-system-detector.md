# 评论系统检测器 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在外链分析中增加 Disqus、Giscus、Utterances、Facebook Comments 四个第三方评论系统的检测，检测结果参与 canComment 判断和置信度评分。

**Architecture:** 注册式检测器模式。新建 `comment-system-detector.ts` 定义检测器数组，每个系统为一个 `{ name, selectors, boost }` 对象。`analyzeForms()` 在 content script 中调用检测器，结果通过 `FormAnalysisResult` 传递到 `backlink-analyzer.ts` 参与置信度计算。

**Tech Stack:** TypeScript, Vitest, Chrome Extension (content script + sidepanel)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `extension/src/agent/form-analyzer/comment-system-detector.ts` | Create | 检测器注册表 + `detectCommentSystem()` 函数 |
| `extension/src/agent/form-analyzer/types.ts` | Modify | 新增 `CommentSystemResult` 类型 |
| `extension/src/agent/form-analyzer/index.ts` | Modify | 调用检测器 + re-export |
| `extension/src/lib/types.ts` | Modify | `BacklinkAnalysisResult` 新增 `commentSystem` 字段 |
| `extension/src/lib/backlink-analyzer.ts` | Modify | 读取检测结果，参与置信度评分 |
| `extension/src/hooks/useBacklinkAnalysis.ts` | Modify | 在 analysisLog 中输出评论系统 |
| `extension/src/__tests__/comment-system-detector.test.ts` | Create | 检测器单元测试 |
| `extension/src/__tests__/backlink-analyzer.test.ts` | Modify | 新增评论系统置信度测试 |

---

### Task 1: 新增类型定义

**Files:**
- Modify: `extension/src/agent/form-analyzer/types.ts` (末尾追加)
- Modify: `extension/src/lib/types.ts:134-141`

- [ ] **Step 1: 在 `form-analyzer/types.ts` 末尾添加 `CommentSystemResult` 类型**

在文件末尾（第 49 行之后）追加：

```ts
export interface CommentSystemResult {
  name: string
  boost: number
}
```

- [ ] **Step 2: 在 `lib/types.ts` 的 `BacklinkAnalysisResult` 中新增 `commentSystem` 字段**

在第 140 行 `confidence: number` 之后、第 141 行 `}` 之前插入：

```ts
		commentSystem?: string
```

完整的 `BacklinkAnalysisResult` 应为：

```ts
export interface BacklinkAnalysisResult {
		canComment: boolean
		summary: string
		formType: 'blog_comment' | 'directory' | 'contact_form' | 'forum' | 'none'
		cmsType: 'wordpress' | 'blogger' | 'discuz' | 'custom' | 'unknown'
		detectedFields: string[]
		confidence: number
		commentSystem?: string
}
```

- [ ] **Step 3: Commit**

```bash
git add extension/src/agent/form-analyzer/types.ts extension/src/lib/types.ts
git commit -m "feat: 新增 CommentSystemResult 类型和 BacklinkAnalysisResult.commentSystem 字段"
```

---

### Task 2: 创建评论系统检测器

**Files:**
- Create: `extension/src/agent/form-analyzer/comment-system-detector.ts`
- Create: `extension/src/__tests__/comment-system-detector.test.ts`

- [ ] **Step 1: 编写检测器失败的测试**

创建 `extension/src/__tests__/comment-system-detector.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { detectCommentSystem } from '@/agent/form-analyzer/comment-system-detector'

function createDoc(html: string): Document {
  const doc = document.implementation.createHTMLDocument()
  doc.body.innerHTML = html
  return doc
}

describe('detectCommentSystem', () => {
  it('无评论系统时返回 null', () => {
    const doc = createDoc('<div>Hello</div>')
    expect(detectCommentSystem(doc)).toBeNull()
  })

  it('检测到 Disqus 容器', () => {
    const doc = createDoc('<div id="disqus_thread"></div>')
    const result = detectCommentSystem(doc)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('disqus')
  })

  it('检测到 Disqus iframe', () => {
    const doc = createDoc('<iframe src="https://disqus.com/embed/comments"></iframe>')
    const result = detectCommentSystem(doc)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('disqus')
  })

  it('检测到 Giscus 自定义元素', () => {
    const doc = createDoc('<giscus-widget></giscus-widget>')
    const result = detectCommentSystem(doc)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('giscus')
  })

  it('检测到 Giscus iframe', () => {
    const doc = createDoc('<iframe src="https://giscus.app/widget"></iframe>')
    const result = detectCommentSystem(doc)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('giscus')
  })

  it('检测到 Utterances iframe', () => {
    const doc = createDoc('<iframe src="https://utteranc.es/abc"></iframe>')
    const result = detectCommentSystem(doc)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('utterances')
  })

  it('检测到 Facebook Comments', () => {
    const doc = createDoc('<div class="fb-comments"></div>')
    const result = detectCommentSystem(doc)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('facebook')
  })

  it('检测到 Facebook Comments iframe', () => {
    const doc = createDoc('<iframe src="https://www.facebook.com/plugins/comments.php"></iframe>')
    const result = detectCommentSystem(doc)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('facebook')
  })

  it('多个系统同时存在时返回优先级最高的（按注册顺序）', () => {
    const doc = createDoc(`
      <div id="disqus_thread"></div>
      <iframe src="https://utteranc.es/abc"></iframe>
    `)
    const result = detectCommentSystem(doc)
    expect(result!.name).toBe('disqus')
  })

  it('检测结果包含 boost 值', () => {
    const doc = createDoc('<div id="disqus_thread"></div>')
    const result = detectCommentSystem(doc)
    expect(result!.boost).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run extension/src/__tests__/comment-system-detector.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 创建检测器实现**

创建 `extension/src/agent/form-analyzer/comment-system-detector.ts`：

```ts
import type { CommentSystemResult } from './types'

interface CommentSystemDetector {
  name: string
  selectors: string[]
  boost: number
}

const COMMENT_SYSTEM_DETECTORS: CommentSystemDetector[] = [
  {
    name: 'disqus',
    selectors: ['#disqus_thread', 'iframe[src*="disqus.com"]'],
    boost: 0.20,
  },
  {
    name: 'giscus',
    selectors: ['giscus-widget', 'iframe[src*="giscus.app"]'],
    boost: 0.20,
  },
  {
    name: 'utterances',
    selectors: ['iframe[src*="utteranc.es"]'],
    boost: 0.20,
  },
  {
    name: 'facebook',
    selectors: ['.fb-comments', 'iframe[src*="facebook.com/plugins/comments"]'],
    boost: 0.15,
  },
]

export function detectCommentSystem(doc: Document): CommentSystemResult | null {
  for (const detector of COMMENT_SYSTEM_DETECTORS) {
    for (const selector of detector.selectors) {
      if (doc.querySelector(selector)) {
        return { name: detector.name, boost: detector.boost }
      }
    }
  }
  return null
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run extension/src/__tests__/comment-system-detector.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add extension/src/agent/form-analyzer/comment-system-detector.ts extension/src/__tests__/comment-system-detector.test.ts
git commit -m "feat: 创建评论系统检测器，支持 Disqus/Giscus/Utterances/Facebook Comments"
```

---

### Task 3: 集成检测器到 analyzeForms

**Files:**
- Modify: `extension/src/agent/form-analyzer/index.ts`
- Modify: `extension/src/agent/form-analyzer/types.ts:25-30`

- [ ] **Step 1: 在 `FormAnalysisResult` 中新增 `commentSystem` 字段**

修改 `extension/src/agent/form-analyzer/types.ts`，在 `FormAnalysisResult` 的 `commentLinks` 字段后新增：

```ts
  commentSystem?: CommentSystemResult
```

完整的 `FormAnalysisResult` 应为：

```ts
export interface FormAnalysisResult {
  fields: FormField[];
  forms: FormGroup[];
  page_info: PageInfo;
  commentLinks?: CommentLinkResult;
  commentSystem?: CommentSystemResult;
}
```

- [ ] **Step 2: 在 `form-analyzer/index.ts` 中调用检测器并 re-export**

在 `extension/src/agent/form-analyzer/index.ts` 中：

1. 添加 import（第 6 行后）：
```ts
import { detectCommentSystem } from './comment-system-detector';
```

2. 添加 re-export（第 13 行后，`export { detectCommentLinks } from './comment-links'` 之后）：
```ts
export { detectCommentSystem } from './comment-system-detector'
```

3. 在 `analyzeForms()` 的 return 对象中（约第 160-166 行），在 `commentLinks` 之后添加：
```ts
    commentSystem: detectCommentSystem(doc),
```

完整的 return 语句应为：

```ts
  return {
    fields: deduplicateFields(fields),
    forms: formGroups,
    page_info: extractPageInfo(doc),
    commentLinks: detectCommentLinks(doc),
    commentSystem: detectCommentSystem(doc),
  }
```

- [ ] **Step 3: 运行 build 确认编译通过**

Run: `npm run build`
Expected: 构建成功，无类型错误

- [ ] **Step 4: Commit**

```bash
git add extension/src/agent/form-analyzer/index.ts extension/src/agent/form-analyzer/types.ts
git commit -m "feat: 将评论系统检测器集成到 analyzeForms 流程"
```

---

### Task 4: 集成到置信度评分和 backlink-analyzer

**Files:**
- Modify: `extension/src/lib/backlink-analyzer.ts`
- Modify: `extension/src/__tests__/backlink-analyzer.test.ts`

- [ ] **Step 1: 编写评论系统置信度测试**

在 `extension/src/__tests__/backlink-analyzer.test.ts` 末尾（第 214 行 `})` 之后）追加：

```ts

describe('评论系统信号', () => {
  it('commentSystem 为 disqus 时 confidence 加 0.20', () => {
    const without = calculateConfidence({
      forms: [],
      fields: [],
      cmsType: 'unknown',
    })
    const withSystem = calculateConfidence({
      forms: [],
      fields: [],
      cmsType: 'unknown',
      commentSystem: 'disqus',
    })
    expect(withSystem - without).toBeCloseTo(0.20, 1)
  })

  it('commentSystem 为 unknown 时不影响 confidence', () => {
    const without = calculateConfidence({
      forms: [],
      fields: [],
      cmsType: 'unknown',
    })
    const withUnknown = calculateConfidence({
      forms: [],
      fields: [],
      cmsType: 'unknown',
      commentSystem: 'unknown',
    })
    expect(withUnknown).toBe(without)
  })

  it('commentSystem 与其他信号叠加', () => {
    const result = calculateConfidence({
      forms: [makeForm({ form_index: 0, filtered: false })],
      fields: [makeField({ name: 'comment', tagName: 'textarea', label: 'Comment' })],
      cmsType: 'wordpress',
      commentSystem: 'disqus',
    })
    // 0.2(form) + 0.15(textarea) + 0.2(comment) + 0.15(cms) + 0.2(commentSystem) = 0.9
    expect(result).toBeCloseTo(0.9, 1)
  })
})
```

- [ ] **Step 2: 运行测试确认新测试通过（旧测试不受影响）**

Run: `npx vitest run extension/src/__tests__/backlink-analyzer.test.ts`
Expected: 评论系统信号测试 FAIL（`ConfidenceInput` 尚无 `commentSystem` 字段），其余 PASS

- [ ] **Step 3: 修改 `ConfidenceInput` 接口添加 `commentSystem` 字段**

在 `extension/src/lib/backlink-analyzer.ts` 第 108-113 行，修改 `ConfidenceInput` 接口：

```ts
interface ConfidenceInput {
  forms: FormGroup[]
  fields: FormField[]
  cmsType: string
  hasCommentExternalLinks?: boolean
  commentSystem?: string
}
```

- [ ] **Step 4: 在 `calculateConfidence` 中添加评论系统评分逻辑**

在 `extension/src/lib/backlink-analyzer.ts` 的 `calculateConfidence` 函数中（约第 136 行 `if (input.hasCommentExternalLinks) confidence += 0.25` 之后），添加：

```ts
  if (input.commentSystem && input.commentSystem !== 'unknown') confidence += 0.20
```

- [ ] **Step 5: 在 `analyzeBacklink` 中读取检测结果并传递给置信度计算**

在 `extension/src/lib/backlink-analyzer.ts` 的 `analyzeBacklink` 函数中：

1. 在第 70 行 CMS 检测之后，添加评论系统读取：
```ts
  // Detect comment system (Disqus, Giscus, etc.)
  const commentSystem = analysis.commentSystem?.name
```

2. 修改第 81-86 行的 `calculateConfidence` 调用，加入 `commentSystem`：
```ts
  const confidence = calculateConfidence({
    forms: analysis.forms,
    fields: allFields,
    cmsType,
    hasCommentExternalLinks,
    commentSystem,
  })
```

3. 修改第 88-99 行的 `result` 对象，加入 `commentSystem`：
```ts
  const result: BacklinkAnalysisResult = {
    canComment,
    summary: canComment
      ? hasCommentExternalLinks
        ? '检测到评论外链（无需可见表单）'
        : '检测到评论表单'
      : '未发现评论表单',
    formType,
    cmsType,
    detectedFields,
    confidence,
    commentSystem,
  }
```

4. 更新日志输出（第 102 行），在现有日志后追加评论系统信息：
```ts
  log(level, 'analyze', `判定: ${result.canComment ? '可发布' : '不可发布'} (信心度: ${(result.confidence * 100).toFixed(0)}%)${commentSystem ? ` [${commentSystem}]` : ''}`, result)
```

- [ ] **Step 6: 运行全部 backlink-analyzer 测试**

Run: `npx vitest run extension/src/__tests__/backlink-analyzer.test.ts`
Expected: 全部 PASS

- [ ] **Step 7: Commit**

```bash
git add extension/src/lib/backlink-analyzer.ts extension/src/__tests__/backlink-analyzer.test.ts
git commit -m "feat: 评论系统检测参与 canComment 置信度评分"
```

---

### Task 5: 更新 UI 日志输出

**Files:**
- Modify: `extension/src/hooks/useBacklinkAnalysis.ts:53-58`

- [ ] **Step 1: 在 analysisLog 中加入评论系统信息**

修改 `extension/src/hooks/useBacklinkAnalysis.ts` 第 53-58 行的 `analysisLog` 数组：

```ts
				const analysisLog = [
					result.summary,
					`表单类型: ${result.formType}`,
					`CMS: ${result.cmsType}`,
					...(result.commentSystem ? [`评论系统: ${result.commentSystem}`] : []),
					`信心度: ${(result.confidence * 100).toFixed(0)}%`,
				]
```

- [ ] **Step 2: 运行 build 确认编译通过**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 3: Commit**

```bash
git add extension/src/hooks/useBacklinkAnalysis.ts
git commit -m "feat: 在分析日志中展示检测到的评论系统名称"
```

---

### Task 6: 最终验证

- [ ] **Step 1: 运行全部测试**

Run: `npx vitest run`
Expected: 全部 PASS

- [ ] **Step 2: 运行 build**

Run: `npm run build`
Expected: 构建成功，无错误

- [ ] **Step 3: 删除计划文件（如 CLAUDE.md 要求）**

设计文档和计划文件保留在 `docs/superpowers/` 中作为记录。
