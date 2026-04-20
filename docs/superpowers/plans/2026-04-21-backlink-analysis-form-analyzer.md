# 外链分析改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 改造外链分析流程，复用 FormAnalyzer 进行精确表单检测，并加入实时日志面板。

**Architecture:** 外链分析改为通过 background 打开隐藏 Tab → Content Script 执行 FormAnalyzer → 返回结构化结果 → sidepanel 构建新 prompt 调用 LLM。日志系统复用现有 LogEntry 类型和 ActivityLog 组件，通过 onLog 回调集成到 useBacklinkAgent。

**Tech Stack:** React, TypeScript, WXT (Chrome Extension MV3), IndexedDB, OpenAI-compatible LLM API

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `extension/src/lib/backlink-analyzer.ts` | Rewrite | 移除正则分析，改为接收 FormAnalysisResult + PageContent，构建新 prompt |
| `extension/src/entrypoints/background.ts` | Modify | `handleFetchPageContent` 改为返回 analysis + pageContent |
| `extension/src/hooks/useBacklinkAgent.ts` | Modify | 添加 logs state + clearLogs，传递 onLog 给 analyzer |
| `extension/src/lib/types.ts` | Modify | BacklinkRecord 新增可选 analysisResult 字段 |
| `extension/src/components/BacklinkAnalysis.tsx` | Modify | Header 添加日志图标，底部添加滑出日志面板 |
| `extension/src/entrypoints/sidepanel/App.tsx` | Modify | 传递 logs + clearLogs props |
| `extension/src/agent/llm-utils.ts` | No change | 已有 callLLM 和 parseLLMJson，直接复用 |

---

### Task 1: 扩展 BacklinkRecord 类型

**Files:**
- Modify: `extension/src/lib/types.ts:133-143`

- [ ] **Step 1: 添加 BacklinkAnalysisResult 类型和扩展 BacklinkRecord**

在 `extension/src/lib/types.ts` 中，在 `BacklinkStatus` 之后、`BacklinkRecord` 之前添加：

```typescript
/** Extended analysis result from LLM for backlink suitability */
export interface BacklinkAnalysisResult {
  canComment: boolean
  summary: string
  formType: 'blog_comment' | 'directory' | 'contact_form' | 'forum' | 'none'
  cmsType: 'wordpress' | 'blogger' | 'discuz' | 'custom' | 'unknown'
  detectedFields: string[]
  confidence: number
}
```

然后修改 `BacklinkRecord`，添加可选字段：

```typescript
export interface BacklinkRecord {
  id: string
  sourceUrl: string
  sourceTitle: string
  pageAscore: number
  status: BacklinkStatus
  analysisLog: string[]
  analysisResult?: BacklinkAnalysisResult
  domain?: string
  createdAt: number
  updatedAt: number
}
```

- [ ] **Step 2: 验证编译**

Run: `cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent && npm run build 2>&1 | head -40`
Expected: 编译成功（新字段为可选，不影响现有代码）

- [ ] **Step 3: Commit**

```bash
git add extension/src/lib/types.ts
git commit -m "feat(backlink): 添加 BacklinkAnalysisResult 扩展类型"
```

---

### Task 2: 重写 backlink-analyzer.ts

**Files:**
- Rewrite: `extension/src/lib/backlink-analyzer.ts`

这是核心改动。移除所有正则分析代码，改为：
1. 发送 `FETCH_PAGE_CONTENT` 到 background
2. 接收 `FormAnalysisResult + PageContent`
3. 构建新的 LLM prompt
4. 调用 LLM 返回 `BacklinkAnalysisResult`
5. 通过 `onLog` 回调生成日志

- [ ] **Step 1: 完整重写 backlink-analyzer.ts**

用以下内容替换 `extension/src/lib/backlink-analyzer.ts` 的全部内容：

