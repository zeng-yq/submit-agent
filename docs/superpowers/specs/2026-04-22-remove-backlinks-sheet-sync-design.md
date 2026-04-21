# 移除 Backlinks 表的 Google Sheets 同步

## 背景

当前 Google Sheets 同步功能涉及 4 种数据类型：products、submissions、sites、backlinks。backlinks 数据量可能很大，同步时消耗大量 API 配额和时间。决定不再将 backlinks 表纳入同步范围。

## 方案

从 `SHEET_DEFS` 中移除 `backlinks` 条目，并清理 `SyncPanel.tsx` 中对应的读取和写入代码。

### 改动文件

#### 1. `extension/src/lib/sync/types.ts`

- 从 `SHEET_DEFS` 中删除 `backlinks` 条目

#### 2. `extension/src/components/SyncPanel.tsx`

- 上传流程：移除 `listBacklinks()` 调用及对应的 `backlinks` 变量，`data` 对象中不再包含 `backlinks` 字段
- 下载流程：移除 backlinks 数据的字段校验逻辑和 `bulkPutBacklinks()` 调用，移除 `clearBacklinks()` 调用

### 不做的事情

- 不删除 `BacklinkRecord` 类型定义（`lib/types.ts`）
- 不删除 `db.ts` 中的 backlinks CRUD 函数
- 不删除 backlinks 相关的 UI 组件和分析逻辑
- 不修改 `sheets-client.ts` 或 `serializer.ts`（它们遍历 `SHEET_DEFS`，移除后自动跳过 backlinks）

### 数据影响

- IndexedDB 中的 backlinks 数据完全不受影响
- `analysisResult` 字段之前就不同步到 Google Sheet，无变化
- products、submissions、sites 的同步逻辑不变
