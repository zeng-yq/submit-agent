# SP-1 设计：消息契约层（L3）

- **日期**：2026-07-24
- **状态**：待评审
- **分支**：`dev`
- **系列**：自动提交外链代码分层重构的第 1 个子项目（SP-1 / 共 5）

---

## 0. 上下文：这是一次更大的重构的第 1 步

对"自动提交外链"全流程做了一次代码质量分析，结论是架构方向正确（规则管结构、LLM 管取值的"混合智能"+ 质量门禁），但在类型契约、模块边界、可测试性上有系统性短板。为提升可维护性与可扩展性，确定以 **5 层架构**为终态、拆成 5 个独立可交付的子项目增量推进：

| 序号 | 子项目 | 层 |
|---|---|---|
| **SP-1** | **消息契约层（本 spec）** | **L3** |
| SP-2 | 领域层抽取 + `executeFormFill` 拆分 + 依赖注入 | L2 / L4 |
| SP-3 | `SiteType` 策略对象 + `dom-utils` 拆分 + 字段构建去重 | L4 / L5 |
| SP-4 | `FloatButton` 拆 UI/Store/胶水 + 生命周期修复 | L1 / L2 |
| SP-5 | 技术债清理（SDD 两批 Minor 清单） | — |

**目标分层（依赖只向下）**：

```
L1 表现层    React 组件 / FloatButton UI（纯 UI，零 chrome.*）
L2 编排层    FormFillEngine 管道 / hooks / 状态机
L3 消息契约层 判别联合 / MessageRouter / handler 注册表   ← SP-1
L4 领域层    表单分析 / comment-submit / verify / 策略（纯、可测）
L5 基础设施层 dom-writers / chrome IPC 适配 / LLM client / 存储
```

每个 SP 走独立循环：brainstorm → spec → plan → 实现 → review，在 `dev` 分支增量推进，每个 SP 合并前保证全量测试全绿、`tsc` 净零新增错误。

---

## 1. 背景与目标

### 1.1 现状问题（SP-1 要解决的）

实测消息清单：**18 种 type**，其中 `FLOAT_FILL` 一个 type 被 **24 处 / 6 文件** 使用、承载 **14 个 action**；另有 4 条通信通道（content↔bg、bg→content、bg↔sidepanel、main↔iframe）。

1. **协议过载**：`FLOAT_FILL` 同时表示「UI 进度信号」（start/progress/done/error/no-product/no-match/reset/all-done/confirm，消费者 FloatButton + useFloatFill）和「content 指令」（analyze/fill/submit/annotate*/scroll-to-first/verify-moderation，消费者仅 content.ts）。导致 `background.ts:214-250` `handleFloatFill` 不得不三向转发：写 session + 开 sidepanel + 广播给 sidepanel + 从 session 反查 `floatFillTabId` 再 `chrome.tabs.sendMessage` 转发给 content。
2. **零类型安全**：`lib/types.ts:124-148` 定义了 `MessageType`/`FloatFillAction`/`ExtMessage`，**全库零 import**（死代码）。实际所有 handler 退化为 `{ type: string; action: string; payload?: unknown }`，全库 `any`/`as` 断言。`FloatFillAction` 只列 7 个 action，实际 14 个。
3. **响应契约 bug**：`content.ts:466` 在 iframe 提交超时兜底时返回 `{ ok: true, clicked: false, verifyResult: 'not_attempted', error: '...' }`——`ok:true` 与 `error` 并存，上游 `runSubmitAndVerify`（`FormFillEngine.ts:179`）只判 `!ok` 即跳过跨页复核，导致 **iframe 内部跳转场景被误判**（顶层跳转走 reject→verifyNavigation，iframe 内部跳转走此 ok:true 路径，处理不对称）。

### 1.2 目标