```typescript
import type { LLMSettings } from './types'
import type { BacklinkAnalysisResult } from './types'
import type { FormAnalysisResult } from '@/agent/FormAnalyzer'
import type { PageContent } from '@/agent/PageContentExtractor'
import type { LogEntry, LogLevel } from '@/agent/types'
import { getLLMConfig } from './storage'
import { callLLM, parseLLMJson } from '@/agent/llm-utils'
import { buildFieldList } from '@/agent/FormAnalyzer'

export type AnalysisStep = 'loading' | 'analyzing' | 'done'

const SYSTEM_PROMPT = `You are a Backlink Analyzer. You receive structured form analysis data from a webpage. Determine if this page is suitable for posting a comment with a backlink.

Return ONLY valid JSON:
{
  "canComment": true/false,
  "summary": "简短结论，不超过15个汉字",
  "formType": "blog_comment" | "directory" | "contact_form" | "forum" | "none",
  "cmsType": "wordpress" | "blogger" | "discuz" | "custom" | "unknown",
  "detectedFields": ["field_name_1", "field_name_2"],
  "confidence": 0.0-1.0
}

Rules:
- canComment: true if there is a comment/reply form with fields like name, email, URL/website, and a textarea for the comment body. The form must allow user submission.
- formType: classify the primary form found on the page
- cmsType: detect the CMS from HTML patterns (wp-content/wp-includes = wordpress, blogger.com = blogger, wpdiscuz = discuz, etc.)
- detectedFields: list the inferred purposes of detected fields (e.g. "name", "email", "url", "comment", "website")
- confidence: your confidence in the canComment judgment (0.0 = pure guess, 1.0 = absolutely certain)
- summary: MUST be in Chinese (简体中文), ultra-short conclusion within 15 characters
- Return ONLY the JSON object, no markdown fences`

export interface AnalyzeBacklinkOptions {
  url: string
  signal?: AbortSignal
  onProgress?: (step: AnalysisStep) => void
  onLog?: (entry: LogEntry) => void
}

export async function analyzeBacklink(
  options: AnalyzeBacklinkOptions
): Promise<BacklinkAnalysisResult> {
  const { url, signal, onProgress, onLog } = options
  let logId = 0
  const log = (level: LogLevel, phase: LogEntry['phase'], message: string, data?: unknown) => {
    onLog?.({ id: ++logId, timestamp: Date.now(), level, phase, message, data })
  }

  const config: LLMSettings = await getLLMConfig()
  if (!config.baseUrl) throw new Error('LLM 未配置，请在设置中填写 Base URL')
  if (!config.model) throw new Error('模型未配置，请在设置中填写模型名称')

  // Step 1: Fetch form analysis via background service worker
  onProgress?.('loading')
  log('info', 'analyze', '正在获取页面内容...')

  const fetchResponse = await chrome.runtime.sendMessage({
    type: 'FETCH_PAGE_CONTENT',
    url,
  })

  if (!fetchResponse?.ok) {
    throw new Error(fetchResponse?.error || `无法获取页面内容: ${url}`)
  }

  const analysis: FormAnalysisResult = fetchResponse.analysis
  const pageContent: PageContent | undefined = fetchResponse.pageContent

  const unfilteredForms = analysis.forms.filter(f => !f.filtered)
  const commentFields = analysis.fields.filter(f => {
    const p = (f.inferred_purpose || f.label || f.name || '').toLowerCase()
    return p.includes('comment') || p.includes('message') || p.includes('reply')
      || p.includes('url') || p.includes('website') || p.includes('site')
  })

  log('info', 'analyze', `表单分析完成 — 发现 ${unfilteredForms.length} 个表单, ${analysis.fields.length} 个字段`, {
    forms: unfilteredForms.length,
    fields: analysis.fields.length,
    commentFields: commentFields.length,
  })

  if (commentFields.length > 0) {
    const cmsGuess = analysis.page_info.title?.toLowerCase().includes('wordpress')
      || (analysis.forms.some(f => f.form_action?.includes('wp-comments-post')))
      ? 'WordPress' : 'unknown'
    log('success', 'analyze', `检测到评论相关字段 (${cmsGuess})`, {
      fields: commentFields.map(f => f.inferred_purpose || f.label || f.name),
    })
  } else if (analysis.fields.length === 0) {
    log('warning', 'analyze', '未发现任何表单字段')
  } else {
    log('warning', 'analyze', '未发现评论相关字段')
  }

  // Step 2: Build prompt and call LLM
  onProgress?.('analyzing')
  log('info', 'llm', '正在分析页面适配性...')

  const fieldList = buildFieldList(analysis.fields, analysis.forms)
  const pageSection = pageContent
    ? [
        `**Title:** ${pageContent.title}`,
        pageContent.description ? `**Description:** ${pageContent.description}` : '',
        pageContent.headings.length > 0 ? `**Headings:**\n${pageContent.headings.slice(0, 10).join('\n')}` : '',
        '**Content Preview:**',
        pageContent.content_preview.slice(0, 2000),
      ].filter(Boolean).join('\n')
    : `**Title:** ${analysis.page_info.title}`

  const userPrompt = [
    `URL: ${url}`,
    '',
    '## Page Content',
    pageSection,
    '',
    '## Detected Form Fields',
    fieldList,
    '',
    'Analyze this page for backlink opportunities. Can we submit a comment with a URL field?',
  ].join('\n')

  const rawResponse = await callLLM({
    config,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    temperature: 0.3,
    maxTokens: 512,
    signal,
  })

  const parsed = parseLLMJson(rawResponse) as BacklinkAnalysisResult

  // Validate required fields with defaults
  const result: BacklinkAnalysisResult = {
    canComment: !!parsed.canComment,
    summary: parsed.summary || (parsed.canComment ? '可评论' : '不可评论'),
    formType: parsed.formType || 'none',
    cmsType: parsed.cmsType || 'unknown',
    detectedFields: Array.isArray(parsed.detectedFields) ? parsed.detectedFields : [],
    confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
  }

  const level = result.canComment ? 'success' : 'warning'
  log(level, 'llm', `LLM 判定: ${result.canComment ? '可发布' : '不可发布'} (信心度: ${(result.confidence * 100).toFixed(0)}%)`, result)

  onProgress?.('done')
  return result
}
```

