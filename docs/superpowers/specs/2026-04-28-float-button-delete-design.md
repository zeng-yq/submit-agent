# 悬浮按钮外链删除功能设计

## 概述

在页面悬浮按钮中，状态开关旁增加删除按钮，允许用户直接从外链库中删除当前页面对应的外链。删除逻辑与侧边栏一致。

## UI 设计

在 `FloatButton.content.ts` 的 `createButton()` 中，当 `isKnownSite === true` 时渲染删除按钮。

### 布局

```
[状态开关] | [删除按钮 🗑] | [开始按钮 ▶]
```

- 删除按钮位于状态开关和开始按钮之间，用分隔线隔开
- 使用红色调 Trash2 风格 SVG 图标
- 悬停时图标颜色加深
- 显示条件和状态开关完全一致：仅当 `isKnownSite === true`

### 交互

1. 点击删除按钮 → 弹出 `confirm()` 确认对话框
2. 确认后发送删除消息到 background
3. 删除成功后移除整个悬浮按钮（因为页面不再是已知站点）

## 消息流

新增消息类型 `DELETE_SITE`：

```
FloatButton.content.ts
  → chrome.runtime.sendMessage({ type: 'DELETE_SITE', payload: { siteName } })
  → background.ts :: handleDeleteSite()
      → deleteSite(siteName)           -- 从 sites store 删除
      → deleteSubmissionsBySite(siteName) -- 删除关联的提交记录
      → reloadSites()                  -- 刷新缓存
      → 返回 { success: true }
  → FloatButton 收到成功响应
      → removeButton()                 -- 移除悬浮按钮
```

## 涉及文件

| 文件 | 改动内容 |
|---|---|
| `extension/src/agent/FloatButton.content.ts` | 添加删除按钮 DOM、样式、点击处理函数、发送 DELETE_SITE 消息 |
| `extension/src/background.ts` | 新增 `DELETE_SITE` 消息处理，执行删除逻辑并刷新站点缓存 |

## 删除后行为

- 删除成功后调用 `removeButton()` 移除悬浮按钮容器
- 下次页面加载时 `CHECK_SITE_MATCH` 返回 `isKnownSite: false`，悬浮按钮仅显示开始按钮

## 技术细节

### 删除按钮样式

- 图标大小与现有按钮图标一致
- 颜色使用 `#DC2626`（Tailwind red-600），悬停时变为 `#B91C1C`（red-700）
- 与分隔线配合，视觉上不突兀

### 确认对话框

```
confirm(`确定要从外链库中删除「${matchedSiteName}」吗？`)
```

与侧边栏 SiteCard 中的确认弹窗保持一致的文案风格。
