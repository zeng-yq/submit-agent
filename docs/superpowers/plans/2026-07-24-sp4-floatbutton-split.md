# SP-4 FloatButton 拆 UI/Store/胶水 + 生命周期修复 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 742 行的 `FloatButton.content.ts` 拆为 `floatButtonUi.ts`（L1 纯渲染）+ `floatButtonStore.ts`（状态+生命周期）+ ~80 行胶水，修复 removeButton 状态泄漏与 onMessage listener 累积。

**Architecture:** UI 层 createButton(opts)→handle（回调驱动、零 chrome.*）；store 把 8 个模块级 `let` 收进 class（mount/unmount/dispose，unmount 重置业务状态、dispose 移 listener）；FloatButton 瘦身为胶水（业务回调 + 消息路由）。CSS/DOM 逐字搬运 + 参数化。三段式每步 green。

**Tech Stack:** TypeScript（strict, strictNullChecks）、WXT（content script main 可返回 cleanup）、Vitest + jsdom。别名 `@/*` → `src/*`。

## Global Constraints

- 测试命令：`pnpm test`（基线 **346 测试 / 26 文件全绿**，SP-3b 后）。每个任务结束必须全绿。
- 类型检查：`pnpm exec tsc --noEmit`（基线约 27 错）净零新增错误。
- **行为等价（硬约束）**：按钮视觉（CSS/布局/动画/颜色逐字）、业务逻辑（消息类型/payload、CHECK_SITE_MATCH、删除流程逐字）、STATUS_UPDATE 流（SP-3a T6 修复）不变。
- **不改按钮视觉**：CSS 310 行逐字搬运。
- **不动 content.ts 的 submit/analyze/fill/iframe 逻辑**（SP-1/2/3 产物），只在 main() 末尾加 cleanup。
- 提交规范：中文 conventional commit（如 `refactor(floatbutton): ...`）。

---

## File Structure

| 文件 | 职责 | 任务 |
|---|---|---|
| `src/agent/floatButtonUi.ts` | L1 纯渲染：CSS + 常量 + createButton(opts)→handle + 视觉 handle 方法 | T1 |
| `src/agent/floatButtonStore.ts` | 状态 class（8 状态 + mount/unmount/dispose） | T2 |
| `src/agent/FloatButton.content.ts` | 胶水：init/dispose + 业务回调 + handleMessage（~80-120 行） | T3 |
| `src/entrypoints/content.ts` | main() 末尾返回 cleanup（调 disposeFloatButton） | T4 |
| `src/agent/__tests__/floatButtonUi.test.ts` | createButton 渲染 + handle 方法单测 | T1 |
| `src/agent/__tests__/floatButtonStore.test.ts` | store mount/unmount/dispose 单测 | T2 |

---

## Task 1: `floatButtonUi.ts`（L1 纯渲染）+ 单测

**Files:**
- Create: `src/agent/floatButtonUi.ts`
- Create: `src/agent/__tests__/floatButtonUi.test.ts`
- Modify: `src/agent/FloatButton.content.ts`（暂改为 import createButton 等自 floatButtonUi，用旧模块状态适配——本任务只抽出 UI，行为等价）

**Interfaces:**
- Produces: `ButtonState`/`SubmissionState` 类型、`BUTTON_CONFIG`/`STATUS_SEGMENTS`/`BUTTON_ID` 常量、`ButtonCallbacks`/`ButtonRenderOpts`/`ButtonHandle` 接口、`createButton(opts): ButtonHandle`。

- [ ] **Step 1: 建 `floatButtonUi.ts`（搬运 + 参数化）**

从 `FloatButton.content.ts` 搬运并参数化：

**(a) 类型 + 常量**（搬 14-33，逐字）：
```ts
export type ButtonState = 'idle' | 'loading' | 'done' | 'error' | 'no-product'
export type SubmissionState = 'not_started' | 'submitted' | 'failed'
export const BUTTON_ID = 'submit-agent-float'
export const BUTTON_CONFIG: Record<ButtonState, { bg: string; shadow: string; icon: string }> = { /* 逐字搬 21-25 */ }
export const STATUS_SEGMENTS: Array<{ state: SubmissionState; label: string; activeColor: string; indicatorBg: string }> = [ /* 逐字搬 30-33 */ }
```

