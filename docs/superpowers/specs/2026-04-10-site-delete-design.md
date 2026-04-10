# 外链站点删除功能设计

## 背景

在提交外链的过程中，部分外链可能提交失败或价值不高。用户需要从外链资源库中删除这些站点，以保持列表的整洁性。

## 需求

- 在每个站点卡片上添加删除按钮
- 删除前弹出确认对话框
- 删除站点时同时删除其所有提交记录
- 删除后自动刷新列表

## 方案

仅在 SiteCard 卡片上添加删除按钮（方案 A），不涉及详情页。这是用户最常用的视图，改动最小。

## 设计详情

### 1. UI 层

**SiteCard.tsx**：
- 在卡片右上角（状态标签左侧）添加垃圾桶图标按钮（lucide-react `Trash2`）
- `e.stopPropagation()` 阻止冒泡，避免触发卡片的 `onSelect`
- 按钮样式：半透明灰色，hover 时变红
- 点击后弹出确认对话框（`confirm()`），确认后调用 `onDelete(site.name)`

**Dashboard.tsx**：
- 新增 `handleDeleteSite` 回调，传递给 `<SiteCard onDelete={...} />`
- 对失败 Tab 中内联渲染的站点卡片，也同样添加删除按钮
- 删除成功后从 state 中移除该站点，同时清理对应的 submission 记录

### 2. Hook 层

**useSites.ts**：
- 新增 `deleteSite(siteName: string)` 异步函数
- 调用 `db.deleteSite(siteName)` 删除站点
- 调用 `db.deleteSubmissionsBySite(siteName)` 删除关联提交记录
- 删除后更新 state

### 3. 数据层

**db.ts**：
- 新增 `deleteSubmissionsBySite(siteName: string)` 函数，按 `siteName` 索引查询并删除所有关联 submission
- 复用已有 `deleteSite(name)` 函数

### 4. 交互细节

- 确认对话框：`确定要删除「{siteName}」吗？该站点的提交记录也将被删除。`
- 删除后列表自动刷新
- 如果当前正在查看被删除站点的详情页（SubmitFlow），应返回列表页

## 涉及文件

| 文件 | 改动 |
|------|------|
| `extension/src/lib/db.ts` | 新增 `deleteSubmissionsBySite()` |
| `extension/src/hooks/useSites.ts` | 新增 `deleteSite()` 函数并暴露 |
| `extension/src/components/SiteCard.tsx` | 添加删除图标按钮，新增 `onDelete` prop |
| `extension/src/components/Dashboard.tsx` | 新增 `handleDeleteSite`，传递给 SiteCard；失败 Tab 卡片也加删除按钮 |
| `extension/src/entrypoints/sidepanel/App.tsx` | 可能需处理删除当前查看站点时的视图回退 |
