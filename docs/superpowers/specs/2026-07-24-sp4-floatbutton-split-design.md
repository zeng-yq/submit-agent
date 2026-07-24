# SP-4 设计：FloatButton 拆 UI/Store/胶水 + 生命周期修复

- **日期**：2026-07-24
- **状态**：待评审
- **分支**：`dev`
- **系列**：自动提交外链代码分层重构的第 4 个子项目（SP-1/2/3a/3b 已完成）

---

## 0. 上下文

5 层架构重构进行中。**SP-1（消息契约 L3）、SP-2（executeFormFill 拆分+DI）、SP-3a（SiteType 策略+fuzzy）、SP-3b（dom-utils 拆分+去重）已完成**。本 SP 处理最后的大文件 `FloatButton.content.ts`（742 行，用户唯一直接触发的入口）。

| 序号 | 子项目 | 层 | 状态 |
|---|---|---|---|
| SP-1/2/3a/3b | 消息契约/管道/dom-utils | L2-L5 | ✅ 完成 |
| **SP-4** | **FloatButton 拆 UI/Store/胶水 + 生命周期（本 spec）** | **L1/L2** | **进行中** |
| SP-5 | 技术债清理 | — | 待定 |

---

## 1. 背景与目标

### 1.1 现状问题

`FloatButton.content.ts`（742 行）四类职责混合：
1. **UI 渲染**：310 行内联 CSS（115-426）+ createButton DOM 构建（99-538）+ 视觉函数 setState/positionIndicator/updateToggleVisual/showDeletePopover/hideDeletePopover。
2. **状态**：8 个模块级 `let`（host/shadow/mainBtn/currentState/currentSubmissionState/userEnabled/isKnownSite/matchedSiteName，35-42）——全局可变状态。
3. **业务通信**：sendMessageWithRetry/handleMainClick/handleAddClick/handleDeleteClick/performDelete/refreshSiteMatch（发 FLOAT_FILL/FLOAT_ADD_SITE/DELETE_SITE/CLOSE_TAB/STATUS_UPDATE/CHECK_SITE_MATCH）。
4. **消息路由**：initFloatButton 注册的 onMessage listener（687-735，处理 FLOAT_BUTTON_TOGGLE/FILL_PROGRESS/SUBMISSION_STATUS_CHANGED/SITE_ADDED）。

**生命周期缺陷**：
- `removeButton`（540-548）只清 host/shadow/mainBtn，**不清后 5 个业务状态**（currentState/currentSubmissionState/userEnabled/isKnownSite/matchedSiteName）——跨按钮重建残留（SPA 导航后状态错乱）。
- onMessage listener **永不移除**——HMR/编程式重复注入会累积。

### 1.2 目标

- G1：抽 `floatButtonUi.ts`（L1 纯渲染）：CSS + createButton + 视觉函数，**回调驱动 + 参数化**，零 chrome.*、零模块状态。返回 handle（方法闭包持有渲染元素）。
- G2：抽 `floatButtonStore.ts`：8 个 `let` 收进 class + mount/unmount/dispose。
- G3：`FloatButton.content.ts` 瘦身到 ~80 行胶水（消息↔状态↔UI）。
- G4：**修生命周期**：unmount 重置全部业务状态（修泄漏）；listener 可 dispose（修累积）；content.ts main() 支持 cleanup。
- G5：行为等价——按钮三态、已知/未知站点渲染、提交触发、删除、状态更新全链路不变。

### 1.3 非目标

- **不改按钮视觉**（CSS、布局、动画、颜色逐字保留）。
- **不改业务逻辑**（发送的消息类型/payload、CHECK_SITE_MATCH 查询、删除流程逐字保留）。
- **不改 SPA 导航检测**（现状无 URL-change listener，本 SP 不加——只修状态泄漏，不加新检测）。
- **不动 content.ts 的 submit/analyze/fill/iframe 逻辑**（SP-1/2/3 产物），只在 main() 末尾加 float-button cleanup。
- **不改 prompts/pipeline/messaging/dom-writers/field-filter**。

---

## 2. 目标设计

### 2.1 `floatButtonUi.ts`（L1 纯渲染）

搬运 CSS + 常量（BUTTON_ID/BUTTON_CONFIG/STATUS_SEGMENTS）+ 类型（ButtonState/SubmissionState）。createButton 改为参数化 + 回调驱动：

```ts
export type ButtonState = 'idle' | 'loading' | 'done' | 'error' | 'no-product'
export type SubmissionState = 'not_started' | 'submitted' | 'failed'

export interface ButtonCallbacks {
  onMainClick: () => void
  onDeleteClick?: () => void      // known 站点：打开删除 popover
  onAddClick?: () => void         // unknown 站点：添加到外链库
  onClose: () => void             // 关闭按钮
  onSegmentClick?: (state: SubmissionState) => void  // known 站点：切换提交状态
  onConfirmDelete?: () => void    // popover 确认删除
}

export interface ButtonRenderOpts {
  isKnownSite: boolean
  currentState: ButtonState
  currentSubmissionState: SubmissionState
  matchedSiteName: string | null
  callbacks: ButtonCallbacks
}

export interface ButtonHandle {
  host: HTMLElement
  setState: (s: ButtonState) => void
  updateToggleVisual: (s: SubmissionState) => void   // 更新 segment active + positionIndicator
  showDeletePopover: () => void
  hideDeletePopover: () => void
  positionIndicator: () => void
  remove: () => void   // host.remove() + 解绑 UI 内部 listener（segment click / outside-click / escape）
}

/** 创建浮动按钮（Shadow DOM）。纯渲染，无 chrome.*、无模块状态。 */
export function createButton(opts: ButtonRenderOpts): ButtonHandle
```

