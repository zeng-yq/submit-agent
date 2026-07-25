import { describe, it, expect } from 'vitest'
import { VERIFIED_SUCCESS, verifyResultLabel } from '@/agent/types'
import type { VerifyResult } from '@/agent/types'

describe('VERIFIED_SUCCESS', () => {
  it('恰为四种已确认成功的验证结果', () => {
    expect(VERIFIED_SUCCESS).toEqual(['ajax', 'cleared', 'navigating', 'pagehide'])
  })

  it('不含任何失败/未确认结果（含新增的 unverified / blocked_cloudflare）', () => {
    const failures: VerifyResult[] = [
      'pending_moderation', 'login_required', 'timeout', 'not_attempted', 'unverified', 'blocked_cloudflare',
    ]
    for (const f of failures) {
      expect(VERIFIED_SUCCESS).not.toContain(f)
    }
  })
})

describe('verifyResultLabel', () => {
  it('成功类统一显示「评论已发布」', () => {
    for (const r of ['ajax', 'navigating', 'pagehide', 'cleared'] as VerifyResult[]) {
      expect(verifyResultLabel(r)).toBe('评论已发布')
    }
  })
  it('各失败类有直白中文文案', () => {
    expect(verifyResultLabel('timeout')).toBe('提交超时，未能确认结果')
    expect(verifyResultLabel('login_required')).toBe('需要登录，提交未成功')
    expect(verifyResultLabel('pending_moderation')).toBe('评论待审核，未发布')
    expect(verifyResultLabel('unverified')).toBe('提交后页面未见评论，判定未发布')
    expect(verifyResultLabel('blocked_cloudflare')).toBe('需要 Cloudflare 人机验证，未发布')
    expect(verifyResultLabel('not_attempted')).toBe('未提交（未找到按钮或遇验证码）')
  })
  it('undefined → 未知提交状态', () => {
    expect(verifyResultLabel(undefined)).toBe('未知提交状态')
  })
})