- G1：建立类型化的判别联合消息契约，消灭 `any`/`as` 字面量散布。
- G2：把过载的 `FLOAT_FILL` 拆为 `FILL_PROGRESS`（UI 信号）+ `TAB_COMMAND`（content 指令），消除 background 三向转发。
- G3：引入 `MessageRouter` 注册表，兼顾编译期穷尽性与运行期可扩展（新增指令 = 联合加一成员 + `router.on(...)` 一行，编译器强制两处同步）。
- G4：修复 `content.ts:466` 的 `ok:true + error` 响应契约 bug。
- G5：清理死类型（`lib/types.ts:124-148`）与死消息（`STATUS_UPDATE`/`SUBMIT_CONTROL`/`SITE_ADDED`）。

### 1.3 非目标（明确不做）

- **不改任何 payload 的业务语义**——只改 type/action 命名与路由结构，行为等价。
- **不动 iframe postMessage 桥梁**（`SA_MSG_SOURCE` 协议、`content.ts:136-289` 的 `submitViaIframe`/`fillIframeFields`/`requestIframeAnalysis`/`initRemoteCommentIframeHandlers`）。iframe 的 6 种消息**仅纳入类型联合**保持类型一致，传输/桥梁代码留作后续 SP。
- **不拆 `executeFormFill`、不引入 SiteType 策略、不拆 dom-utils**——分别是 SP-2/SP-3。
- **不做 P0 验证正确性改造**（正向成功信号）——留作分层完成后的下一轮；SP-1 的契约化为它铺路。

---

## 2. 目标设计

### 2.1 模块结构（新增）

```
src/messaging/
├── messages.ts          判别联合 ExtensionMessage + 各 type 的 payload/response 类型（纯类型，零运行时代码）
├── router.ts            MessageRouter：register + 穷尽 dispatch + 异步 keepalive
└── __tests__/
    └── router.test.ts   分发命中 / 穷尽性 / 未知类型忽略 / 异步保活 / handler 异常隔离
```

**handler 不搬迁**：留在 `content.ts`/`background.ts`/`useFloatFill`/`FloatButton.content.ts` 等原文件，仅从内联 if/else/switch 改为 `router.on(...)` 注册。改动外科手术化，风险最低。

### 2.2 完整消息目录（契约本体）

payload/response 形状**复用既有类型**（`FillResult`/`SubmitResponse`/`FormAnalysisResult`，见 `agent/types.ts`、`form-analyzer/types.ts`），不重新定义，避免漂移。

#### A. `FILL_PROGRESS`（原 FLOAT_FILL 的 UI 信号）— `chrome.runtime.sendMessage` 广播

| action | 方向 | payload | 备注 |
|---|---|---|---|
| `start` | FloatButton → bg | — | 触发提交（bg 开 sidepanel + 存 tabId） |
| `progress` | sidepanel → FloatButton | `{ filled?: number; failed?: number; message?: string }` | UI 进度 |
| `done` | sidepanel → FloatButton | `FillResult`（filled/failed/notes/verifyResult?/submitError?） | 终态：成功 |
| `error` | sidepanel → FloatButton | `{ message: string }` | 终态：失败 |
| `no-product` | sidepanel → FloatButton | — | 无产品档案 |
| `no-match` | sidepanel → FloatButton | — | 站点未匹配 |
| `reset` | sidepanel → FloatButton | — | 复位按钮态 |
| `all-done` | sidepanel → FloatButton | — | 批次完成 |
| `confirm` | sidepanel → FloatButton | — | 用户确认未匹配站点 |

> 注：`start` 是 FloatButton → bg 的触发，方向与其余相反；保留在 `FILL_PROGRESS` 内因其属于填充生命周期。bg 收到 `start` 后的副作用（开 sidepanel）由 bg 侧 handler 负责。

#### B. `TAB_COMMAND`（原 FLOAT_FILL 的 content 指令）— `chrome.tabs.sendMessage` 点对点（sidepanel/FormFillEngine → content.ts）

| action | payload | response |
|---|---|---|
| `analyze` | `{ siteType: SiteType }` | `FormAnalysisResult` |
| `fill` | `{ fields: FieldValueMap }` | `{ filled: number; failed: number; notes: string }` |
| `submit` | `{ commentSelector: string \| null }` | `SubmitResponse` |
| `annotate` | `{ fields: AnnotateField[] }` | `{ ok: boolean }` |
| `annotate-active` | `{ fields: AnnotateField[] }` | `{ ok: boolean }` |
| `annotate-clear` | — | `{ ok: boolean }` |
| `scroll-to-first` | — | `{ ok: boolean }` |
| `verify-moderation` | — | `{ ok: boolean; moderation: boolean }` |