- [ ] **Step 2: 验证编译**

Run: `cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent && npm run build 2>&1 | head -40`
Expected: 编译通过

- [ ] **Step 3: Commit**

```bash
git add extension/src/lib/backlink-analyzer.ts
git commit -m "feat(backlink): 重写分析器，基于 FormAnalyzer 替代正则检测"
```

---

### Task 3: 修改 background.ts 的 handleFetchPageContent

**Files:**
- Modify: `extension/src/entrypoints/background.ts:54-109`

当前 `handleFetchPageContent` 发送 `FLOAT_FILL/analyze` 时 siteType 是 `directory_submit`，Content Script 只在 `blog_comment` 时才返回 `pageContent`。需要改为 `blog_comment`，并且返回中包含 `pageContent`。

- [ ] **Step 1: 修改 siteType 并返回 pageContent**

在 `handleFetchPageContent` 中，修改发送给 Content Script 的 payload：

将 `extension/src/entrypoints/background.ts` 第 89-93 行：
```typescript
const result = await chrome.tabs.sendMessage(tab.id, {
  type: 'FLOAT_FILL',
  action: 'analyze',
  payload: { siteType: 'directory_submit' },
})
```

改为：
```typescript
const result = await chrome.tabs.sendMessage(tab.id, {
  type: 'FLOAT_FILL',
  action: 'analyze',
  payload: { siteType: 'blog_comment' },
})
```

然后将第 95-99 行：
```typescript
if (result?.ok && result.analysis) {
  sendResponse({ ok: true, analysis: result.analysis })
} else {
  sendResponse({ error: result?.error || 'Content script did not return analysis' })
}
```

改为：
```typescript
if (result?.ok && result.analysis) {
  sendResponse({ ok: true, analysis: result.analysis, pageContent: result.pageContent })
} else {
  sendResponse({ error: result?.error || 'Content script did not return analysis' })
}
```

- [ ] **Step 2: 验证编译**

Run: `cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent && npm run build 2>&1 | head -40`
Expected: 编译通过

- [ ] **Step 3: Commit**

