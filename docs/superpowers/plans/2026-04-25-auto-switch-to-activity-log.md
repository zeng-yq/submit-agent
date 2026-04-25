# 提交时自动切换到活动日志面板 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提交外链时，无论从哪个入口触发，自动将侧边面板切换到「外链提交 > 活动日志」面板。

**Architecture:** 在 App.tsx 中新增 useEffect 监听 engineStatus，当引擎变为活跃状态时自动切换顶层标签页到 `submit`。Dashboard 已有的逻辑会在 `isEngineActive` 时自动切到 `log` 子标签，无需修改。

**Tech Stack:** React 19, TypeScript

---

### Task 1: 添加引擎状态监听，自动切换顶层标签页

**Files:**
- Modify: `extension/src/entrypoints/sidepanel/App.tsx:113-120`（在 `handleStartSite` 回调定义之后、现有 useEffect 之前插入）

- [ ] **Step 1: 在 App.tsx 中添加 useEffect**

在 `handleStartSite` 回调（第 113 行）之后、`// Reload backlinks` 注释（第 115 行）之前，插入以下代码：

```tsx
	// 当提交引擎激活时，自动切到外链提交标签页
	useEffect(() => {
		const isActive = engineStatus === 'running' || engineStatus === 'analyzing' || engineStatus === 'filling'
		if (isActive) {
			setTab('submit')
		}
	}, [engineStatus])
```

- [ ] **Step 2: 验证构建通过**

Run: `cd extension && npm run build`
Expected: 构建成功，无 TypeScript 错误

- [ ] **Step 3: 提交**

```bash
git add extension/src/entrypoints/sidepanel/App.tsx
git commit -m "feat: 提交外链时自动切换到活动日志面板"
```