#### C. 既有单一职责 type（形式化 payload）

| type | 方向 | payload / response |
|---|---|---|
| `CHECK_SITE_MATCH` | FloatButton → bg | req `{ url }` / resp `{ matched, siteName? }` |
| `FLOAT_BUTTON_TOGGLE` | SettingsPanel/FloatButton → bg | `{ enabled: boolean }` |
| `FLOAT_ADD_SITE` / `ADD_SITE` | FloatButton → bg | `{ site: SiteData }` |
| `DELETE_SITE` | FloatButton → bg | `{ siteName: string }` |
| `CLOSE_TAB` | FloatButton → bg | — |
| `FETCH_PAGE_CONTENT` | profile-generator/backlink-analyzer → bg | req `{ url }` / resp `{ content }` |
| `SUBMISSION_STATUS_CHANGED` | useSites → 广播 | `{ siteName, toggleState }` |
| `SITES_CHANGED` / `PRODUCTS_CHANGED` | → 广播 | — |

#### D. iframe type（**仅纳入联合，桥梁不动**）

`SUBMIT_IFRAME` / `REQUEST_IFRAME_ANALYSIS` / `FILL_IFRAME_FIELDS`（main → iframe）、`IFRAME_SUBMIT_RESULT` / `IFRAME_FILL_RESULT` / `IFRAME_ANALYSIS_RESULT`（iframe → main）。payload 形状照搬现有 `content.ts:136-289` 实现，仅形式化为类型。

#### E. 死消息（spec 标记，迁移清理）

`STATUS_UPDATE` / `SUBMIT_CONTROL` / `SITE_ADDED`——SDD 进度记录已标无发送方或无接收方。迁移时确认后删除（若发现仍有用法则补齐发送/接收方，二选一，不留半残）。

### 2.3 MessageRouter API

```ts
// src/messaging/messages.ts
export type FillProgressAction = 'start' | 'progress' | 'done' | 'error'
  | 'no-product' | 'no-match' | 'reset' | 'all-done' | 'confirm'
export type TabCommandAction = 'analyze' | 'fill' | 'submit'
  | 'annotate' | 'annotate-active' | 'annotate-clear' | 'scroll-to-first' | 'verify-moderation'

export type ExtensionMessage =
  | { type: 'FILL_PROGRESS'; action: FillProgressAction; payload?: ProgressPayload }
  | { type: 'TAB_COMMAND'; action: TabCommandAction; payload?: TabCommandPayload }
  | { type: 'CHECK_SITE_MATCH'; payload: { url: string } }
  | { type: 'CHECK_SITE_MATCH_RESULT'; payload: { matched: boolean; siteName?: string } }
  | { type: 'FLOAT_BUTTON_TOGGLE'; payload: { enabled: boolean } }
  | { type: 'FLOAT_ADD_SITE'; payload: { site: SiteData } }
  | { type: 'ADD_SITE'; payload: { site: SiteData } }
  | { type: 'DELETE_SITE'; payload: { siteName: string } }
  | { type: 'CLOSE_TAB' }
  | { type: 'FETCH_PAGE_CONTENT'; payload: { url: string } }
  | { type: 'SUBMISSION_STATUS_CHANGED'; payload: { siteName: string; toggleState: string } }
  | { type: 'SITES_CHANGED' }
  | { type: 'PRODUCTS_CHANGED' }
  | { type: 'SUBMIT_IFRAME'; payload: IframeSubmitPayload }
  | { type: 'REQUEST_IFRAME_ANALYSIS' }
  | { type: 'FILL_IFRAME_FIELDS'; payload: IframeFillPayload }
  | { type: 'IFRAME_SUBMIT_RESULT'; payload: IframeResultPayload }
  | { type: 'IFRAME_FILL_RESULT'; payload: IframeResultPayload }
  | { type: 'IFRAME_ANALYSIS_RESULT'; payload: IframeResultPayload }
```

