# 外链分析面板全栈重构设计

**日期**: 2026-04-21
**范围**: 外链分析面板所有功能代码（数据层、分析层、状态层、UI 层）
**方式**: 自底向上逐层清理，渐进式重构
**目标**: 清除死代码、消除重复、采用严格分层抽象，提高可读性、可维护性、可扩展性

---

## 目标架构

四层架构，每层通过明确接口通信，不反向依赖：

```
┌──────────────────────────────────────────────┐
│  UI 层 (components/)                         │
│  BacklinkAnalysis, BacklinkToolbar,          │
│  BacklinkTable, BacklinkRow                  │
│  → 只负责渲染和用户交互                       │
├──────────────────────────────────────────────┤
│  状态层 (hooks/)                             │
│  useBacklinkAnalysis, useBacklinkState       │
│  → 管理分析流程状态和 UI 状态                  │
├──────────────────────────────────────────────┤
│  分析层 (agent/)                             │
│  form-scanner, form-classifier,              │
│  field-resolver, comment-links,              │
│  backlink-analyzer                           │
│  → 纯逻辑，不依赖 DOM 或 UI                   │
├──────────────────────────────────────────────┤
│  数据层 (lib/)                               │
│  db, types, backlinks                        │
│  → 数据持久化和类型定义                        │
└──────────────────────────────────────────────┘
```

**关键原则**：
- 每层只依赖其下一层，不反向依赖
- 分析层函数全部是纯函数或接收明确参数
- UI 组件不包含业务逻辑，只调用 hook 提供的方法
- 层间通信通过 TypeScript 接口约束

---

## Stage 1: 数据层重构

**涉及文件**: `lib/db.ts`、`lib/backlinks.ts`
**Success Criteria**: 所有现有测试通过，`getSiteByDomain` 使用索引查询
**Tests**: 现有 `backlink-analyzer.test.ts` 继续通过；新增索引查询的验证

### 1.1 清理 `lib/backlinks.ts`

- 移除 `importBacklinksFromCsv` 和 `useBacklinkAgent.ts` 中传递的 `targetUrl: ''` 死字段
- 替换手写 CSV 解析器：使用 `String.split` + 状态机方式处理带引号的字段，支持引号内换行符（参考 RFC 4180）

### 1.2 优化 `lib/db.ts`

- `getSiteByDomain()` 改用 IndexedDB 索引查询替代 `getAll()` + `filter()`
- 在数据库 `upgrade` 回调中为 `sites` store 添加 `domain` 索引

### 1.3 `lib/types.ts`

- 无需变更，类型定义已足够清晰

---

## Stage 2: 分析层重构

**涉及文件**: `agent/FormAnalyzer.ts` (712行) → 拆分为 6 个文件 + `lib/backlink-analyzer.ts`
**Success Criteria**: 所有现有测试通过（含 1042 行的 FormAnalyzer 测试），对外 import 路径不变
**Tests**: 现有 `FormAnalyzer.test.ts`、`dom-utils.test.ts` 继续通过；新增模块各自有单元测试

### 2.1 拆分 `FormAnalyzer.ts`

将 `agent/FormAnalyzer.ts` 重构为 `agent/form-analyzer/` 目录，内含以下文件。原 `FormAnalyzer.ts` 改为 barrel re-export，保持外部 import 路径兼容。

| 新文件 | 职责 | 提取的函数 | 预估行数 |
|--------|------|-----------|---------|
| `form-scanner.ts` | DOM 扫描、字段提取、蜜罐去重 | `findLabel()`, `deduplicateFields()`, 选择器常量 | ~200 |
| `form-classifier.ts` | 表单分类 | `classifyForm()`, 分类相关常量 | ~120 |
| `field-resolver.ts` | 字段用途推断与有效类型 | `inferFieldPurpose()`, `inferEffectiveType()`, `resolveField()`, `classifyFields()` | ~150 |
| `comment-links.ts` | 评论区外链检测 | `detectCommentLinks()`, 选择器常量 | ~80 |
| `field-list-builder.ts` | LLM 字段列表构建 | `buildFieldList()` | ~50 |
| `index.ts` | 公共 API 入口 + `analyzeForms()` 编排 | 统一 re-export | ~120 |

所有子模块共享 `agent/types.ts` 中已有的 `FormField`、`FormGroup`、`FormRole` 等类型，不在子模块内重复定义。

### 2.2 消除字段检测重复

当前 `backlink-analyzer.ts` 中 `analyzeBacklink()` 和 `calculateConfidence()` 各自独立检测 `commentFields` 和 `textareaFields`，逻辑重复。