- createButton 按 opts.isKnownSite 渲染：known → status switch + delete btn + popover（显示 matchedSiteName）；unknown → add btn。事件绑到 callbacks。
- handle 方法闭包持有 host/shadow/mainBtn，操作视觉。`remove()` 解绑 UI 内部 listener（outside-click/escape/segment）+ 移除 DOM。
- CSS 逐字搬运（含 :host/container/status-switch/action-btn/close-btn/delete-btn/add-btn/delete-popover 全部规则）。

### 2.2 `floatButtonStore.ts`（状态 + 生命周期）

```ts
import type { ButtonHandle, ButtonRenderOpts, ButtonState, SubmissionState } from './floatButtonUi'
import type { ExtensionMessage } from '@/messaging/messages'

export class FloatButtonStore {
  private handle: ButtonHandle | null = null
  private messageListener: ((msg: ExtensionMessage) => void) | null = null

  // 业务状态（原 8 个 let 中的后 5 个 + 渲染参数）
  currentState: ButtonState = 'idle'
  currentSubmissionState: SubmissionState = 'not_started'
  userEnabled: boolean
  isKnownSite = false
  matchedSiteName: string | null = null

  constructor(enabled: boolean) { this.userEnabled = enabled }

  /** 挂载 UI（createButton + 存 handle）。opts 由当前业务状态 + callbacks 构造。 */
  mount(opts: ButtonRenderOpts): void {
    this.handle = createButton(opts)
  }

  /** 卸载 UI + 重置全部业务状态（修原 removeButton 的状态泄漏）。 */
  unmount(): void {
    this.handle?.remove()
    this.handle = null
    this.currentState = 'idle'
    this.currentSubmissionState = 'not_started'
    this.isKnownSite = false
    this.matchedSiteName = null
    // userEnabled 保留（用户偏好，不随按钮卸载重置）
  }

  setState(s: ButtonState): void { this.currentState = s; this.handle?.setState(s) }
  setSiteMatch(known: boolean, name: string | null): void {
    this.isKnownSite = known; this.matchedSiteName = name
  }
  setSubmissionState(s: SubmissionState): void {
    this.currentSubmissionState = s; this.handle?.updateToggleVisual(s)
  }
  showDeletePopover(): void { this.handle?.showDeletePopover() }
  hideDeletePopover(): void { this.handle?.hideDeletePopover() }

  /** 注册 onMessage listener，存引用供 dispose 移除。 */
  registerMessageHandler(handler: (msg: ExtensionMessage) => void): void {
    this.messageListener = handler
    chrome.runtime.onMessage.addListener(handler)
  }

  /** 完全销毁：unmount + 移除 listener。 */
  dispose(): void {
    this.unmount()
    if (this.messageListener) {
      chrome.runtime.onMessage.removeListener(this.messageListener)
      this.messageListener = null
    }
  }
}
```

### 2.3 `FloatButton.content.ts`（~80 行胶水）

```ts
import type { ExtensionMessage } from '@/messaging/messages'
import { FloatButtonStore } from './floatButtonStore'
import type { ButtonRenderOpts } from './floatButtonUi'

let store: FloatButtonStore | null = null

export async function initFloatButton(enabled: boolean): Promise<void> {
  store = new FloatButtonStore(enabled)
  await refreshAndMount()
  store.registerMessageHandler(handleMessage)
}

/** 清理（content.ts main() 返回的 disposer 调用）。 */
export function disposeFloatButton(): void {
  store?.dispose()
  store = null
}

// CHECK_SITE_MATCH → store.setSiteMatch → 按 userEnabled/isKnownSite mount/unmount UI
async function refreshAndMount() { /* 搬运 refreshSiteMatch 逻辑 + checkAndToggleButton 逻辑 */ }

// 业务回调（操作 store + 发消息）：onMainClick/onClose/onAddClick/onDeleteClick/onConfirmDelete/onSegmentClick
function buildCallbacks(): ButtonCallbacks { /* 绑 sendMessageWithRetry + store 操作 */ }

// 消息路由：FLOAT_BUTTON_TOGGLE→checkAndToggle；FILL_PROGRESS→setState；SUBMISSION_STATUS_CHANGED→setSubmissionState；SITE_ADDED→refreshAndMount
function handleMessage(msg: ExtensionMessage): void { /* ... */ }
```

