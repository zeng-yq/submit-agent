# Dashboard 批量提交与失败视图设计

## 概述

对 Dashboard 进行三项变更：删除"推荐"标签页、新增批量提交功能、新增"失败"标签页。

## 1. Dashboard Tab 结构变更

### 当前

`推荐 | 全部 | 已完成`

### 变更后

`全部 | 已完成 | 失败`

- 删除 `recommended` tab 和 `RECOMMENDED_LIMIT` 相关逻辑
- "全部" tab：显示所有有 `submit_url` 的站点，按 DR 降序排列
- "已完成" tab：不变，显示 `submitted`/`approved`/`skipped` 状态的站点
- "失败" tab：显示 `failed` 状态的站点

### 失败 Tab 内容

每条失败记录显示：

- 站点名称
- 失败时间（格式化为可读日期）
- 错误信息（红色文本）
- "重试"按钮 → 导航到该站点的 SubmitFlow，重新执行 agent

空状态：显示"暂无失败记录"提示。

## 2. 数据层变更

### SubmissionRecord 新增字段

```typescript
interface SubmissionRecord {
  // ... existing fields
  error?: string       // 失败时的错误信息
  failedAt?: number    // 失败时间戳 (Date.now())
}
```

### 新增 markFailed 函数

在 `useSites` hook 中新增 `markFailed(siteName: string, productId: string, error?: string)`:

- 将 `SubmissionRecord.status` 设为 `failed`
- 设置 `error` 和 `failedAt` 字段
- 写入 IndexedDB

### 重试时清除失败信息

当用户从失败 tab 重试并成功提交后，清除 `error` 和 `failedAt` 字段。

## 3. 批量提交 UI

### 位置

Dashboard 顶部，进度条下方、tab 栏上方。

### 非批量状态

```
[ 进度条: submitted/total XX% ]

  显示数量: [20 ▾]   [开始批量提交]

[ 全部(25) | 已完成(3) | 失败(2) ]
```

- `<select>` 下拉框：选项 10、20、50，默认 20（和 BacklinkAnalysis 一致）
- "开始批量提交"按钮：点击后从"全部"列表中取前 N 条 `not_started` 状态的站点

### 批量进行中状态

```
[ 进度条: submitted/total XX% ]

  ⏳ 正在提交: 3/20  SiteName           [停止]

[ 全部(25) | 已完成(3) | 失败(2) ]
```

- 显示当前进度（第 X/N 个）
- 显示当前正在提交的站点名称
- "停止"按钮：停止批量，已完成的保留状态，未开始的不处理
- select 和开始按钮隐藏

## 4. 批量提交流程

1. 用户在 Dashboard 选择数量，点击"开始批量提交"
2. 从"全部"列表中取前 N 条 `not_started` 状态的站点，进入批量模式
3. 自动导航到第一个站点的 `site-detail` 视图（SubmitFlow）
4. SubmitFlow 自动开始 agent 执行（无需用户手动点击"开始自动提交"）
5. Agent 完成后的处理：
   - **成功**（表单填充完毕）：等待用户手动提交到网站 → 用户点击"Mark as submitted" → 回到 Dashboard，自动继续下一个
   - **失败**：自动调用 `markFailed()` 记录失败 → 回到 Dashboard，自动继续下一个
   - **跳过**：记录 skipped → 继续
6. 全部完成或用户点击"停止" → 退出批量模式，恢复 UI

### 视图切换协调

- 批量模式的状态（当前站点索引、站点列表、是否停止）存储在 Dashboard 的 React state 中
- App.tsx 新增 `autoStart` 参数传递给 SubmitFlow，用于在批量模式下自动开始 agent
- SubmitFlow 完成后通过回调通知 Dashboard（`onComplete` / `onFailed` / `onSkipped`），Dashboard 决定是否继续下一个

## 5. 涉及的文件

| 文件 | 变更 |
|------|------|
| `src/components/Dashboard.tsx` | 删除 recommended tab，新增批量提交 UI（select + 按钮 + 进度），新增 failed tab |
| `src/components/SubmitFlow.tsx` | 支持 `autoStart` prop，完成时触发回调 |
| `src/hooks/useSites.ts` | 新增 `markFailed()` 函数 |
| `src/lib/types.ts` | SubmissionRecord 新增 `error?` 和 `failedAt?` 字段 |
| `src/lib/db.ts` | IndexedDB schema 兼容新字段 |
| `src/entrypoints/sidepanel/App.tsx` | 协调 Dashboard 和 SubmitFlow 之间的批量状态 |
| `src/lib/i18n.ts` | 新增批量提交和失败相关的翻译文本 |