**(b) 接口**：
```ts
export interface ButtonCallbacks {
  onMainClick: () => void
  onDeleteClick?: () => void
  onAddClick?: () => void
  onClose: () => void
  onSegmentClick?: (state: SubmissionState) => void
  onConfirmDelete?: () => void
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
  updateToggleVisual: (s: SubmissionState) => void
  showDeletePopover: () => void
  hideDeletePopover: () => void
  positionIndicator: () => void
  remove: () => void
}
```

**(c) `createButton(opts)`**（搬 99-538 的 DOM 构建，**参数化**）：
- `document.getElementById(BUTTON_ID)` 幂等保护保留。
- host/shadow/style 创建逐字搬（102-113 + 114-427 的 CSS 逐字搬入 style.textContent）。
- **参数化点**（原模块状态读 → opts）：
  - `if (isKnownSite)`（434）→ `if (opts.isKnownSite)`
  - segment `seg.state === currentSubmissionState`（444）→ `=== opts.currentSubmissionState`
  - segment click `setSubmissionState(seg.state)`（448）→ `opts.callbacks.onSegmentClick?.(seg.state)`
  - popover 文本 `${matchedSiteName}`（471）→ `${opts.matchedSiteName}`
  - delete btn click `handleDeleteClick`（465）→ `opts.callbacks.onDeleteClick?.()`
  - popover confirm click `performDelete`（484）→ `opts.callbacks.onConfirmDelete?.()`
  - popover cancel click `hideDeletePopover()`（479）→ 内部调 handle.hideDeletePopover（见下）
  - mainBtn icon/bg/shadow 用 `BUTTON_CONFIG[currentState]`（499-502）→ `BUTTON_CONFIG[opts.currentState]`
  - mainBtn click `handleMainClick`（503）→ `opts.callbacks.onMainClick()`
  - closeBtn click `removeButton() + sendMessage(FLOAT_BUTTON_TOGGLE,false)`（511-512）→ `opts.callbacks.onClose()`
  - `if (!isKnownSite)` add btn（518）→ `if (!opts.isKnownSite)`；addBtn click `handleAddClick`（523）→ `opts.callbacks.onAddClick?.()`
- **UI 内部 listener**（outside-click 533、keydown escape 534）保留在 createButton 内，绑到内部 hideDeletePopover（这些是 UI 行为，不是业务）。
- 返回 handle：
```ts
const handle: ButtonHandle = {
  host,
  setState: (s) => { /* 搬 setState 44-54 体，闭包 mainBtn */ },
  updateToggleVisual: (s) => { /* 搬 updateToggleVisual 76-88 体（去掉 if(!isKnownSite)return 守卫——守卫移到 store/glue），闭包 shadow + requestAnimationFrame(positionIndicator) */ },
  showDeletePopover: () => { /* 搬 showDeletePopover 628-632 */ },
  hideDeletePopover: () => { /* 搬 hideDeletePopover 634-638 */ },
  positionIndicator: () => { /* 搬 positionIndicator 56-74，闭包 shadow */ },
  remove: () => {
    existing.remove()
    document.removeEventListener('click', handleOutsideClick)
    document.removeEventListener('keydown', handleEscapeKey)
    // 注意：不重置业务状态——那是 store 的职责
  },
}
return handle
```
- `handleOutsideClick`/`handleEscapeKey`（613-621）作为 createButton 内部函数（闭包 shadow + hideDeletePopover）。
- **零 chrome.\***、零模块级可变状态。

**(d) setState/positionIndicator/updateToggleVisual/showDeletePopover/hideDeletePopover/handleOutsideClick/handleEscapeKey** 全部从模块函数变为 createButton 内闭包（搬 44-97 + 613-638 的函数体）。

- [ ] **Step 2: 写 `floatButtonUi.test.ts`**

