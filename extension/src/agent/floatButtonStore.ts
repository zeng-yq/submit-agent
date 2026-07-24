/**
 * floatButtonStore.ts
 * 状态 + 生命周期层：持有 FloatButton 的业务状态与 ButtonHandle，并管理 message listener。
 * 原模块级 8 个 let（host/shadow/mainBtn + currentState/currentSubmissionState/userEnabled/isKnownSite/matchedSiteName）
 * + 内联 messageListener，收进 class（host/shadow/mainBtn 折叠为 handle）。
 *
 * 职责边界：
 * - mount/unmount 负责 handle 创建/销毁 + 业务状态重置（userEnabled 保留，spec §2.2）。
 * - setState/setSiteMatch/setSubmissionState/showDeletePopover/hideDeletePopover 同步状态并委托 handle 视觉方法。
 * - registerMessageHandler/dispose 管理 chrome.runtime.onMessage listener 引用。
 *
 * 不做：业务逻辑（仍在 FloatButton.content.ts 的业务函数中）。
 */
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