```bash
git add extension/src/entrypoints/background.ts
git commit -m "fix(backlink): FETCH_PAGE_CONTENT 使用 blog_comment 模式并返回 pageContent"
```

---

### Task 4: 修改 useBacklinkAgent — 添加日志管理

**Files:**
- Modify: `extension/src/hooks/useBacklinkAgent.ts`

添加日志 state 管理，更新 analyzeOne 以使用新的 analyzer API。

- [ ] **Step 1: 添加日志 state 和 logId ref**

在 `useBacklinkAgent.ts` 的 import 部分添加 `LogEntry`：

```typescript
import type { BacklinkRecord, BacklinkStatus, SiteRecord } from '@/lib/types'
import type { LogEntry } from '@/agent/types'
```

添加 `useRef` import（已有），然后在 hook 内部 state 声明区域添加：

```typescript
const [logs, setLogs] = useState<LogEntry[]>([])
const logIdRef = useRef(0)
```

在 `updateBatchStats` 之后添加日志回调：

```typescript
const handleLog = useCallback((entry: LogEntry) => {
  setLogs(prev => {
    const next = [...prev, entry]
    return next.length > 200 ? next.slice(-200) : next
  })
}, [])

const clearLogs = useCallback(() => {
  setLogs([])
  logIdRef.current = 0
}, [])
```

- [ ] **Step 2: 更新 analyzeOne 使用新的 analyzer API**

将 `analyzeOne` 中的 `analyzeBacklink` 调用从：

```typescript
const result = await analyzeBacklink(
  backlink.sourceUrl,
  ac.signal,
  (step) => setCurrentStep(step),
)
```

改为：

```typescript
logIdRef.current = 0
setLogs([])
handleLog({ id: ++logIdRef.current, timestamp: Date.now(), level: 'info', phase: 'system', message: `开始分析: ${extractDomain(backlink.sourceUrl)}` })

const result = await analyzeBacklink({
  url: backlink.sourceUrl,
  signal: ac.signal,
  onProgress: (step) => setCurrentStep(step),
  onLog: handleLog,
})
```

然后在成功后添加日志：

将 `const updated = await updateBacklink({...})` 之前的 `analysisLog` 构造改为：

```typescript
const analysisLog = [
  result.summary,
  `表单类型: ${result.formType}`,
  `CMS: ${result.cmsType}`,
  `信心度: ${(result.confidence * 100).toFixed(0)}%`,
]
```

并在成功分支的 `setBacklinks` 之后添加：

```typescript
handleLog({ id: ++logIdRef.current, timestamp: Date.now(), level: publishable ? 'success' : 'warning', phase: 'system', message: `分析完成: ${publishable ? '可发布' : '不可发布'}` })
```

在 catch 中添加错误日志：

```typescript
handleLog({ id: ++logIdRef.current, timestamp: Date.now(), level: 'error', phase: 'system', message: `分析出错: ${errorMsg}` })
```

- [ ] **Step 3: 更新 return 导出**

在 return 对象中添加：

```typescript
return {
  // ... existing fields
  logs,
  clearLogs,
}
```

- [ ] **Step 4: 验证编译**

Run: `cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent && npm run build 2>&1 | head -40`
Expected: 编译通过

- [ ] **Step 5: Commit**

```bash
git add extension/src/hooks/useBacklinkAgent.ts
git commit -m "feat(backlink): useBacklinkAgent 添加日志管理和新 analyzer API"
```

---

### Task 5: 修改 BacklinkAnalysis.tsx — 添加日志图标和底部面板

**Files:**
- Modify: `extension/src/components/BacklinkAnalysis.tsx`

添加 Header 日志图标按钮和底部滑出面板。

- [ ] **Step 1: 更新 Props 接口**

在 `BacklinkAnalysisProps` 接口中添加：

```typescript
logs: LogEntry[]
onClearLogs: () => void
```

添加 `LogEntry` import：

```typescript
import type { LogEntry } from '@/agent/types'
```

添加 `ActivityLog` import：

```typescript
import { ActivityLog } from './ActivityLog'
```

添加 `lucide-react` 图标 import：

```typescript
import { ScrollText } from 'lucide-react'
```