- 业务 handlers（handleMainClick/handleDeleteClick/performDelete/refreshSiteMatch/checkAndToggleButton）变为胶水内函数。
- `sendMessageWithRetry` 留胶水（MV3 service-worker 唤醒重试，逐字搬运）。
- segment click 回调：`onSegmentClick(state)` → `store.setSubmissionState(state)` + `sendMessage(STATUS_UPDATE, {status})`（保留 SP-3a T6 恢复的 STATUS_UPDATE 流）。

### 2.4 content.ts main() cleanup

content.ts 的 `main()` 末尾加：
```ts
return () => { disposeFloatButton() }
```
WXT 支持 content script main() 返回 cleanup 函数（卸载时调用）。**只加这一行 + import disposeFloatButton**，不动 submit/analyze/fill/iframe 逻辑（SP-1/2/3 产物）。

---

## 3. 迁移计划（增量，每步测试绿，单 commit）

| 步 | 内容 | 风险 |
|---|---|---|
| 1 | 建 `floatButtonUi.ts`（搬运 CSS+常量+类型+createButton+视觉函数，参数化回调，返回 handle）；FloatButton 暂用旧模块状态调 createButton 验证渲染等价 | 中（大块搬运） |
| 2 | 建 `floatButtonStore.ts`（class + mount/unmount/转换/dispose）；FloatButton 改用 store 持状态 | 中 |
| 3 | `FloatButton.content.ts` 瘦身为胶水（业务回调 + handleMessage + initFloatButton + disposeFloatButton）；删除原模块级 let/函数 | 中 |
| 4 | 生命周期修复确认：unmount 重置业务状态、listener dispose、content.ts main() 返回 cleanup | 低 |
| 5 | 回归 + 清理 + 手动验证 | 低 |

> 三段式（先抽 UI、再抽 store、最后瘦胶水）每步保持 green，可独立回滚。

---

## 4. 测试策略

- **floatButtonUi 单测**（jsdom）：createButton 渲染 known 站点（含 status switch + delete + popover，popover 文本含 matchedSiteName）与 unknown 站点（含 add btn）两种形态；setState 更新 mainBtn 视觉；updateToggleVisual 切 segment active；handle.remove() 解绑 listener + 移除 DOM。回调被正确触发。
- **floatButtonStore 单测**（jsdom + mock chrome.runtime）：mount→handle 非空；unmount→handle null + 业务状态重置（currentState='idle'、isKnownSite=false 等，userEnabled 保留）；setState/setSiteMatch/setSubmissionState 更新状态 + 调 handle；registerMessageHandler→listener 注册；dispose→listener 移除（`removeEventListener` 被调）。
- **既有 346 测试维持全绿**（FloatButton 无既有直接单测，靠手动验证矩阵 + 上层测试不回归）。
- **手动验证矩阵**：浮动按钮三态切换、已知站点删除流程、未知站点添加、提交触发、SPA 内状态更新、按钮显隐。

---

## 5. 风险与回滚

| 风险 | 缓解 |
|---|---|
| createButton 参数化破坏渲染（known/unknown 分支、popover 文本、segment 绑定） | CSS/DOM 逐字搬运 + 手动验证矩阵；步骤 1 单 commit 可回滚 |
| store unmount 重置业务状态改变既有行为（如 userEnabled 误重置） | userEnabled 明确不重置（spec 注明）；其它状态重置是修复泄漏（原 removeButton 也应如此） |
| handleMessage 路由遗漏（4 种消息类型） | 逐条对照原 initFloatButton listener；手动验证每种消息 |
| content.ts main() cleanup 触发意外（如 SPA 内卸载） | 仅 return disposer，WXT 只在真正卸载调用；不动其它逻辑 |
| STATUS_UPDATE 流（SP-3a T6 修复）被破坏 | segment click 回调保留 sendMessage(STATUS_UPDATE)；手动验证段落点击→侧栏状态更新 |

---

## 6. 验收标准

- ✅ `pnpm exec tsc --noEmit` 净零新增错误（基线约 27 错）
- ✅ 全量 `pnpm test` 全绿（346 + 新增 ui/store 单测）
- ✅ `FloatButton.content.ts` 从 742 行降到 ~80-120 行（胶水）；CSS+createButton 在 floatButtonUi.ts；状态在 floatButtonStore.ts
- ✅ `floatButtonUi.ts` 零 `chrome.*` 调用、零模块级可变状态（grep 确认）
- ✅ `floatButtonStore.ts` 的 unmount 重置业务状态（单测验证）；dispose 移除 listener（单测验证）
- ✅ content.ts main() 返回 cleanup（调 disposeFloatButton）
- ✅ 行为等价：手动验证矩阵（三态/删除/添加/提交/状态更新/显隐）与 SP-3b 后一致

---

## 7. 未涵盖（后续）

- **SP-5**：技术债清理（累积 Minor：test as any、jsdom @types/jsdom、FormField 枚举顺序、FloatButton 拆分后可能残留的小项）。
- **SPA 导航检测**：本 SP 不加 URL-change listener（只修状态泄漏）；如需 SPA 内自动 re-check 站点，后续单独加。
- **P0（验证正确性）**：仍延后。
