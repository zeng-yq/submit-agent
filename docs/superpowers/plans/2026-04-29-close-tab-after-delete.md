# 删除外链后自动关闭 Tab 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在浮动按钮成功删除外链后，自动关闭当前浏览器 tab。

**Architecture:** 浮动按钮删除成功后，向后台发送 `CLOSE_TAB` 消息（fire-and-forget），后台通过 `chrome.tabs.remove(sender.tab.id)` 关闭 tab。

**Tech Stack:** Chrome Extension MV3, WXT 框架, TypeScript

---

### Task 1: 新增 CLOSE_TAB 消息类型

**Files:**
- Modify: `extension/src/lib/types.ts:107-112`

- [ ] **Step 1: 在 MessageType 联合类型中添加 `'CLOSE_TAB'`**

在 `extension/src/lib/types.ts` 第 112 行 `'STATUS_UPDATE'` 之后追加：

```typescript
export type MessageType =
	| 'SUBMIT_CONTROL'
	| 'FETCH_PAGE_CONTENT'
	| 'FLOAT_BUTTON_TOGGLE'
	| 'FLOAT_FILL'
	| 'STATUS_UPDATE'
	| 'CLOSE_TAB'
```

- [ ] **Step 2: 运行构建验证类型正确**

Run: `cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent/extension && npm run build`
Expected: 构建成功（无类型错误）

- [ ] **Step 3: 提交**

```bash
git add extension/src/lib/types.ts
git commit -m "feat: 新增 CLOSE_TAB 消息类型"
```

---

### Task 2: 后台添加 CLOSE_TAB 消息处理

**Files:**
- Modify: `extension/src/entrypoints/background.ts:26-27`（在 DELETE_SITE 分支之后）

- [ ] **Step 1: 在消息监听器中新增 CLOSE_TAB 分支**

在 `background.ts` 第 27 行 `return handleDeleteSite(message, sendResponse)` 之后、`} else {` 之前，插入新的 else if 分支：

```typescript
		} else if (message.type === 'DELETE_SITE') {
			return handleDeleteSite(message, sendResponse)
		} else if (message.type === 'CLOSE_TAB') {
			if (sender.tab?.id != null) {
				chrome.tabs.remove(sender.tab.id).catch(() => {})
			}
		} else {
```

- [ ] **Step 2: 运行构建验证**

Run: `cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent/extension && npm run build`
Expected: 构建成功

- [ ] **Step 3: 提交**

```bash
git add extension/src/entrypoints/background.ts
git commit -m "feat: 后台处理 CLOSE_TAB 消息，关闭发送者的 tab"
```

---

### Task 3: 浮动按钮删除成功后发送 CLOSE_TAB

**Files:**
- Modify: `extension/src/agent/FloatButton.content.ts:451-454`

- [ ] **Step 1: 在删除成功回调中发送 CLOSE_TAB 消息**

将 `handleDeleteClick` 中的成功处理从：

```typescript
		}).then((response: any) => {
			if (response?.success) {
				removeButton()
			}
```

改为：

```typescript
		}).then((response: any) => {
			if (response?.success) {
				chrome.runtime.sendMessage({ type: 'CLOSE_TAB' })
				removeButton()
			}
```

- [ ] **Step 2: 运行构建验证**

Run: `cd /Users/fuqian/Documents/CODE/浏览器插件/submit-agent/extension && npm run build`
Expected: 构建成功

- [ ] **Step 3: 提交**

```bash
git add extension/src/agent/FloatButton.content.ts
git commit -m "feat: 浮动按钮删除外链成功后自动关闭当前 tab"
```
