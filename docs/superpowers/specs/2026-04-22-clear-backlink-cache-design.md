# 外链分析面板 — 清空缓存功能设计

## 背景

外链分析面板中的数据（导入的外链、分析日志、完成/失败状态）不需要上传到 Google Sheet。可发布的外链在分析过程中已自动保存到 `sites` 表（外链资源库）。因此 `backlinks` 表和面板中的 React 状态本质上是缓存数据，用户应能手动清空。

## 功能描述

在 BacklinkToolbar 工具栏右侧添加"清空缓存"按钮，一键清空所有 backlink 相关数据。

## 交互流程

1. 用户点击"清空缓存"按钮
2. 弹出浏览器原生 `confirm()` 确认对话框
3. 用户确认后执行清空操作
4. 面板回到空白初始状态（无数据、无日志）

## 清空范围

| 数据 | 存储位置 | 清空方式 |
|---|---|---|
| backlinks 记录 | IndexedDB `backlinks` 表 | `clearBacklinks()` |
| 外链列表 | React state `backlinks[]` | `setBacklinks([])` |
| 分析日志 | React state `logs[]` | `setLogs([])` |
| 批次历史 | React state `batchHistory[]` | `setBatchHistory([])` |

**不受影响**：`sites` 表（外链资源库）数据保持不变。

## 涉及文件

| 文件 | 修改内容 |
|---|---|
| `extension/src/hooks/useBacklinkState.ts` | 新增 `clearAll()` 方法，调用 `clearBacklinks()` 并重置所有 React state |
| `extension/src/components/BacklinkToolbar.tsx` | 添加"清空缓存"按钮，调用 `onClearAll` 回调 |
| `extension/src/components/BacklinkAnalysis.tsx` | 从 `useBacklinkState` 获取 `clearAll`，传递给 `BacklinkToolbar` |

## 约束

- 不引入新依赖或新组件
- 复用 `db.ts` 中已有的 `clearBacklinks()` 函数
- 分析正在进行时禁用清空按钮，防止数据冲突
- 确认对话框使用浏览器原生 `window.confirm()`