```ts
// src/agent/__tests__/floatButtonUi.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createButton, BUTTON_ID } from '@/agent/floatButtonUi'

document.body.innerHTML = ''

describe('createButton', () => {
  it('known 站点：渲染 status switch + delete btn + popover（含 matchedSiteName）', () => {
    const onMainClick = vi.fn(), onDeleteClick = vi.fn(), onClose = vi.fn()
    const h = createButton({ isKnownSite: true, currentState: 'idle', currentSubmissionState: 'not_started', matchedSiteName: 'Example', callbacks: { onMainClick, onDeleteClick, onClose } })
    expect(document.getElementById(BUTTON_ID)).toBeTruthy()
    expect(h.host.shadowRoot?.querySelector('.status-switch')).toBeTruthy()
    expect(h.host.shadowRoot?.querySelector('.delete-btn')).toBeTruthy()
    expect(h.host.shadowRoot?.querySelector('.delete-popover')?.textContent).toContain('Example')
  })

  it('unknown 站点：渲染 add btn，无 status switch', () => {
    const onAddClick = vi.fn()
    const h = createButton({ isKnownSite: false, currentState: 'idle', currentSubmissionState: 'not_started', matchedSiteName: null, callbacks: { onMainClick: () => {}, onClose: () => {}, onAddClick } })
    expect(h.host.shadowRoot?.querySelector('.add-btn')).toBeTruthy()
    expect(h.host.shadowRoot?.querySelector('.status-switch')).toBeFalsy()
  })

  it('mainBtn click 触发 onMainClick', () => {
    const onMainClick = vi.fn()
    const h = createButton({ isKnownSite: false, currentState: 'idle', currentSubmissionState: 'not_started', matchedSiteName: null, callbacks: { onMainClick, onClose: () => {} } })
    const btn = h.host.shadowRoot!.querySelector('.action-btn') as HTMLButtonElement
    btn.click()
    expect(onMainClick).toHaveBeenCalledOnce()
  })

  it('setState 更新 mainBtn disabled + class', () => {
    const h = createButton({ isKnownSite: false, currentState: 'idle', currentSubmissionState: 'not_started', matchedSiteName: null, callbacks: { onMainClick: () => {}, onClose: () => {} } })
    h.setState('loading')
    const btn = h.host.shadowRoot!.querySelector('.action-btn') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.classList.contains('loading')).toBe(true)
  })

  it('handle.remove() 移除 DOM', () => {
    const h = createButton({ isKnownSite: false, currentState: 'idle', currentSubmissionState: 'not_started', matchedSiteName: null, callbacks: { onMainClick: () => {}, onClose: () => {} } })
    h.remove()
    expect(document.getElementById(BUTTON_ID)).toBeNull()
  })
})
```

- [ ] **Step 3: `FloatButton.content.ts` 暂改为用 floatButtonUi**

本任务只抽 UI。FloatButton.content.ts 暂保留模块级状态 + 业务函数，但 createButton/setState/视觉函数 改为从 floatButtonUi import + 适配（构造 opts + callbacks 调原业务函数）。具体：把原 createButton 调用替换为 `createButton({ isKnownSite, currentState, currentSubmissionState, matchedSiteName, callbacks: { onMainClick: handleMainClick, onDeleteClick: handleDeleteClick, onAddClick: handleAddClick, onClose: () => { removeButton(); chrome.runtime.sendMessage({type:'FLOAT_BUTTON_TOGGLE',enabled:false}).catch(()=>{}) }, onSegmentClick: setSubmissionState, onConfirmDelete: performDelete } })`，handle 存到模块变量供 setState 等用。视觉函数调用改走 handle 方法。

> 这一步保证行为等价（UI 经新 floatButtonUi 渲染，业务仍走旧函数）。346 全绿 + 手动验证渲染正确。

- [ ] **Step 4: tsc + 全量测试 + 手动验证渲染**

Run: `pnpm exec tsc --noEmit` → 净零新增（floatButtonUi.ts 零 chrome.*）。
Run: `pnpm test` → 346 + 5 = 351 全绿。
手动：`pnpm build` 加载扩展，确认浮动按钮在三态/已知/未知站点渲染正确（视觉与之前一致）。

- [ ] **Step 5: 提交**

