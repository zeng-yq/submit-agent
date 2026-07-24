# SP-5 技术债清理 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清理 SP-1~4 累积的技术债——装 @types/jsdom 清 6 个 TS7016、删调试日志与死代码、polish 注释/风格。

**Architecture:** 纯清理，零行为变更。核心项（类型包/日志/死码）+ polish（注释/JSDoc/风格）分两任务，各单 commit。

**Tech Stack:** TypeScript、WXT、Vitest + jsdom。别名 `@/*` → `src/*`。

## Global Constraints

- 测试命令：`pnpm test`（基线 **357 / 28 文件全绿**）。每步全绿。
- 类型检查：`pnpm exec tsc --noEmit`（基线约 27 错）——A1 后应**减少 6**（TS7016），其余净零。
- **零行为变更**：删调试日志/死代码/订正注释不改运行时逻辑。
- 不动 SP-1~4 架构产物结构。
- 提交规范：中文 conventional commit。

---

## Task 1: 核心清理（@types/jsdom + 调试日志 + 死代码）

**Files:**
- Modify: `extension/package.json`（+ `@types/jsdom` devDep）
- Modify: `src/hooks/useFloatFill.ts`（删 :66、:131 调试日志）
- Modify: `src/hooks/useSites.ts`（删 :64、:104、:142 调试日志）
- Modify: `src/agent/floatButtonUi.ts`（删 :516-517 btnWrap 死代码）

- [ ] **Step 1: 装 @types/jsdom**

Run（在 `extension/` 下）: `pnpm add -D @types/jsdom`
Expected: `package.json` devDependencies 加 `@types/jsdom`。

- [ ] **Step 2: 确认 6 个 TS7016 消除**

Run: `pnpm exec tsc --noEmit 2>&1 | grep -c "TS7016"`
Expected: **0**（装 @types/jsdom 前是 6）。

- [ ] **Step 3: 删 useFloatFill.ts 2 处 [SA-DIAG] 日志**

删 `src/hooks/useFloatFill.ts` 的这两行（仅删 console.log 行，不动周围）：
- `:66` 附近：`console.log('[SA-DIAG] pathA', { verifyResult: r.verifyResult, filled: r.filled, failed: r.failed, isBlogComment, verified })`
- `:131` 附近：`console.log('[SA-DIAG] STATUS_UPDATE recv', { status, tabUrl, matchedName: matched.name })`

> 先 Read 这两处确认行号（SP-1~4 后可能偏移），删整行。

- [ ] **Step 4: 删 useSites.ts 3 处 [SA-DIAG] 日志**

删 `src/hooks/useSites.ts` 的这三行：
- markSubmitted 内：`console.log('[SA-DIAG] markSubmitted', { siteName, existingStatus: existing?.status, existingId: existing?.id, verifyResult, stack: new Error().stack?.split('\n').slice(2, 5).join(' <- ') })`
- markFailed 内：`console.log('[SA-DIAG] markFailed', { siteName, existingStatus: existing?.status, existingId: existing?.id, error, verifyResult, stack: new Error().stack?.split('\n').slice(2, 5).join(' <- ') })`
- resetSubmission 内：`console.log('[SA-DIAG] resetSubmission', { siteName, existingStatus: existing?.status, stack: new Error().stack?.split('\n').slice(2, 5).join(' <- ') })`

> 先 Read 确认行号，删整行。

- [ ] **Step 5: 删 floatButtonUi.ts btnWrap 死代码**

删 `src/agent/floatButtonUi.ts` 的：
```ts
const btnWrap = document.createElement('div')
btnWrap.style.position = 'relative'
```
（:516-517 附近，创建后从不 appendChild。先 Read 确认行号 + 确认无后续引用 btnWrap。）

- [ ] **Step 6: 验证**

Run: `grep -rn "\[SA-DIAG\]" extension/src` → 无输出。
Run: `grep -n "btnWrap" extension/src/agent/floatButtonUi.ts` → 无输出。
Run: `pnpm exec tsc --noEmit 2>&1 | grep -c "error TS"` → 约 21（27 基线 − 6 TS7016）。
Run: `pnpm test` → 357 全绿。

