import { describe, it, expect } from 'vitest'
import { VERIFIED_SUCCESS } from '@/agent/types'
import type { VerifyResult } from '@/agent/types'

describe('VERIFIED_SUCCESS', () => {
  it('恰为四种已确认成功的验证结果', () => {
    expect(VERIFIED_SUCCESS).toEqual(['ajax', 'cleared', 'navigating', 'pagehide'])
  })

  it('不含任何失败/未确认结果（含新增的 unverified）', () => {
    const failures: VerifyResult[] = [
      'pending_moderation', 'login_required', 'timeout', 'not_attempted', 'unverified',
    ]
    for (const f of failures) {
      expect(VERIFIED_SUCCESS).not.toContain(f)
    }
  })
})