```ts
// src/messaging/router.ts
export interface MsgCtx { sender: chrome.runtime.MessageSender; tabId?: number }

type Handler<M> = (msg: M, ctx: MsgCtx) => unknown | Promise<unknown>

export class MessageRouter {
  /** 注册「带 action」的 type（FILL_PROGRESS / TAB_COMMAND） */
  on<T extends ActionMsg['type'], A extends ActionsOf<T>>(
    type: T, action: A, handler: Handler<ExtractActionMsg<T, A>>
  ): void
  /** 注册「无 action」的 type */
  on<T extends ActionlessMsg['type']>(type: T, handler: Handler<ExtractMsg<T>>): void
  /** 绑定到 chrome.runtime.onMessage（内部管理 return true 保活） */
  attachRuntimeListener(): void
  /** 类型安全的 tabs.sendMessage 封装 */
  sendToTab<T extends ExtensionMessage>(tabId: number, msg: T): Promise<unknown>
  sendToRuntime<T extends ExtensionMessage>(msg: T): Promise<unknown>
}
```

### 2.4 穷尽性与扩展性保证

- **type 集合穷尽性（编译期保证）**：`dispatch` 的 default 分支调用 `assertNever(msg: never)`。新增 union 成员而不加 dispatch case → tsc 报错。这保证「dispatch 认识所有 type」。
- **handler 注册覆盖（测试期保证）**：`router.on()` 是运行时注册，编译器无法强制开发者调用了它。因此由 `router.test.ts` 增加一条「每个 union 成员至少注册一个 handler」的覆盖测试守门（遍历 union，断言 router 内部表非空）。plan 阶段可进一步评估用「中心化 `registerAllHandlers(router)` 函数 + 类型映射」把注册也提到编译期，但属优化项，非本 SP 必需。
- **扩展性**：新增一个 content 指令 = 在 `TabCommandAction` 加成员 + dispatch 加 case（assertNever 强制）+ `router.on('TAB_COMMAND', '<new>', handler)` 一行；TS 强制 payload 类型与 handler 签名同步。对比现状（grep 全库找散落字面量），收敛到 3 处且 2 处有编译器守门。
- **action 二级路由**：`FILL_PROGRESS`/`TAB_COMMAND` 内部按 action 二级分发，避免每个 action 都占一个顶层 type。

---

## 3. 迁移计划（增量，每步一次 commit，测试全绿 + tsc 净零）

| 步 | 内容 | 触及文件 | 风险 |
|---|---|---|---|
| 1 | 新增 `messaging/messages.ts` + `messaging/router.ts` + `router.test.ts`；**不动现有代码** | 新增 | 零 |
| 2 | `background.ts:11-40` if/else 链改为 `router.on(...)` 注册（handler 体抽成具名函数，逻辑等价） | background.ts | 低 |
| 3 | `FLOAT_FILL` 全量重命名为 `FILL_PROGRESS`/`TAB_COMMAND`（24 处 / 6 文件，机械替换）；同步更新 mock 了 `FLOAT_FILL` 的测试字面量 | FormFillEngine.ts、useFloatFill.ts、FloatButton.content.ts、background.ts、content.ts、相关测试 | 中（靠测试守门） |
| 4 | `content.ts:311-480` switch 改为 `router.on(...)` 注册；**修 `:466` `ok:true+error` bug**（iframe 超时返回 `ok:false`，或返回带 `verifyResult` 的响应让 `runSubmitAndVerify` 走跨页复核）；补该 bug 的回归单测 | content.ts | 中 |
| 5 | `useFloatFill`/`FloatButton`/`useSites`/`useProduct`/sidepanel `App.tsx` 的 `onMessage` 监听改为 typed handler（经 router 或类型守卫） | 5 个文件 | 低 |
| 6 | 删除 `lib/types.ts:124-148` 死类型（`MessageType`/`FloatFillAction`/`ExtMessage`）；清理 E 类死消息（确认后删/补） | lib/types.ts + 散落 | 零 |