```bash
git add src/agent/floatButtonUi.ts src/agent/__tests__/floatButtonUi.test.ts src/agent/FloatButton.content.ts
git commit -m "refactor(floatbutton): 抽 floatButtonUi.ts（纯渲染，回调驱动）"
```

---

## Task 2: `floatButtonStore.ts`（状态 + 生命周期）+ 单测

**Files:**
- Create: `src/agent/floatButtonStore.ts`
- Create: `src/agent/__tests__/floatButtonStore.test.ts`
- Modify: `src/agent/FloatButton.content.ts`（暂改为用 store 持状态，业务函数操作 store）

**Interfaces:**
- Consumes: `createButton`/`ButtonHandle`/`ButtonRenderOpts`（T1）。
- Produces: `FloatButtonStore` class。

- [ ] **Step 1: 建 `floatButtonStore.ts`（按 spec §2.2 全码）**

```ts
// src/agent/floatButtonStore.ts
import { createButton, type ButtonHandle, type ButtonRenderOpts, type ButtonState, type SubmissionState } from './floatButtonUi'
import type { ExtensionMessage } from '@/messaging/messages'

export class FloatButtonStore {
  private handle: ButtonHandle | null = null
  private messageListener: ((msg: ExtensionMessage) => void) | null = null

  currentState: ButtonState = 'idle'
  currentSubmissionState: SubmissionState = 'not_started'
  userEnabled: boolean
  isKnownSite = false
  matchedSiteName: string | null = null

  constructor(enabled: boolean) { this.userEnabled = enabled }

  mount(opts: ButtonRenderOpts): void {
    this.handle = createButton(opts)
  }

  unmount(): void {
    this.handle?.remove()
    this.handle = null
    this.currentState = 'idle'
    this.currentSubmissionState = 'not_started'
    this.isKnownSite = false
    this.matchedSiteName = null
    // userEnabled 保留
  }

  setState(s: ButtonState): void { this.currentState = s; this.handle?.setState(s) }
  setSiteMatch(known: boolean, name: string | null): void { this.isKnownSite = known; this.matchedSiteName = name }
  setSubmissionState(s: SubmissionState): void { this.currentSubmissionState = s; this.handle?.updateToggleVisual(s) }
  showDeletePopover(): void { this.handle?.showDeletePopover() }
  hideDeletePopover(): void { this.handle?.hideDeletePopover() }

  registerMessageHandler(handler: (msg: ExtensionMessage) => void): void {
    this.messageListener = handler
    chrome.runtime.onMessage.addListener(handler)
  }

  dispose(): void {
    this.unmount()
    if (this.messageListener) {
      chrome.runtime.onMessage.removeListener(this.messageListener)
      this.messageListener = null
    }
  }
}
```

- [ ] **Step 2: 写 `floatButtonStore.test.ts`**

```ts
// src/agent/__tests__/floatButtonStore.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FloatButtonStore } from '@/agent/floatButtonStore'

const msgListenerSpies: Array<(m: any) => void> = []
beforeEach(() => {
  msgListenerSpies.length = 0
  ;(globalThis as any).chrome = {
    runtime: {
      onMessage: {
        addListener: (fn: any) => msgListenerSpies.push(fn),
        removeListener: (fn: any) => { const i = msgListenerSpies.indexOf(fn); if (i >= 0) msgListenerSpies.splice(i, 1) },
      },
    },
  }
  document.body.innerHTML = ''
})

describe('FloatButtonStore', () => {
  it('mount→handle 渲染；setState 更新', () => {
    const s = new FloatButtonStore(true)
    s.mount({ isKnownSite: false, currentState: 'idle', currentSubmissionState: 'not_started', matchedSiteName: null, callbacks: { onMainClick: () => {}, onClose: () => {} } })
    s.setState('loading')
    expect(s.currentState).toBe('loading')
  })

  it('unmount 重置业务状态（userEnabled 保留）', () => {
    const s = new FloatButtonStore(true)
    s.mount({ isKnownSite: true, currentState: 'done', currentSubmissionState: 'submitted', matchedSiteName: 'X', callbacks: { onMainClick: () => {}, onClose: () => {} } })
    s.unmount()
    expect(s.currentState).toBe('idle')
    expect(s.currentSubmissionState).toBe('not_started')
    expect(s.isKnownSite).toBe(false)
    expect(s.matchedSiteName).toBeNull()
    expect(s.userEnabled).toBe(true)  // 保留
  })

  it('registerMessageHandler 注册；dispose 移除', () => {
    const s = new FloatButtonStore(true)
    const handler = (m: any) => {}
    s.registerMessageHandler(handler)
    expect(msgListenerSpies).toContain(handler)
    s.dispose()
    expect(msgListenerSpies).not.toContain(handler)
  })
})
```

