import { describe, it, expect } from 'vitest'
import { getPricingLabel, SITE_PRICINGS } from '@/lib/types'

describe('getPricingLabel', () => {
	it('已知价格返回中文标签', () => {
		expect(getPricingLabel('free')).toBe('免费')
		expect(getPricingLabel('paid')).toBe('付费')
		expect(getPricingLabel('mixed')).toBe('混合')
	})

	it('未知/空值返回空串（卡片不渲染标签）', () => {
		expect(getPricingLabel('')).toBe('')
		expect(getPricingLabel('unknown')).toBe('')
	})

	it('SITE_PRICINGS 恰为 3 项', () => {
		expect(SITE_PRICINGS).toHaveLength(3)
	})
})
