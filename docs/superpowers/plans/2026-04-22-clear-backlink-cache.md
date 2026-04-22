# 清空外链缓存功能 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在外链分析面板工具栏右侧添加"清空缓存"按钮，一键清空 IndexedDB backlinks 表和 React 状态中的所有缓存数据。

**Architecture:** 在 `useBacklinkState` hook 中新增 `clearAll()` 方法，清空 IndexedDB backlinks 表并重置所有 React state（backlinks、logs、batchHistory）。BacklinkToolbar 接收 `onClearAll` 回调，点击时弹确认对话框后调用。BacklinkAnalysis 作为中间层传递回调。

**Tech Stack:** React hooks, IndexedDB (idb), Chrome Extension sidepanel, Tailwind CSS

---

## File Structure

| 文件 | 操作 | 职责 |
|---|---|---|
| `extension/src/hooks/useBacklinkState.ts` | 修改 | 新增 `clearAll()` 方法 |
| `extension/src/components/BacklinkToolbar.tsx` | 修改 | 添加"清空缓存"按钮 |
| `extension/src/components/BacklinkAnalysis.tsx` | 修改 | 传递 `onClearAll` 回调 |
| `extension/src/entrypoints/sidepanel/App.tsx` | 修改 | 将 `clearAll` 传入 BacklinkAnalysis |

---

### Task 1: 在 useBacklinkState 中新增 clearAll 方法

**Files:**
- Modify: `extension/src/hooks/useBacklinkState.ts`

- [ ] **Step 1: 添加 clearBacklinks 导入和 clearAll 方法**

在 `useBacklinkState.ts` 中：

将第 3 行的导入语句从：
```typescript
import { listBacklinks, saveBacklink, getBacklinkByUrl } from '@/lib/db'
```
改为：
```typescript
import { listBacklinks, saveBacklink, getBacklinkByUrl, clearBacklinks } from '@/lib/db'
```

在 `dismissBatch` 回调（第 98-101 行）之后、`return` 语句（第 103 行）之前，添加 `clearAll` 方法：

```typescript
		const clearAll = useCallback(async () => {
			await clearBacklinks()
			setBacklinks([])
			setBatchHistory([])
			setActiveBatchId(null)
			currentBatchIdRef.current = null
			setLogs([])
			setTotalLogCount(0)
			logIdRef.current = 0
		}, [])
```

在 return 对象中（第 103-121 行），在 `dismissBatch` 之后添加 `clearAll`：

```typescript
			dismissBatch,
			clearAll,
```

- [ ] **Step 2: 验证构建通过**

Run: `npm run build`
Expected: 构建成功，无错误

- [ ] **Step 3: 提交**

```bash
git add extension/src/hooks/useBacklinkState.ts
git commit -m "feat: useBacklinkState 添加 clearAll 方法清空所有缓存数据"
```

---

### Task 2: BacklinkToolbar 添加清空缓存按钮

**Files:**
- Modify: `extension/src/components/BacklinkToolbar.tsx`

- [ ] **Step 1: 更新 BacklinkToolbarProps 接口和组件参数**

在 `BacklinkToolbar.tsx` 的 `BacklinkToolbarProps` 接口中（第 4-12 行），在 `onStop` 属性后添加：

```typescript
	onClearAll: () => void
```

在组件解构参数中（第 14-22 行），在 `onStop` 后添加 `onClearAll`：

```typescript
	onClearAll,
```

- [ ] **Step 2: 添加清空缓存按钮**

在工具栏底部的统计区域（第 140 行的 `<div className="shrink-0 px-4 py-2 ...">`），在统计信息 `<div className="ml-auto ...">` 之前，添加清空缓存按钮：

在 `</>` (第 169 行 `<>` 的关闭标签) 之后、`<div className="ml-auto ...">` (第 170 行) 之前，插入：

```tsx
					<Button
						variant="outline"
						size="xs"
						onClick={() => {
							if (window.confirm('确定要清空所有外链分析缓存吗？此操作不可撤销。')) {
								onClearAll()
							}
						}}
						disabled={isRunning || stats.total === 0}
					>
						{'清空缓存'}
					</Button>
```

- [ ] **Step 3: 验证构建通过**

Run: `npm run build`
Expected: 构建成功，无错误

- [ ] **Step 4: 提交**

```bash
git add extension/src/components/BacklinkToolbar.tsx
git commit -m "feat: BacklinkToolbar 添加清空缓存按钮"
```

---

### Task 3: BacklinkAnalysis 传递 onClearAll 回调

**Files:**
- Modify: `extension/src/components/BacklinkAnalysis.tsx`

- [ ] **Step 1: 更新 BacklinkAnalysisProps 接口**

在 `BacklinkAnalysis.tsx` 的 `BacklinkAnalysisProps` 接口中（第 18 行 `onClearLogs` 之后），添加：

```typescript
	onClearAll: () => void
```

在组件解构参数中（第 33 行 `onClearLogs` 之后），添加：

```typescript
		onClearAll,
```

在 `<BacklinkToolbar>` 组件调用中（第 50 行 `onStop={onStop}` 之后），添加：

```typescript
					onClearAll={onClearAll}
```

- [ ] **Step 2: 验证构建通过**

Run: `npm run build`
Expected: 构建成功，无错误

- [ ] **Step 3: 提交**

```bash
git add extension/src/components/BacklinkAnalysis.tsx
git commit -m "feat: BacklinkAnalysis 传递 onClearAll 回调"
```

---

### Task 4: App.tsx 连接 clearAll 到 BacklinkAnalysis

**Files:**
- Modify: `extension/src/entrypoints/sidepanel/App.tsx`

- [ ] **Step 1: 传递 clearAll 到 BacklinkAnalysis**

在 `App.tsx` 的 `<BacklinkAnalysis>` 组件调用中（第 264 行 `onClearLogs={backlinkState.clearLogs}` 之后），添加：

```typescript
						onClearAll={backlinkState.clearAll}
```

- [ ] **Step 2: 运行构建并验证**

Run: `npm run build`
Expected: 构建成功，无错误

- [ ] **Step 3: 提交**

```bash
git add extension/src/entrypoints/sidepanel/App.tsx
git commit -m "feat: App 连接 clearAll 到外链分析面板"
```

---

### Task 5: 验证完整功能

- [ ] **Step 1: 运行最终构建**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 2: 在浏览器中手动测试**

1. 打开扩展 sidepanel，切换到"外链分析" tab
2. 导入一些 CSV 数据或手动添加 URL
3. 确认工具栏右侧出现"清空缓存"按钮
4. 确认按钮在有数据时可点击，无数据时 disabled
5. 点击按钮，确认弹出 confirm 对话框
6. 取消对话框，确认数据未清空
7. 再次点击并确认，确认面板回到空白状态
8. 确认外链资源库（提交 tab）中的数据未受影响