- [ ] **Step 7: 提交**

```bash
git add extension/package.json extension/pnpm-lock.yaml extension/src/hooks/useFloatFill.ts extension/src/hooks/useSites.ts extension/src/agent/floatButtonUi.ts
git commit -m "chore: 装 @types/jsdom 清 TS7016 + 删 [SA-DIAG] 调试日志 + btnWrap 死代码"
```

---

## Task 2: polish（docstring/JSDoc/风格）+ 回归

**Files:**
- Modify: `src/agent/floatButtonStore.ts:4`（docstring 计数订正）
- Modify: `src/agent/field-filter.ts`（isHoneypotField JSDoc）
- Modify: `src/agent/floatButtonUi.ts`（onMainClick 风格统一）
- Modify: `src/agent/FloatButton.content.ts`（performDelete siteName 简化）

- [ ] **Step 1: floatButtonStore.ts docstring 订正**

把 `src/agent/floatButtonStore.ts:4` 附近的 docstring（"原模块级 8 个 let..."）订正为：
```
原模块级 8 个 let（host/shadow/mainBtn + currentState/currentSubmissionState/userEnabled/isKnownSite/matchedSiteName）
+ 内联 messageListener，收进 class（host/shadow/mainBtn 折叠为 handle）。
```
（先 Read 现状 docstring 确认确切措辞再订正。）

- [ ] **Step 2: field-filter.ts isHoneypotField JSDoc 订正**

`src/agent/field-filter.ts` 的 `isHoneypotField` 上方 JSDoc `Threshold: score >= 50` → `Threshold: score >= HONEYPOT_THRESHOLD (=50)`。（先 grep 定位确切行。）

- [ ] **Step 3: floatButtonUi.ts onMainClick 风格统一**

`mainBtn.addEventListener('click', opts.callbacks.onMainClick)` → `mainBtn.addEventListener('click', () => opts.callbacks.onMainClick())`（与其它 callback 的箭头包裹风格一致；onMainClick 必填故无 `?.`）。

- [ ] **Step 4: FloatButton.content.ts performDelete siteName 简化**

performDelete 内 `const siteName = store.matchedSiteName` + `payload: { siteName }` → 直接 `payload: { siteName: store.matchedSiteName }`（删局部捕获，因同步无 await 间隙；`.then` 回调不引用 siteName）。

- [ ] **Step 5: B5/B6 评估（CSS 边界空白 + FormField 枚举顺序）**

两项均为零可观测收益（CSS 解析忽略边界空白；无代码遍历 FormField keys）。
- B5（CSS 模板边界）：若仅需调整 createButton 内 CSS template literal 首尾换行与原一致且不降可读性 → 做；否则跳过。
- B6（FormField 枚举顺序）：重构 buildAndStampField 让 selector 在 tagName 前需把 selector 提出为独立构造——**降低可读性且零收益 → 跳过**。
在 report 记录决定。

- [ ] **Step 6: 回归**

Run: `pnpm exec tsc --noEmit 2>&1 | grep -c "error TS"` → 约 21（与 T1 后一致，净零新增）。
Run: `pnpm test` → 357 全绿。

- [ ] **Step 7: 提交**

```bash
git add src/agent/floatButtonStore.ts src/agent/field-filter.ts src/agent/floatButtonUi.ts src/agent/FloatButton.content.ts
git commit -m "style: polish docstring/JSDoc/onMainClick/siteName（零行为变更）"
```

---

## Self-Review 笔记

**Spec 覆盖**：A1(T1)✅ A2(T1)✅ A3(T1)✅ B1-B4(T2)✅ B5/B6(T2 评估)✅。排除项（analysisConcurrency/confirmUnmatched/hideDeletePopover/test as any）spec §C 已说明。

**风险**：零行为变更；A1 减 tsc 错误（不增）；删调试日志仅删 console.log 行（不动逻辑）；polish 仅注释/风格。357 全绿 + tsc 净零（−6）是硬守门。

**完成判定**：SP-5 完成后 5-SP 重构全部结束。
