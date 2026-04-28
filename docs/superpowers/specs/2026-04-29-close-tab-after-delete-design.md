# 设计文档：删除外链后自动关闭浏览器 Tab

**日期**: 2026-04-29
**状态**: 已批准

## 背景

用户在浏览器中访问某个已收录的外链站点页面时，浮动按钮会显示"从外链库删除"选项。当前行为：删除成功后，浮动按钮从 DOM 中移除，但页面 tab 仍然保持打开。用户需要手动关闭该 tab，增加了一步额外操作。

## 目标

在浮动按钮成功删除外链后，自动关闭当前浏览器的 tab，减少用户手动操作步骤。

## 约束

- 仅在**浮动按钮**的删除操作中触发，侧边栏的删除不影响
- 删除成功后**直接关闭** tab，无需二次确认（删除确认对话框已是最终确认）
- 关闭 tab 操作必须可靠，不受 `window.close()` 安全限制影响

## 方案

通过后台脚本使用 `chrome.tabs.remove()` 关闭 tab，而非在内容脚本中调用 `window.close()`（后者在内容脚本中有安全限制）。

## 详细设计

### 1. 新增消息类型

**文件**: `extension/src/lib/types.ts`

在 `MessageType` 联合类型中新增 `'CLOSE_TAB'`。在 `ExtMessage` 联合类型中新增 `{ type: 'CLOSE_TAB' }`。

无需 payload —— 后台通过消息发送者的 `sender.tab.id` 获取目标 tab。

### 2. 后台消息处理

**文件**: `extension/src/entrypoints/background.ts`

在消息监听器的 switch 中新增 `CLOSE_TAB` 分支：

1. 从 `sender.tab?.id` 获取 tab ID
2. 调用 `chrome.tabs.remove(tabId)` 关闭 tab
3. 如果 `sender.tab` 不存在，静默忽略
4. 如果 `chrome.tabs.remove` 失败，静默处理

### 3. 浮动按钮删除流程修改

**文件**: `extension/src/agent/FloatButton.content.ts`

在 `handleDeleteClick` 函数中，收到后台 `{ success: true }` 响应后：

1. 向后台发送 `{ type: 'CLOSE_TAB' }` 消息（fire-and-forget，不等待响应）
2. 调用 `removeButton()` 清理 DOM（tab 关闭前的视觉过渡）

### 4. 错误处理

- `chrome.tabs.remove` 失败（tab 已关闭等）：静默忽略
- `sender.tab` 为空：静默忽略
- 不影响已完成的删除操作

## 影响范围

| 文件 | 改动类型 | 改动量 |
|------|---------|-------|
| `types.ts` | 新增消息类型 | ~2 行 |
| `background.ts` | 新增消息处理分支 | ~10 行 |
| `FloatButton.content.ts` | 删除成功后发送关闭消息 | ~1 行 |

总计约 13 行代码改动，无新文件。

## 测试策略

- 手动测试：在已知外链页面点击浮动按钮删除，验证 tab 是否自动关闭
- 边界场景：删除失败时 tab 不应关闭
- 边界场景：快速连续点击删除按钮时行为正常
