# LLM 字段值按输入框级别展示 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在活动日志末尾展示 LLM 返回的每个字段值，支持点击复制，方便手动补填失败的字段。

**Architecture:** FormFillEngine 在 LLM 响应解析成功后，将 fieldValues 与表单字段的 label 关联，通过回调传递给 hook，再通过 prop 传递给 ActivityLog 组件渲染。

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, lucide-react

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `extension/src/agent/types.ts` | 新增 `LLMFieldValue` 和 `LLMFieldData` 类型 |
| Modify | `extension/src/agent/FormFillEngine.ts` | 新增 `onLLMFields` 回调，LLM 解析成功后构建字段数据 |
| Modify | `extension/src/hooks/useFormFillEngine.ts` | 新增 `llmFieldData` 状态，处理回调，重置时清空 |
| Modify | `extension/src/components/ActivityLog.tsx` | 新增 `llmFieldData` prop，渲染字段值区块 |
| Modify | `extension/src/components/Dashboard.tsx` | 传递 `llmFieldData` prop 到 ActivityLog |
| Modify | `extension/src/entrypoints/sidepanel/App.tsx` | 传递 `llmFieldData` 到 Dashboard |

---

### Task 1: 新增类型定义

**Files:**
- Modify: `extension/src/agent/types.ts:56` (文件末尾追加)

- [ ] **Step 1: 在 types.ts 末尾新增 LLMFieldValue 和 LLMFieldData 接口**

```typescript
/** LLM 返回的按字段级别展示的数据 */
export interface LLMFieldValue {
  /** 字段的 label（如 "Name"、"Email"、"Comment"） */
  label: string
  /** LLM 返回的值 */
  value: string
}

/** LLM 字段值展示数据，传递给 ActivityLog 组件 */
export interface LLMFieldData {
  fields: LLMFieldValue[]
}
```

- [ ] **Step 2: 运行 build 验证类型无误**

Run: `cd extension && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add extension/src/agent/types.ts
git commit -m "feat: 新增 LLMFieldValue 和 LLMFieldData 类型定义"
```

---

### Task 2: FormFillEngine 新增 onLLMFields 回调

**Files:**
- Modify: `extension/src/agent/FormFillEngine.ts:103-107` (FormFillEngineCallbacks 接口)
- Modify: `extension/src/agent/FormFillEngine.ts:247-253` (LLM 响应解析成功后的位置)

- [ ] **Step 1: 在 FormFillEngineCallbacks 接口中新增 onLLMFields 回调**

在 `extension/src/agent/FormFillEngine.ts` 的 `FormFillEngineCallbacks` 接口中，在 `onLog` 属性后新增：

```typescript
onLLMFields?: (data: LLMFieldData) => void
```

同时在文件顶部的 import 中添加 `LLMFieldData`：

```typescript
import type { FillEngineStatus, FillResult, SiteType, FieldValueMap, LogEntry, LogLevel, LLMFieldData } from './types'
```

- [ ] **Step 2: 在 LLM 响应解析成功后，构建 LLMFieldData 并调用回调**

在 `extension/src/agent/FormFillEngine.ts` 的 `log('success', 'llm', `LLM 响应已解析: ${valueCount} 个字段值`` 之后（约第 253 行），新增：

```typescript
// 构建 LLM 字段值展示数据
if (onLLMFields && valueCount > 0) {
  const fieldLabelMap = new Map(analysis.fields.map(f => [f.canonical_id, f.label || f.inferred_purpose || f.name || f.canonical_id]))
  const llmFields: LLMFieldValue[] = Object.entries(fieldValues).map(([key, value]) => ({
    label: fieldLabelMap.get(key) || key,
    value: typeof value === 'string' ? value : String(value),
  }))
  if (llmFields.length > 0) {
    onLLMFields({ fields: llmFields })
  }
}
```

注意：这里需要同时在文件顶部的 import 中添加 `LLMFieldValue`：

```typescript
import type { FillEngineStatus, FillResult, SiteType, FieldValueMap, LogEntry, LogLevel, LLMFieldData, LLMFieldValue } from './types'
```

- [ ] **Step 3: 运行 build 验证**

Run: `cd extension && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add extension/src/agent/FormFillEngine.ts
git commit -m "feat: FormFillEngine 新增 onLLMFields 回调，LLM 解析成功后传递字段值数据"
```

---

### Task 3: useFormFillEngine hook 新增状态管理

