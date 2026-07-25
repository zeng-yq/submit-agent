import { describe, it, expect } from 'vitest'
import { VERIFIED_SUCCESS, verifyResultLabel, describeSubmitFailure } from '@/agent/types'
import type { VerifyResult } from '@/agent/types'

describe('VERIFIED_SUCCESS', () => {
  it('恰为四种已确认成功的验证结果', () => {
    expect(VERIFIED_SUCCESS).toEqual(['ajax', 'cleared', 'navigating', 'pagehide'])
  })

  it('不含任何失败/未确认结果（含新增的 unverified / blocked_cloudflare）', () => {
    const failures: VerifyResult[] = [
      'pending_moderation', 'login_required', 'timeout', 'not_attempted', 'captcha', 'unverified', 'blocked_cloudflare', 'skipped_contact_form',
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
    expect(verifyResultLabel('not_attempted')).toBe('未提交（未找到按钮或点击失败）')
    expect(verifyResultLabel('captcha')).toBe('遇到验证码，无法自动提交')
    expect(verifyResultLabel('skipped_contact_form')).toBe('页面为联系表单，非评论，已跳过')
  })
  it('undefined → 未知提交状态', () => {
    expect(verifyResultLabel(undefined)).toBe('未知提交状态')
  })
})

describe('describeSubmitFailure', () => {
  it('submitError 优先于 verifyResult 与填写状态', () => {
    expect(describeSubmitFailure({ submitError: '评论待审核，未发布', verifyResult: 'pending_moderation', filled: 3, failed: 0 }))
      .toBe('评论待审核，未发布')
  })
  it('无 submitError 时翻译已知 verifyResult', () => {
    expect(describeSubmitFailure({ verifyResult: 'captcha', filled: 2, failed: 0 })).toBe('遇到验证码，无法自动提交')
    expect(describeSubmitFailure({ verifyResult: 'not_attempted', filled: 2, failed: 0 })).toBe('未提交（未找到按钮或点击失败）')
  })
  it('verifyResult 缺失 + 有字段填写失败 → 部分字段填写失败，未提交', () => {
    expect(describeSubmitFailure({ filled: 2, failed: 1 })).toBe('部分字段填写失败，未提交')
  })
  it('verifyResult 缺失 + 未填任何字段 → 未填写任何字段', () => {
    expect(describeSubmitFailure({ filled: 0, failed: 0 })).toBe('未填写任何字段')
    expect(describeSubmitFailure({})).toBe('未填写任何字段')
  })
  it('verifyResult 缺失 + 填写成功但未提交 → 填写成功，未触发自动提交', () => {
    expect(describeSubmitFailure({ filled: 3, failed: 0 })).toBe('填写成功，未触发自动提交')
  })
  it('verifyResult 为非枚举值时回退到填写阶段原因（不再退化成「未知提交状态」）', () => {
    expect(describeSubmitFailure({ verifyResult: 'mystery', filled: 0, failed: 0 })).toBe('未填写任何字段')
  })
  it('无法判断时兜底「未知原因」', () => {
    expect(describeSubmitFailure({ filled: -1 })).toBe('未知原因')
  })
})
