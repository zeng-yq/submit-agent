# 外链分析并行化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将外链批量分析从顺序处理改为 3 并发工作池模式，预计将 2000 条批次耗时从 6-7 小时降至 2-3 小时。

**Architecture:** 在 `useBacklinkAnalysis.ts` 中用 3 个并发 worker 函数替换现有的 `for...await` 循环。每个 worker 独立从共享索引取任务，持有独立的 AbortController。停止时同时中断所有活跃的分析。

**Tech Stack:** React hooks, TypeScript, Chrome Extension MV3

---

### Task 1: 重构 AbortController 管理

**Files:**
- Modify: `extension/src/hooks/useBacklinkAnalysis.ts:10-11,20-23`

**目的：** 将单例 `abortRef` 替换为 `Set<AbortController>` 集合，支持多个分析并发运行时各自持有独立的控制器。

- [ ] **Step 1: 修改 AbortController 存储**

将第 10-11 行：
```typescript
const stopRequestedRef = useRef(false)
const abortRef = useRef<AbortController | null>(null)
```

改为：
```typescript
const stopRequestedRef = useRef(false)
const activeControllersRef = useRef(new Set<AbortController>())
```

- [ ] **Step 2: 修改 analyzeOne 中的 AbortController 使用**

将第 20-23 行：
```typescript
async (backlink: BacklinkRecord, progress?: string): Promise<void> => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
```

改为：
```typescript
async (backlink: BacklinkRecord, progress?: string): Promise<void> => {
    const ac = new AbortController()
    activeControllersRef.current.add(ac)
```

- [ ] **Step 3: 修改 analyzeOne 的 finally 块**

将第 100 行：
```typescript
} finally {
    setAnalyzingId(null)
}
```

改为：
```typescript
} finally {
    activeControllersRef.current.delete(ac)
    setAnalyzingId(null)
}
```

- [ ] **Step 4: 修改 stop 函数**

将第 181-184 行：
```typescript
const stop = useCallback(() => {
    stopRequestedRef.current = true
    abortRef.current?.abort()
}, [])
```

改为：
```typescript
const stop = useCallback(() => {
    stopRequestedRef.current = true
    for (const ac of activeControllersRef.current) {
        ac.abort()
    }
}, [])
```

- [ ] **Step 5: 构建验证**

Run: `cd extension && npm run build`
Expected: 构建成功，无 TypeScript 错误

- [ ] **Step 6: Commit**

```bash
git add extension/src/hooks/useBacklinkAnalysis.ts
git commit -m "refactor: 将 AbortController 从单例改为 Set 集合，为并行分析做准备"
```

---

### Task 2: 替换顺序循环为 3 并发工作池

**Files:**
- Modify: `extension/src/hooks/useBacklinkAnalysis.ts:155-162`

**目的：** 将 `for...await` 顺序循环替换为 3 个并发 worker 函数，每完成一条立即取下一条，保持满载。

- [ ] **Step 1: 替换核心循环**

将第 155-162 行：
```typescript
				const batch = filtered
				setBatchSize(batch.length)

				for (let i = 0; i < batch.length; i++) {
					if (stopRequestedRef.current) break
					setCurrentIndex(i)
					await analyzeOne(batch[i], `${i + 1}/${batch.length}`)
				}
```

改为：
```typescript
				const batch = filtered
				setBatchSize(batch.length)

				let nextIndex = 0

				const runSlot = async (): Promise<void> => {
					while (!stopRequestedRef.current) {
						const i = nextIndex
						if (i >= batch.length) break
						nextIndex++
						setCurrentIndex(i)
						await analyzeOne(batch[i], `${i + 1}/${batch.length}`)
					}
				}

				const CONCURRENCY = 3
				const workers = Array.from({ length: Math.min(CONCURRENCY, batch.length) }, () => runSlot())
				await Promise.allSettled(workers)
```

注意：
- `nextIndex` 使用 `let` 在闭包间共享，JS 单线程保证 `i = nextIndex; nextIndex++` 无竞态
- `Math.min(CONCURRENCY, batch.length)` 处理 batch 不足 3 条的边界情况
- `Promise.allSettled` 保证即使某个 worker 抛出异常，其他 worker 也能正常完成

- [ ] **Step 2: 构建验证**

Run: `cd extension && npm run build`
Expected: 构建成功，无 TypeScript 错误

- [ ] **Step 3: Commit**

```bash
git add extension/src/hooks/useBacklinkAnalysis.ts
git commit -m "feat: 外链分析改为 3 并发工作池模式，提升批量分析吞吐量"
```

---

### Task 3: 运行现有测试验证无回归

**Files:**
- Test: `extension/src/__tests__/backlink-analyzer.test.ts`

- [ ] **Step 1: 运行全部测试**

Run: `cd extension && npm test`
Expected: 所有测试通过

- [ ] **Step 2: 最终构建验证**

Run: `cd extension && npm run build`
Expected: 构建成功