**Files:**
- Modify: `extension/src/hooks/useFormFillEngine.ts`

- [ ] **Step 1: 更新 import，新增 LLMFieldData 类型**

在 `extension/src/hooks/useFormFillEngine.ts` 第 6 行，将 import 修改为：

```typescript
import type { FillEngineStatus, FillResult, SiteType, LogEntry, LLMFieldData } from '@/agent/types'
```

- [ ] **Step 2: 在 UseFormFillEngineResult 接口中新增 llmFieldData 字段**

在 `UseFormFillEngineResult` 接口的 `clearLogs` 后面新增：

```typescript
llmFieldData: LLMFieldData | null
```

- [ ] **Step 3: 在 hook 函数中新增状态和回调**

在 `const [logs, setLogs] = useState<LogEntry[]>([])` 后新增：

```typescript
const [llmFieldData, setLLMFieldData] = useState<LLMFieldData | null>(null)
```

在 `const handleLog` 回调之后新增：

```typescript
const handleLLMFields = useCallback((data: LLMFieldData) => {
  setLLMFieldData(data)
}, [])
```

- [ ] **Step 4: 在 clearLogs 中清空 llmFieldData**

将 `clearLogs` 修改为：

```typescript
const clearLogs = useCallback(() => {
  setLogs([])
  setLLMFieldData(null)
}, [])
```

- [ ] **Step 5: 在 reset 中清空 llmFieldData**

将 `reset` 修改为：

```typescript
const reset = useCallback(() => {
  stop()
  setStatus('idle')
  setResult(null)
  setError(null)
  setLLMFieldData(null)
}, [stop])
```

- [ ] **Step 6: 在 startSubmission 的 callbacks 中传入 onLLMFields**

在 `startSubmission` 函数的 `callbacks` 对象中，在 `onLog: handleLog` 之后新增：

```typescript
onLLMFields: handleLLMFields,
```

- [ ] **Step 7: 在 startFloatFill 的 callbacks 中传入 onLLMFields**

在 `startFloatFill` 函数的 `callbacks` 对象中，同样在 `onLog: handleLog` 之后新增：

```typescript
onLLMFields: handleLLMFields,
```

- [ ] **Step 8: 在 return 对象中新增 llmFieldData**

在 return 对象中，在 `clearLogs` 之后新增：

```typescript
llmFieldData,
```

- [ ] **Step 9: 运行 build 验证**

