# 外链分析并行化设计

## 背景

当前外链批量分析使用 `for...await` 顺序处理，每条 URL 需要打开 Chrome 标签页加载页面（5-25 秒/条）。一批 2000 条耗时 6-7 小时。Chrome 扩展架构天然支持同时打开多个标签页，瓶颈在调度逻辑而非架构限制。

## 决策

- **并发数**：固定 3 并发
- **调度模式**：工作池（Worker Pool），完成一条立即填入下一条
- **进度显示**：保持现有的 `currentIndex/batchSize` 样式
- **停止行为**：立即中断所有正在进行的分析

## 改动范围

仅修改 `extension/src/hooks/useBacklinkAnalysis.ts`，其他文件无需改动。

## 核心设计

### 1. 工作池调度

将现有的 `for...await` 循环替换为 3 个并发 worker 函数：

```typescript
let nextIndex = 0

async function runSlot(): Promise<void> {
    while (!stopRequestedRef.current) {
        const i = nextIndex++
        if (i >= batch.length) break
        setCurrentIndex(i)
        await analyzeOne(batch[i], `${i + 1}/${batch.length}`)
    }
}

await Promise.allSettled([runSlot(), runSlot(), runSlot()])
```

3 个 `runSlot` 并发运行，各自从共享的 `nextIndex` 索引取任务。任意一个完成立即取下一条，保持满载。`stopRequestedRef.current` 为 `true` 时所有循环在下一轮退出。

### 2. AbortController 管理

当前使用单例 `abortRef`，每次 `analyzeOne` 调用会覆盖前一个。并行时需要每个分析持有独立的 AbortController。

改动：
- 移除顶层 `abortRef`
- 维护 `activeControllers: Set<AbortController>` 集合
- `analyzeOne` 每次创建独立的 `AbortController`，开始时加入集合，结束时移除
- `stop()` 遍历集合并 abort 所有 controller

### 3. 停止流程

1. `stop()` 调用 → `stopRequestedRef.current = true`
2. 遍历 `activeControllers` 逐一 `abort()` → 正在分析的 `analyzeBacklink` 收到 abort 信号
3. `analyzeBacklink` 内部 abort → background 的 `handleFetchPageContent` 被中断
4. `handleFetchPageContent` 的 `finally` 关闭对应 Chrome 标签页
5. 所有 `runSlot` 的 `await` 抛出 AbortError → `Promise.allSettled` 静默捕获
6. `startAnalysis` 的 `finally` 正常执行清理

## 不需要改动的部分

- `background.ts` 的 `handleFetchPageContent` — 无状态，天然支持并发
- `backlink-analyzer.ts` 的 `analyzeBacklink` — 已支持 `signal` 参数
- UI 组件 — 进度显示接口不变
- IndexedDB 操作 — 每条记录独立更新，`setBacklinks` 使用函数式更新，并发安全

## 风险评估

- **内存**：同时 3 个标签页，内存增加约 2-3x，现代浏览器可承受
- **CPU**：DOM 分析是毫秒级操作，瓶颈在网络 I/O
- **React 状态**：`setBacklinks(prev => prev.map(...))` 函数式更新，并发安全

## 预期效果

2000 条批次耗时从 6-7 小时降至约 2-3 小时。
