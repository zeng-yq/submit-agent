import { describe, it, expect, beforeEach } from 'vitest'
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
    // mount 委托到 handle → host 进入 document
    expect(document.getElementById('submit-agent-float')).not.toBeNull()
    s.setState('loading')
    expect(s.currentState).toBe('loading')
    // setState 委托到 handle.setState → mainBtn.disabled
    const mainBtn = document.getElementById('submit-agent-float')!.shadowRoot!.querySelector('.action-btn') as HTMLButtonElement
    expect(mainBtn.disabled).toBe(true)
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