解决方案：
- 提取 `classifyFields(fields: FormField[]): { commentFields, textareaFields, urlFields, authorFields, emailFields }` 纯函数到 `field-resolver.ts`
- `backlink-analyzer.ts` 的两个函数都调用此共享函数
- 分类标准基于现有的字段名称/类型/ARIA 属性匹配规则

### 2.3 模块依赖关系

```
form-scanner ← form-classifier
form-scanner ← field-resolver
form-scanner ← comment-links
field-resolver ← field-list-builder
index.ts ← 所有模块
```

### 2.4 公共接口与兼容性

原 `agent/FormAnalyzer.ts` 改为 barrel re-export 文件：

```typescript
// agent/FormAnalyzer.ts (重构后，仅 re-export)
export { analyzeForms, detectCommentLinks, classifyForm, inferFieldPurpose,
         inferEffectiveType, buildFieldList, resolveField } from './form-analyzer'
export type { FormField, PageInfo, FormAnalysisResult, CommentLinkResult,
              FormRole, FormConfidence, FormGroup } from './types'
```

外部调用方（`content.ts`、`FormFillEngine.ts`）保持 `from '../agent/FormAnalyzer'` 不变，无需修改 import 路径。

---

## Stage 3: 状态层重构

**涉及文件**: `hooks/useBacklinkAgent.ts` (306行) → 拆分为 2 个 hook
**Success Criteria**: 所有 UI 功能行为不变，测试通过
**Tests**: 现有 hook 行为不变；新增 hook 的单元测试

### 3.1 拆分方案

| 新 Hook | 职责 | 提取的状态/方法 |
|---------|------|---------------|
| `useBacklinkAnalysis.ts` | 分析流程核心逻辑 | `startAnalysis()`, `stop()`, `analyzeOne()`, `analyzingId`, `isRunning`, `currentStep`, `currentIndex`, `batchSize` |
| `useBacklinkState.ts` | UI 展示状态 | `backlinks`, `reload()`, `addUrl()`, `batchHistory`, `activeBatchId`, `selectBatch()`, `dismissBatch()`, `logs`, `clearLogs()` |

### 3.2 依赖关系

```
useBacklinkState (独立)
  ↑
useBacklinkAnalysis (接收 useBacklinkState 的部分方法作为参数)
```

`useBacklinkAnalysis` 通过参数接收 `addLog`、`updateBacklink` 等方法，而非直接耦合。

### 3.3 清理项

- 移除 `addUrl()` 中不存在的 `targetUrl: ''` 字段

### 3.4 UI 层调用方式变更

```typescript
// Before
const agent = useBacklinkAgent()

// After
const state = useBacklinkState()
const analysis = useBacklinkAnalysis(state)
```

---

## Stage 4: UI 层重构

**涉及文件**: `components/BacklinkAnalysis.tsx` (353行)、`entrypoints/sidepanel/App.tsx` (406行)
**Success Criteria**: 所有 UI 功能行为不变，组件可独立理解
**Tests**: 手动验证所有 UI 交互正常

### 4.1 拆分 `BacklinkAnalysis.tsx`

| 新组件 | 职责 | 预估行数 |
|--------|------|---------|
| `BacklinkAnalysis.tsx` | 容器组件，组装子组件 | ~80 |
| `BacklinkToolbar.tsx` | 顶部工具栏：CSV 导入、URL 添加、批量分析控制 | ~90 |
| `BacklinkTable.tsx` | 表格主体：过滤标签页 + 行列表 | ~120 |
| `BacklinkRow.tsx` | 可展开的单行：状态、置信度、分析结果详情 | ~80 |

### 4.2 优化 `sidepanel/App.tsx`

- 提取浮动按钮填写协调逻辑到 `hooks/useFloatFill.ts`
- 简化 `App.tsx` 为标签页路由 + 各标签页内容挂载

### 4.3 不变更的文件

- `ActivityLog.tsx` (167行) — 职责清晰
- `SiteCard.tsx` (144行) — 已足够小
- `SettingsPanel.tsx`、`ProductForm.tsx`、`QuickCreate.tsx` — 不属于外链分析面板

---

## 风险控制

- 每个阶段完成后运行 `npm run build`，确保编译通过
- 每个阶段完成后运行所有现有测试，确保无回归
- 分析层拆分时保持对外 import 路径兼容，减少改动范围
- 状态层拆分时 UI 层调用方式变更，需同步更新所有消费方

## 不在范围内

- 新功能开发
- 性能优化（除 `getSiteByDomain` 索引优化外）
- `SyncPanel.tsx` 中的 `as any` 类型问题
- LLM 集成逻辑重构
- CSS/样式调整