- [ ] **Step 3: `FloatButton.content.ts` 暂改用 store 持状态**

把模块级 8 个 `let` 替换为一个 `let store: FloatButtonStore | null`。业务函数（handleMainClick 等）改为操作 store（store.setState/setSiteMatch/setSubmissionState/showDeletePopover/hideDeletePopover）。mount 用 store.mount(opts)，opts.callbacks 绑业务函数。removeButton→store.unmount()。

> 这一步把状态收进 store，业务仍走旧函数（现在操作 store）。346 + 3 = 349 全绿。

- [ ] **Step 4: tsc + 全量测试**

Run: `pnpm exec tsc --noEmit` → 净零新增。Run: `pnpm test` → 349 全绿。

- [ ] **Step 5: 提交**

```bash
git add src/agent/floatButtonStore.ts src/agent/__tests__/floatButtonStore.test.ts src/agent/FloatButton.content.ts
git commit -m "refactor(floatbutton): 抽 floatButtonStore.ts（8 状态收进 class + dispose）"
```

---

## Task 3: `FloatButton.content.ts` 瘦身为胶水 + 生命周期修复

**Files:**
- Modify: `src/agent/FloatButton.content.ts`（瘦身到 ~80-120 行胶水）

**Interfaces:**
- Consumes: `FloatButtonStore`（T2）、`ExtensionMessage`（SP-1）。
- Produces: `initFloatButton(enabled)`、`disposeFloatButton()`。

- [ ] **Step 1: 重写 `FloatButton.content.ts` 为胶水**