- [ ] **Step 2: 更新组件解构和添加日志面板 state**

在组件解构中添加 `logs, onClearLogs`：

```typescript
export function BacklinkAnalysis({
  backlinks,
  // ... existing props
  logs,
  onClearLogs,
}: BacklinkAnalysisProps) {
```

添加日志面板状态：

```typescript
const [logPanelOpen, setLogPanelOpen] = useState(false)
```

- [ ] **Step 3: 在 Header 中添加日志图标按钮**

在 Header 的返回按钮之前添加日志按钮：

将：
```tsx
<Button variant="ghost" size="sm" onClick={onBack}>
  {'返回'}
</Button>
```

改为：
```tsx
<div className="flex items-center gap-1">
  <button
    type="button"
    className="relative p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors cursor-pointer"
    onClick={() => setLogPanelOpen(prev => !prev)}
    title="活动日志"
  >
    <ScrollText className="w-4 h-4" />
    {logs.length > 0 && (
      <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center text-[8px] font-medium bg-primary text-primary-foreground rounded-full px-0.5">
        {logs.length > 99 ? '99+' : logs.length}
      </span>
    )}
  </button>
  <Button variant="ghost" size="sm" onClick={onBack}>
    {'返回'}
  </Button>
</div>
```

- [ ] **Step 4: 在组件底部添加日志面板**

在 `BacklinkAnalysis` 组件的 return JSX 中，在 `</div>` (最外层 flex-col 容器) 结束标签之前添加日志面板：

将最外层 `<div className="flex flex-col h-full">` 的结构改为包含日志面板。在表格 `<div className="flex-1 overflow-y-auto">` 结束标签之后、最外层 `</div>` 之前添加：

```tsx
{logPanelOpen && (
  <div className="shrink-0 border-t border-border/60" style={{ height: '40%', minHeight: 120, maxHeight: '70%' }}>
    <div
      className="h-2 cursor-row-resize flex items-center justify-center hover:bg-accent/30 transition-colors"
      onMouseDown={(e) => {
        e.preventDefault()
        const panel = e.currentTarget.parentElement
        if (!panel) return
        const startY = e.clientY
        const startHeight = panel.offsetHeight

        const onMouseMove = (moveE: MouseEvent) => {
          const delta = startY - moveE.clientY
          const newHeight = Math.max(120, Math.min(window.innerHeight * 0.7, startHeight + delta))
          panel.style.height = `${newHeight}px`
        }
        const onMouseUp = () => {
          document.removeEventListener('mousemove', onMouseMove)
          document.removeEventListener('mouseup', onMouseUp)
        }
        document.addEventListener('mousemove', onMouseMove)
        document.addEventListener('mouseup', onMouseUp)
      }}
    >
      <div className="w-8 h-1 rounded-full bg-border" />
    </div>
    <div className="flex-1 overflow-hidden" style={{ height: 'calc(100% - 8px)' }}>
      <ActivityLog logs={logs} onClear={onClearLogs} className="h-full border-0 rounded-none" />
    </div>
  </div>
)}
```

- [ ] **Step 5: 验证编译**

Run: `cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent && npm run build 2>&1 | head -40`
Expected: 编译通过

- [ ] **Step 6: Commit**

```bash
git add extension/src/components/BacklinkAnalysis.tsx
git commit -m "feat(backlink): 外链分析面板添加实时日志图标和底部滑出面板"
```

---

### Task 6: 修改 App.tsx — 传递新的 props

**Files:**
- Modify: `extension/src/entrypoints/sidepanel/App.tsx`

- [ ] **Step 1: 从 useBacklinkAgent 解构新字段**

在 `App.tsx` 中，从 `useBacklinkAgent()` 解构中添加 `logs` 和 `clearLogs`：

将 `useBacklinkAgent()` 调用的解构从：

```typescript
const {
  analyzingId,
  currentStep: backlinkStep,
  currentIndex,
  batchSize,
  backlinks,
  isRunning: isBacklinkRunning,
  startAnalysis,
  analyzeOne: analyzeBacklink,
  stop: stopBacklinkAnalysis,
  reset: resetBacklinkAgent,
  reload: reloadBacklinks,
  addUrl,
  batchHistory,
  activeBatchId,
  selectBatch,
  dismissBatch,
} = useBacklinkAgent()
```

