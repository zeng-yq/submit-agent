# 外链分析改造：基于 FormAnalyzer 的精确分析 + 实时日志

**日期**: 2026-04-21
**状态**: 已确认

## 背景与问题

当前外链分析流程不稳定：
- 通过正则 (`detectCommentSignals`) 检测评论表单信号，误判率高
- 直接在 sidepanel 中用 `htmlToText` 提取文本，信息不完整
- `FETCH_PAGE_CONTENT` 消息的 background 处理与 `backlink-analyzer.ts` 的期望存在偏差
- 分析过程没有实时日志，用户无法观察进度细节

提交外链的表单分析已经很成熟：
- Content Script 中的 `FormAnalyzer` 精确提取表单字段、标签、页面上下文
- `expandLazyCommentForms()` 能展开 wpDiscuz 等懒加载评论表单
- `extractPageContent()` 提取结构化的页面内容

**目标**：让外链分析复用提交外链的表单分析能力，并加入实时日志面板。

## 方案选择

**选定方案 A：复用现有 FLOAT_FILL/analyze 消息流**

理由：
- FormAnalyzer、expandLazyCommentForms 已完整实现
- 不新增消息类型，background 路由逻辑不变
- 提交和分析的分析阶段完全一致，维护成本低

## 设计详情

### 1. 数据流改造

**改造后流程**：

```
useBacklinkAgent.analyzeOne(backlink)
  │
  ├─ 1. Background 打开隐藏 Tab
  │     chrome.tabs.create({ active: false, url })
  │     等待加载 + 2秒 JS 渲染
  │
  ├─ 2. 向隐藏 Tab 发送 FLOAT_FILL/analyze
  │     Content Script 执行:
  │     ├─ expandLazyCommentForms()  ← 展开懒加载评论
  │     ├─ waitForFormFields()       ← 等待动态表单
  │     ├─ analyzeForms(document)    ← FormAnalyzer 分析
  │     └─ extractPageContent(document) ← 提取页面内容
  │
  ├─ 3. 关闭隐藏 Tab，返回 { analysis, pageContent }
  │
  ├─ 4. Sidepanel 构建 LLM Prompt
  │     输入: FormAnalysisResult + PageInfo + PageContent
  │     Prompt: 判断页面是否适合发布评论外链
  │
  ├─ 5. 调用 LLM，获取扩展结果
  │
  └─ 6. 更新 BacklinkRecord，保存结果
```

**`backlink-analyzer.ts` 改造**：
- 移除 `detectCommentSignals()` 正则方法
- 移除 `htmlToText()` 和 `extractTitle()` 简单提取
- 改为接收 `FormAnalysisResult + pageContent`，构建结构化 prompt
- 新增 `onLog` 回调参数用于日志输出

**`background.ts` 改造**：
- `handleFetchPageContent` 改为：打开隐藏 Tab → 向 Tab 发送 `FLOAT_FILL/analyze` → 等待 Content Script 返回分析结果 → 关闭 Tab → 返回结果给 sidepanel
- 统一 `siteType` 为 `'blog_comment'`（外链分析默认视为博客评论场景）

### 2. LLM 扩展结果格式

**新 Prompt**：基于 FormAnalysisResult 构建，输入更丰富的结构化信息（字段列表、表单类型、页面上下文）。

**新返回格式**：

```typescript
interface BacklinkAnalysisResult {
  canComment: boolean
  summary: string
  formType: 'blog_comment' | 'directory' | 'contact_form' | 'forum' | 'none'
  cmsType: 'wordpress' | 'blogger' | 'discuz' | 'custom' | 'unknown'
  detectedFields: string[]   // ["name", "email", "url", "comment"]
  confidence: number         // 0-1，LLM 对判断的信心度
}
```

**BacklinkRecord 扩展**：
- `analysisResult` 字段类型从 `{ canComment, summary }` 扩展为上述 `BacklinkAnalysisResult`

### 3. 日志系统集成

**使用现有的 `LogEntry` 类型**（LogLevel + LogPhase + message + data），不新增类型。

**日志生成点**：

| Phase | Message | Level | Data |
|-------|---------|-------|------|
| system | "开始分析: {domain}" | info | - |
| system | "分析完成" | success | BacklinkAnalysisResult |
| system | "分析已停止" | warning | - |
| system | "分析出错: {error}" | error | error.message |
| analyze | "正在打开页面..." | info | - |
| analyze | "正在展开评论表单..." | info | - |
| analyze | "表单分析完成 — 发现 {N} 个表单, {M} 个字段" | info | FormAnalysisResult 摘要 |
| analyze | "检测到评论表单 ({cms})" | success | formType, cmsType |
| analyze | "未发现评论表单" | warning | - |
| llm | "正在分析页面适配性..." | info | - |
| llm | "LLM 判定: {可发布/不可发布} (信心度: {confidence})" | success/warning | 完整 LLM 响应 |

**实现方式**：
- `backlink-analyzer.ts` 新增 `onLog?: (entry: LogEntry) => void` 回调
- `useBacklinkAgent` 维护 `logs: LogEntry[]` state，上限 200 条
- 每条外链分析开始时清空日志
- 导出 `logs` 和 `clearLogs` 给组件使用

### 4. UI 面板集成

**Header 图标**：
- 位置：Header 右侧，"返回"按钮左边
- 图标：`ScrollText`（lucide-react）
- Badge：批量分析运行时显示当前日志条数
- 行为：点击切换底部日志面板展开/收起

**底部滑出面板**：
- 固定在 BacklinkAnalysis 容器底部
- 默认展开高度：容器的 40%
- 可拖拽调整高度（最小 120px，最大 70%）
- 收起时完全隐藏
- 内容：直接复用 `ActivityLog` 组件

**布局结构**：

```
BacklinkAnalysis (flex-col, h-full)
  ├─ Header (flex-shrink-0)
  │   └─ [ScrollText] 图标按钮 + badge
  ├─ Toolbar (flex-shrink-0)
  ├─ Content (flex-1, overflow-auto)
  └─ LogPanel (flex-shrink-0, 条件渲染)
      ├─ 拖拽手柄 (h-2, cursor-row-resize)
      └─ ActivityLog (flex-1, overflow-auto)
```

**组件 Props 变更**：

`BacklinkAnalysis` 新增 props：
```typescript
logs: LogEntry[]
onClearLogs: () => void
```

`useBacklinkAgent` 新增导出：
```typescript
logs: LogEntry[]
clearLogs: () => void
```

## 涉及文件

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `backlink-analyzer.ts` | 重写 | 移除正则分析，改为接收 FormAnalysisResult |
| `background.ts` | 修改 | handleFetchPageContent 改用 FLOAT_FILL/analyze |
| `useBacklinkAgent.ts` | 修改 | 添加日志管理，更新分析流程 |
| `BacklinkAnalysis.tsx` | 修改 | 添加日志图标和底部面板 |
| `App.tsx` | 修改 | 传递新的 props |
| `db.ts` | 修改 | BacklinkRecord.analysisResult 类型扩展 |

## 不涉及

- 不修改 FormAnalyzer、FormAnnotator、dom-utils 等表单分析相关代码
- 不修改 ActivityLog 组件本身
- 不修改 Content Script 的分析逻辑
- 不修改提交外链的现有流程