Run: `cd extension && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 10: Commit**

```bash
git add extension/src/hooks/useFormFillEngine.ts
git commit -m "feat: useFormFillEngine 新增 llmFieldData 状态管理"
```

---

### Task 4: ActivityLog 组件新增 LLM 字段值展示区块

**Files:**
- Modify: `extension/src/components/ActivityLog.tsx`

- [ ] **Step 1: 更新 import，新增 Copy 和 Check 图标，新增 LLMFieldData 类型**

在 `extension/src/components/ActivityLog.tsx` 第 2 行的 lucide-react import 中追加 `Copy, Check`：

```typescript
import { ChevronRight, ChevronDown, Trash2, Info, CheckCircle2, AlertTriangle, XCircle, Copy, Check } from 'lucide-react'
```

在类型 import 中追加 `LLMFieldData`：

```typescript
import type { LogEntry, LogLevel, LogPhase, LLMFieldData } from '@/agent/types'
```

- [ ] **Step 2: 在 ActivityLogProps 中新增 llmFieldData prop**

在 `ActivityLogProps` 接口的 `className` 之前新增：

```typescript
llmFieldData?: LLMFieldData | null
```

- [ ] **Step 3: 新增 LLMFieldValueItem 组件**

在 `LogItem` 组件之后、`ActivityLog` 组件之前，新增：

```typescript
function LLMFieldValueItem({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [value])

  return (
    <div className="px-3 py-1.5 hover:bg-accent/30 transition-colors cursor-pointer border-b border-border/20 last:border-b-0" onClick={handleCopy}>
      <div className="text-[10px] text-muted-foreground mb-0.5">{label}</div>
      <div className="flex items-start gap-1.5">
        <div className="flex-1 text-xs text-foreground whitespace-pre-wrap break-all min-w-0">{value}</div>
        <span className="shrink-0 text-[10px] text-muted-foreground/60 mt-0.5 flex items-center gap-0.5">
          {copied ? (
            <>
              <Check className="w-3 h-3 text-green-500" />
              {'已复制'}
            </>
          ) : (
            <Copy className="w-3 h-3" />
          )}
        </span>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 在 ActivityLog 组件中解构 llmFieldData 并渲染**

在 `ActivityLog` 组件的参数解构中新增 `llmFieldData`：

```typescript
export function ActivityLog({ logs, totalLogCount, onClear, llmFieldData, className }: ActivityLogProps) {
```

在日志列表 `logs.map(...)` 之后、`</div>` (滚动容器闭合) 之前，新增 LLM 字段值区块的渲染：

```tsx
{llmFieldData && llmFieldData.fields.length > 0 && (
  <div className="border-t border-border/60">
    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/40 border-b border-border/30">
      <svg className="w-3 h-3 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z" />
      </svg>
      <span className="text-[10px] font-medium text-muted-foreground">{'LLM 字段值'}</span>
      <span className="text-[9px] text-muted-foreground/60 ml-auto">{'点击复制'}</span>
    </div>
    {llmFieldData.fields.map((field, i) => (
      <LLMFieldValueItem key={i} label={field.label} value={field.value} />
    ))}
  </div>
)}
```

- [ ] **Step 5: 运行 build 验证**

Run: `cd extension && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add extension/src/components/ActivityLog.tsx
git commit -m "feat: ActivityLog 新增 LLM 字段值展示区块，支持点击复制"
```

---

### Task 5: Dashboard 传递 llmFieldData prop

**Files:**
- Modify: `extension/src/components/Dashboard.tsx`

- [ ] **Step 1: 更新 import，新增 LLMFieldData 类型**

在 `extension/src/components/Dashboard.tsx` 第 3 行，将 import 修改为：

```typescript
import type { FillEngineStatus, LogEntry, LLMFieldData } from '@/agent/types'
```

- [ ] **Step 2: 在 DashboardProps 中新增 llmFieldData**

在 `DashboardProps` 接口的 `onClearEngineLogs` 之后新增：

```typescript
llmFieldData: LLMFieldData | null
```

- [ ] **Step 3: 在 Dashboard 函数参数解构中新增 llmFieldData**

在 Dashboard 函数的参数解构中，在 `onClearEngineLogs` 之后新增：

```typescript
llmFieldData,
```

- [ ] **Step 4: 在 ActivityLog 组件调用中传递 llmFieldData prop**

将 Dashboard 中 `<ActivityLog` 的调用从：

```tsx
<ActivityLog
  logs={engineLogs}
  onClear={onClearEngineLogs}
  className="flex-1"
/>
```

修改为：

```tsx
<ActivityLog
  logs={engineLogs}
  onClear={onClearEngineLogs}
  llmFieldData={llmFieldData}
  className="flex-1"
/>
```

- [ ] **Step 5: 运行 build 验证**

Run: `cd extension && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add extension/src/components/Dashboard.tsx
git commit -m "feat: Dashboard 传递 llmFieldData 到 ActivityLog"
```

---

### Task 6: App.tsx 传递 llmFieldData

**Files:**
- Modify: `extension/src/entrypoints/sidepanel/App.tsx`

- [ ] **Step 1: 在 useFormFillEngine 解构中新增 llmFieldData**

在 `extension/src/entrypoints/sidepanel/App.tsx` 第 23 行，将 `useFormFillEngine` 的解构修改为：

```typescript
const { status: engineStatus, result: engineResult, error: engineError, logs: engineLogs, startSubmission, stop, reset, clearLogs, llmFieldData } = useFormFillEngine()
```

- [ ] **Step 2: 在 Dashboard 组件调用中传递 llmFieldData**

在 `renderSubmitTab` 函数中，`<Dashboard` 调用中，在 `onClearEngineLogs={clearLogs}` 之后新增：

```tsx
llmFieldData={llmFieldData}
```

- [ ] **Step 3: 运行 build 验证**

Run: `cd extension && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add extension/src/entrypoints/sidepanel/App.tsx
git commit -m "feat: App 传递 llmFieldData 到 Dashboard"
```

---

### Task 7: 最终构建验证

- [ ] **Step 1: 运行完整构建**

Run: `cd extension && npm run build`
Expected: 构建成功，无错误

- [ ] **Step 2: 手动验证**

在浏览器中加载扩展，打开一个有表单的页面，触发外链提交，观察活动日志末尾是否出现"LLM 字段值"区块，点击字段值是否能复制到剪贴板。