把文件重写为：
```ts
import type { ExtensionMessage } from '@/messaging/messages'
import { FloatButtonStore } from './floatButtonStore'
import type { ButtonCallbacks, ButtonRenderOpts } from './floatButtonUi'

let store: FloatButtonStore | null = null

/** MV3 service-worker 唤醒重试（搬 554-574 sendMessageWithRetry 逐字） */
function sendMessageWithRetry(message: { type: string; action: string }, maxRetries = 2, delayMs = 500): Promise<unknown> { /* 逐字搬 */ }

export async function initFloatButton(enabled: boolean): Promise<void> {
  store = new FloatButtonStore(enabled)
  await refreshAndMount()
  store.registerMessageHandler(handleMessage)
}

export function disposeFloatButton(): void {
  store?.dispose()
  store = null
}

/** CHECK_SITE_MATCH → store.setSiteMatch → 按 userEnabled mount/unmount（搬 refreshSiteMatch 590-604 + checkAndToggleButton 658-666 逻辑） */
async function refreshAndMount() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'CHECK_SITE_MATCH', payload: { url: window.location.href } })
    store!.setSiteMatch(response?.isKnownSite === true, response?.siteName ?? null)
    if (response?.submissionStatus) store!.setSubmissionState(response.submissionState)
  } catch { store!.setSiteMatch(false, null) }
  checkAndToggle()
}

function checkAndToggle() {
  if (store!.userEnabled) {
    if (!document.getElementById('submit-agent-float')) store!.mount(buildOpts())
  } else {
    store!.unmount()
  }
}

/** 构造 render opts + callbacks（绑业务动作） */
function buildOpts(): ButtonRenderOpts {
  const callbacks: ButtonCallbacks = {
    onMainClick: handleMainClick,
    onClose: () => { store!.unmount(); chrome.runtime.sendMessage({ type: 'FLOAT_BUTTON_TOGGLE', enabled: false }).catch(() => {}) },
    onAddClick: handleAddClick,
    onDeleteClick: () => store!.showDeletePopover(),
    onConfirmDelete: performDelete,
    onSegmentClick: (state) => { store!.setSubmissionState(state); chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', payload: { status: state } }).catch(() => {}) },
  }
  return { isKnownSite: store!.isKnownSite, currentState: store!.currentState, currentSubmissionState: store!.currentSubmissionState, matchedSiteName: store!.matchedSiteName, callbacks }
}

/** 业务回调（搬 handleMainClick 576-588 / handleAddClick 606-611 / performDelete 640-652 逐字，去 module-state 引用改 store） */
function handleMainClick() { /* 搬：sendMessageWithRetry({type:'FILL_PROGRESS',action:'start'}) + setState('loading' on !ok) */ }
function handleAddClick() { /* 搬：sendMessage({type:'FLOAT_ADD_SITE',url:location.href}) */ }
function performDelete() { /* 搬：sendMessage({type:'DELETE_SITE',payload:{siteName:matchedSiteName}}) → success → CLOSE_TAB + unmount */ }

/** 消息路由（搬 initFloatButton 687-735 的 onMessage switch） */
function handleMessage(msg: ExtensionMessage): void {
  if (msg.type === 'FLOAT_BUTTON_TOGGLE') { store!.userEnabled = (msg as any).enabled; checkAndToggle() }
  else if (msg.type === 'FILL_PROGRESS') {
    const action = (msg as any).action
    if (action === 'progress' || action === 'confirm') store!.setState('loading')
    else if (action === 'done') store!.setState('done')
    else if (action === 'error') store!.setState('error')
    else if (action === 'no-product') store!.setState('no-product')
    else if (action === 'no-match') store!.setState('error')
    else if (action === 'reset') store!.setState('idle')
    // 注：done/all-done 需同步 submission toggle——搬原 699-718 的 updateToggleVisual 逻辑（走 store.setSubmissionState）
  }
  else if (msg.type === 'SUBMISSION_STATUS_CHANGED') {
    const { siteName, toggleState } = (msg as any).payload ?? {}
    if (siteName && siteName === store!.matchedSiteName) store!.setSubmissionState(toggleState)
  }
  else if (msg.type === 'SITE_ADDED') { refreshAndMount().then(() => { store!.unmount(); checkAndToggle() }) }
}
```

> 删除原模块级 let（host/shadow/mainBtn/currentState/...）、setState/positionIndicator/updateToggleVisual/setSubmissionState/showDeletePopover/hideDeletePopover/handleOutsideClick/handleEscapeKey/createButton/removeButton/refreshSiteMatch/updateButtonState/checkAndToggleButton（这些都进了 floatButtonUi/store 或胶水）。保留 sendMessageWithRetry。

- [ ] **Step 2: tsc + 全量测试**

Run: `pnpm exec tsc --noEmit` → 净零新增。Run: `pnpm test` → 349 全绿。
Run: `wc -l src/agent/FloatButton.content.ts` → 应 ~80-120 行。

- [ ] **Step 3: 提交**

```bash
git add src/agent/FloatButton.content.ts
git commit -m "refactor(floatbutton): 瘦身为胶水（init/dispose + 业务回调 + 消息路由），删模块级状态"
```

---

## Task 4: content.ts main() 返回 cleanup

**Files:**
- Modify: `src/entrypoints/content.ts`（main() 末尾加 cleanup）

**Interfaces:**
- Consumes: `disposeFloatButton`（T3）。

- [ ] **Step 1: content.ts main() 末尾返回 cleanup**

在 `src/entrypoints/content.ts` 的 `main()` 末尾（return 前）加：
```ts
		return () => { disposeFloatButton() }
```
并在顶部加 `import { initFloatButton, disposeFloatButton } from '@/agent/FloatButton.content'`（替换原仅 `initFloatButton` 的 import）。

> 不动 submit/analyze/fill/iframe 逻辑（SP-1/2/3 产物）。WXT content script main() 返回的函数在脚本卸载时调用。

- [ ] **Step 2: tsc + 全量测试**

