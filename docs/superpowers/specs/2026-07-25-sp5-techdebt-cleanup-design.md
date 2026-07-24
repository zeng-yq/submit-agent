# SP-5 设计：技术债清理（5-SP 重构收尾）

- **日期**：2026-07-25
- **状态**：待评审
- **分支**：`dev`
- **系列**：自动提交外链代码分层重构的第 5 个、也是最后一个子项目（SP-1/2/3a/3b/4 已完成）

---

## 0. 上下文

5-SP 分层重构的**结构性工作（SP-1~4）全部完成**：5 层架构（L1 表现/L2 编排/L3 消息/L4 领域/L5 基础设施）就位。SP-4 最终 review 后，各 SP 累积了一批 Minor + 原始 SDD 技术债清单里的项。本 SP 收尾清理这些低风险、零行为变更的债务。

---

## 1. 范围（核心 3 项 + polish 全做）

### A. 核心项（高价值降噪/清理）

**A1. `@types/jsdom` devDep** — 装 `@types/jsdom`，清掉 6 个 jsdom TS7016 警告（comment-submit.test / field-filter.test / dom-writers.test 等的 `import { JSDOM } from 'jsdom'`）。这是 tsc 噪声的最大来源。

**A2. 删 5 处 `[SA-DIAG]` 调试日志**：
- `useFloatFill.ts:66`（pathA）、`:131`（STATUS_UPDATE recv）
- `useSites.ts:64`（markSubmitted）、`:104`（markFailed）、`:142`（resetSubmission）
- 这些是带 `stack trace` 的调试残留，不应留在生产代码。删除（仅删 console.log 行，不动周围逻辑）。

**A3. 删 `btnWrap` 死代码**（`floatButtonUi.ts:516-517`）：`const btnWrap = document.createElement('div'); btnWrap.style.position = 'relative'` 创建后从不 appendChild。pre-existing 死代码（SP-4 逐字搬运时保留）。

### B. Polish 项（零行为影响）

**B1. `floatButtonStore.ts:4` docstring 计数订正**：现写"原模块级 8 个 let"但括号枚举含 messageListener（非原 let）致 off-by-1。改为准确：「原模块级 8 个 let（host/shadow/mainBtn + currentState/currentSubmissionState/userEnabled/isKnownSite/matchedSiteName）+ 内联 messageListener，收进 class（host/shadow/mainBtn 折叠为 handle）」。

**B2. `field-filter.ts` isHoneypotField JSDoc**：`Threshold: score >= 50` → `Threshold: score >= HONEYPOT_THRESHOLD (=50)`（与代码常量化对齐，防 prose 漂移）。

**B3. `floatButtonUi.ts` onMainClick 直传 → null-safe 一致**：`mainBtn.addEventListener('click', opts.callbacks.onMainClick)` → `mainBtn.addEventListener('click', () => opts.callbacks.onMainClick())`（与其它 callback 的 `() => opts.callbacks.onX?.()` 风格一致；onMainClick 必填故无 `?.`）。

**B4. `FloatButton.content.ts` performDelete siteName 捕获简化**：`const siteName = store.matchedSiteName` 后同步传入 sendMessage（无 await 间隙）→ 直接内联 `payload: { siteName: store.matchedSiteName }`。`.then` 回调只读 `response?.success`，不引用 siteName。

**B5. `floatButtonUi.ts` CSS 模板边界空白**（零视觉影响）：createButton 内 CSS template literal 首尾空白与原非字节级一致（CSS 解析忽略）。本项**视觉等价零收益**——评估后若改动降低可读性可跳过；若仅需调整首尾换行则顺带做。

**B6. `form-analyzer/index.ts` FormField 属性枚举顺序**（不可观测）：buildAndStampField 产出 `{...partial, selector}` 使 selector 在 tagName 后（原 rawField selector 在 tagName 前）。**全仓无 Object.keys/for...in 遍历 FormField**，运行时不可观测。本项**零可观测收益**——评估后若重构降低可读性可跳过。

### C. 已评估排除（非债 / 误报）

- **SettingsPanel 分析并发数**：`analysisConcurrency` 被 `useBacklinkAnalysis.ts:171` 使用（backlink 分析活跃）→ **非死 UI**，不动。
- **confirmUnmatched**（useFloatFill）：真实功能（确认未匹配站点）→ 非死代码。
- **submit-result-mapper 死分支**：无此文件，映射已 inline → 不适用。
- **backlinks 顺序 await**：未找到 `for...of await` → 已变。
- **hideDeletePopover 对称 API 未调用**（floatButtonStore）：对称设计的 dead surface（非 dead code），保留无害 → 跳过。
- **test as any 噪声**：测试 mock 夹具，vi.fn 泛型限制的过渡产物，逐个清理成本高收益低 → 跳过（A1 装 @types/jsdom 后部分 ts 警告已消）。

---

## 2. 非目标

- **零行为变更**：所有项都是清理/polish，不改运行时逻辑。
- **不动 SP-1~4 的架构产物**（messaging/pipeline/dom-writers/field-filter/floatButtonUi/store 等的结构）。
- **不重构**：仅删死代码、装类型包、订正注释/prose、统一风格。
- **不做 P0（验证正确性）**：仍延后（独立议题）。

---

## 3. 迁移计划（增量，每步测试绿，单 commit）

| 步 | 内容 | 风险 |
|---|---|---|
| 1 | A1：`pnpm add -D @types/jsdom`；确认 6 个 TS7016 消除 | 低 |
| 2 | A2：删 5 处 [SA-DIAG] 调试日志（仅删 console.log 行） | 低 |
| 3 | A3 + B1/B2/B3/B4：删 btnWrap；订正 docstring/JSDoc/onMainClick/siteName | 低 |
| 4 | B5/B6：评估 CSS 边界空白 + FormField 枚举顺序（零收益项，按可读性决定做/跳）；回归 + 手动验证 | 低 |

> 各项独立，可按步单 commit；也可合并为更少 commit。tsc 净零（A1 应**减少** 6 个错误）+ 357 测试维持全绿是硬约束。

---

## 4. 测试与验收

- `pnpm exec tsc --noEmit`：A1 后错误数**减少 6**（TS7016 清除）；其余项净零新增。
- `pnpm test`：357 维持全绿（删调试日志/死代码/订正注释不改行为）。
- grep `[SA-DIAG]` 在 src → 无输出。
- grep `btnWrap` → 无输出。
- 手动验证：浮动按钮/提交/状态更新全链路与 SP-4 后一致（确认删调试日志未误删逻辑）。

---

## 5. 完成判定

SP-5 完成后，**5-SP 分层重构全部结束**：5 层架构就位 + 技术债清理完毕。dev 分支可进入用户手动验证 + 合并流程。