**步骤 3 的验收门**：重命名后全量 `vitest` 必须全绿。任何 mock 了 `type:'FLOAT_FILL'` 的测试（如 useFloatFill 相关）必须同步改字面量——这是该步完成的硬条件。

**步骤 4 的 bug 修复要点**：当前 `submitViaIframe` 返回 null 时（iframe 内部 reload，主文档上下文仍存活），`content.ts:466` 返回 `ok:true` 让 `runSubmitAndVerify` 跳过 `verifyNavigation`。修复方向：让该路径的响应触发上层跨页复核，与"顶层跳转 reject → verifyNavigation"对称。具体返回结构在 plan 阶段定（候选：`ok:false` 或新增 `iframe_response_lost` 语义），本 spec 只约束"必须让上层走跨页复核"。

---

## 4. 测试策略

- **新增 `router.test.ts`**：
  - 分发命中（注册的 type+action → 对应 handler 被调）
  - 注册覆盖（遍历 `ExtensionMessage` 全部 type，断言 router 内部表均非空——与 2.4 的「handler 注册覆盖」对应）
  - 未知 type / 未注册 action → 忽略，不崩
  - 异步 handler → `return true` 保活通道；同步 handler → 不保活
  - handler 抛异常 → 被 catch，不污染其它消息
  - （dispatch 的 type 穷尽性由 `assertNever` 编译期保证，无需单测）
- **现有 230+ 测试**：步骤 3 重命名会命中 mock 了 `FLOAT_FILL` 的测试，同步改字面量即验收门。
- **`content.ts:466` 回归测试**：iframe 超时响应不再被 `ok` 误判为成功（对齐 `submit-flow.test.ts` 已有的"submit 响应丢失 → 跨页验证"用例风格）。
- **手动验证**（交付用户）：浮动按钮触发 → sidepanel 填充 → 提交 → 三态更新全链路在真实 WP 站点跑通；Blogger/Jetpack 跨域 iframe 提交不受影响（桥梁未动）。

---

## 5. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 步骤 3 重命名漏改某处 → 运行时消息丢失 | tsc + 全量测试双守门；router 的穷尽性在步骤 2 后即生效 |
| 步骤 4 content router 化引入回归 | handler 体仅搬迁不重写；`:466` 修复单独 commit + 回归测试 |
| 触及脆弱的 iframe 逻辑 | **iframe 桥梁完全不动**，仅 6 种消息形式化为类型 |
| 死消息误删（实际仍有用） | 步骤 6 删除前 grep 确认零发送方 + 零接收方 |

每步独立 commit，任一步出问题可单独 `git revert`，不影响其余。

---

## 6. 验收标准

- ✅ `tsc` 净零新增错误
- ✅ 全量 `vitest` 全绿（含新增 router 测试与 `:466` 回归测试）
- ✅ 代码中 `FLOAT_FILL` 字面量归零（iframe 的 6 种消息除外，它们本就不叫 FLOAT_FILL）
- ✅ `lib/types.ts:124-148` 的 `MessageType`/`FloatFillAction`/`ExtMessage` 已删除
- ✅ 新增消息 type 时，dispatch 的 `assertNever` 强制加 case（编译期）；router 注册覆盖由测试守门
- ✅ `content.ts:466` 的 iframe 超时响应不再被误判成功
- ✅ 真实站点手动验证：浮动按钮→填充→提交→三态更新全链路正常；Blogger iframe 提交不受影响

---

## 7. 未涵盖（后续 SP）

- SP-2：拆 `executeFormFill` + 依赖注入（本 spec 的 router 为 SP-2 提供 `sendToTab` 类型安全封装）
- SP-3：SiteType 策略 / dom-utils 拆分
- SP-4：FloatButton 拆分（其消息收发在 SP-1 后已类型化，SP-4 专注 UI/Store 拆分与生命周期）
- SP-5：技术债清理
- **P0（验证正确性）**：分层完成后单独一轮，给 `confirmed` 加正向成功信号；SP-1 把 `verify-moderation` 的 response 类型化，为 P0 在此 response 增加 `commentVisible` 字段预留了入口。