Run: `pnpm exec tsc --noEmit` → 净零新增。Run: `pnpm test` → 349 全绿。

- [ ] **Step 3: 提交**

```bash
git add src/entrypoints/content.ts
git commit -m "refactor(floatbutton): content.ts main() 返回 cleanup 调 disposeFloatButton"
```

---

## Task 5: 回归 + 清理 + 手动验证

**Files:**
- 无（核查；若有 orphan 清理则改相关文件）

- [ ] **Step 1: 终态校验（对照 spec §6 验收）**

- Run: `grep -c "chrome\." extension/src/agent/floatButtonUi.ts` → 0（零 chrome.*）✅
- Run: `grep -n "^let " extension/src/agent/FloatButton.content.ts` → 仅 `let store`（1 个，原 8 个模块级 let 已消除）✅
- Run: `wc -l extension/src/agent/FloatButton.content.ts` → ~80-120 行 ✅
- Run: `pnpm exec tsc --noEmit` → 净零新增 ✅
- Run: `pnpm test` → 349 全绿（346 + ui 5 + store 3）✅
- 核查 content.ts main() 返回 cleanup ✅

- [ ] **Step 2: 手动验证（交付用户）**

`pnpm build` 加载扩展，验证矩阵：
1. 浮动按钮三态切换（idle/loading/done/error/no-product）正常显示
2. 已知站点：status switch + delete btn + popover（含站点名）；点击 delete→popover→确认→删除→关 tab
3. 未知站点：add btn；点击→sidepanel 添加对话框
4. 主按钮点击→触发提交（FILL_PROGRESS start）
5. 提交过程中状态更新（progress/done/error）反映到按钮
6. 段落点击→侧栏状态更新（STATUS_UPDATE 流，SP-3a T6 修复）
7. 关闭按钮→按钮隐藏；设置面板开关浮动按钮→显隐
8. SPA 内导航后按钮状态不残留（unmount 重置）

Expected: 与 SP-3b 后一致（视觉/业务行为等价）。

- [ ] **Step 3: 提交（若有清理）**

> 若 Step 1 发现 orphan（如 FloatButton 不再用的 import），清理后提交。若无，跳过。

---

## Self-Review 笔记

**Spec 覆盖**：
- G1 floatButtonUi.ts（纯渲染+回调）→ T1 ✅
- G2 floatButtonStore.ts（class+dispose）→ T2 ✅
- G3 FloatButton 瘦身胶水 → T3 ✅
- G4 生命周期修复（unmount 重置/listener dispose/content cleanup）→ T2/T3/T4 ✅
- G5 行为等价 → CSS/DOM/业务逐字搬运 + 手动矩阵 ✅

**类型一致性**：`ButtonHandle` 方法（setState/updateToggleVisual/showDeletePopover/hideDeletePopover/positionIndicator/remove）T1 定义、T2 store 消费一致；`ButtonRenderOpts`/`ButtonCallbacks` 一致；`FloatButtonStore` 方法（mount/unmount/setState/setSiteMatch/setSubmissionState/registerMessageHandler/dispose）T2 定义、T3 胶水消费一致；`initFloatButton`/`disposeFloatButton` T3 导出、T4 content.ts 消费一致。

**风险已处理**：
- CSS 310 行逐字搬运（T1 引用行号 + 参数化点清单）✅
- createButton 参数化（T1 Step 1c 列出全部模块状态读→opts、handler→callback 映射）✅
- unmount 重置边界（userEnabled 保留，spec §2.2 注明，T2 单测验证）✅
- STATUS_UPDATE 流保留（T3 onSegmentClick 回调发 STATUS_UPDATE）✅
- handleMessage 4 种消息全覆盖（FLOAT_BUTTON_TOGGLE/FILL_PROGRESS/SUBMISSION_STATUS_CHANGED/SITE_ADDED）✅
- content.ts cleanup 不动 SP-1/2/3 产物（仅末尾一行 + import）✅

**后续衔接**：SP-5 清剩余技术债；FloatButton 三层就位完成 L1/L2 表现/编排分层。P0 仍延后。
