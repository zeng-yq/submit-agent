# LLM 字段值按输入框级别展示设计

**日期**: 2026-04-25
**状态**: Approved

## 背景

外链提交过程中，LLM 返回的字段值目前仅作为 JSON 数据展开显示在活动日志中。当自动填写失败时，用户无法快速定位并复制某个字段的值进行手动粘贴。

## 目标

在 LLM 调用成功后，将返回的字段值按输入框级别独立展示，支持一键复制，方便手动补填失败的字段。

## 方案

在 ActivityLog 组件内新增独立区块，通过新增 prop 接收 LLM 字段数据，紧贴日志列表末尾展示。

## 数据模型

```typescript
interface LLMFieldValue {
  label: string   // 字段的 label（如 "Name"、"Email"、"Comment"）
  value: string   // LLM 返回的值
}

interface LLMFieldData {
  fields: LLMFieldValue[]
}
```

### 数据流

1. `FormFillEngine` 解析 LLM 响应成功后，将 `fieldValues` 与 `analysis.fields` 的 label 关联，构建 `LLMFieldValue[]`
2. 通过 `onLLMFields` 回调传递给 `useFormFillEngine` hook
3. Hook 存储 `llmFieldData: LLMFieldData | null` 状态，重置时清空
4. 传递给 `ActivityLog` 组件的新 prop `llmFieldData`

## UI 设计

- 在日志列表末尾新增"LLM 字段值"区块，仅在 LLM 调用成功且有数据时显示
- 区域标题："LLM 字段值"（带图标）
- 每个字段为一行：label 灰色小字，value 正常字号完整显示
- 点击 value 区域即复制到剪贴板，显示"已复制"提示（1.5 秒后消失）
- 字段之间用细分隔线隔开
- 整体使用浅灰背景卡片，与日志风格统一

## 改动清单

### 1. `extension/src/agent/types.ts`

- 新增 `LLMFieldValue` 和 `LLMFieldData` 接口

### 2. `extension/src/agent/FormFillEngine.ts`

- `FormFillEngineCallbacks` 新增 `onLLMFields?: (data: LLMFieldData) => void`
- LLM 响应解析成功后，关联 `analysis.fields` 的 label，构建 `LLMFieldValue[]`，调用 `onLLMFields`

### 3. `extension/src/hooks/useFormFillEngine.ts`

- 新增 `llmFieldData` 状态
- 处理 `onLLMFields` 回调
- `reset`/`clearLogs` 时清空

### 4. `extension/src/components/ActivityLog.tsx`

- Props 新增 `llmFieldData?: LLMFieldData | null`
- 日志末尾渲染"LLM 字段值"区块
- 点击复制逻辑和"已复制"提示

### 5. `extension/src/components/Dashboard.tsx`

- 传递 `llmFieldData` 到 `ActivityLog`

### 6. `extension/src/entrypoints/sidepanel/App.tsx`

- 确保 `llmFieldData` 从 hook 传递到 Dashboard 的链路通畅

## 约束

- 仅在 LLM 调用成功且返回了字段值时展示
- 每次提交只展示最近一次的 LLM 响应（与日志清空机制一致）
- 不修改现有 LogEntry 类型和日志逻辑