改为：

```typescript
const {
  analyzingId,
  currentStep: backlinkStep,
  currentIndex,
  batchSize,
  backlinks,
  isRunning: isBacklinkRunning,
  startAnalysis,
  analyzeOne: analyzeBacklink,
  stop: stopBacklinkAnalysis,
  reset: resetBacklinkAgent,
  reload: reloadBacklinks,
  addUrl,
  batchHistory,
  activeBatchId,
  selectBatch,
  dismissBatch,
  logs: backlinkLogs,
  clearLogs: clearBacklinkLogs,
} = useBacklinkAgent()
```

- [ ] **Step 2: 传递 props 给 BacklinkAnalysis**

在 `<BacklinkAnalysis>` 组件调用中添加 `logs` 和 `onClearLogs` props：

```tsx
<BacklinkAnalysis
  backlinks={backlinks}
  analyzingId={analyzingId}
  currentStep={backlinkStep}
  currentIndex={currentIndex}
  batchSize={batchSize}
  isRunning={isBacklinkRunning}
  onImportCsv={importBacklinksFromCsv}
  onReload={reloadBacklinks}
  onStartAnalysis={startAnalysis}
  onAnalyzeOne={analyzeBacklink}
  onAddUrl={addUrl}
  onStop={stopBacklinkAnalysis}
  onBack={() => {
    if (!isBacklinkRunning) resetBacklinkAgent()
    setView({ name: 'dashboard' })
  }}
  batchHistory={batchHistory}
  activeBatchId={activeBatchId}
  onSelectBatch={selectBatch}
  onDismissBatch={dismissBatch}
  logs={backlinkLogs}
  onClearLogs={clearBacklinkLogs}
/>
```

- [ ] **Step 3: 验证编译**

Run: `cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent && npm run build 2>&1 | head -40`
Expected: 编译通过

- [ ] **Step 4: Commit**

```bash
git add extension/src/entrypoints/sidepanel/App.tsx
git commit -m "feat(backlink): App 传递 logs 和 clearLogs props 到 BacklinkAnalysis"
```

---

### Task 7: 清理和验证

- [ ] **Step 1: 完整构建验证**

Run: `cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent && npm run build 2>&1`
Expected: 构建成功，无 TypeScript 错误

- [ ] **Step 2: 检查未使用的 import**

在 `BacklinkAnalysis.tsx` 中移除之前导入但未使用的 `ActivityLog`（如果有的话）。检查 `useBacklinkAgent.ts` 是否有未使用的 import。

- [ ] **Step 3: 修复所有 lint 问题**

Run: `cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent && npm run build 2>&1`
Expected: 无 warning

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore(backlink): 清理未使用的导入和 lint 修复"
```

---

## Self-Review

### Spec Coverage
- ✅ 数据流改造 (Task 2 + Task 3): FormAnalyzer 替代正则分析
- ✅ LLM 扩展结果格式 (Task 1 + Task 2): BacklinkAnalysisResult 新类型
- ✅ 日志系统集成 (Task 2 + Task 4): onLog 回调 + logs state
- ✅ UI 面板集成 (Task 5 + Task 6): Header 图标 + 底部滑出面板

### Placeholder Scan
- ✅ 无 TBD/TODO
- ✅ 所有步骤都有完整代码

### Type Consistency
- ✅ `BacklinkAnalysisResult` 在 types.ts 定义，在 backlink-analyzer.ts 使用
- ✅ `LogEntry` 在 agent/types.ts 定义，在 useBacklinkAgent.ts 和 BacklinkAnalysis.tsx 使用
- ✅ `AnalyzeBacklinkOptions` 在 backlink-analyzer.ts 定义，与 useBacklinkAgent.ts 调用一致
- ✅ `BacklinkAnalysisProps` 新增 `logs: LogEntry[]` 和 `onClearLogs: () => void`，与 App.tsx 传递一致
