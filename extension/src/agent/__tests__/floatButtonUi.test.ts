import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createButton, BUTTON_ID } from '@/agent/floatButtonUi'

// 每例独立创建按钮；幂等保护会拒绝重复创建，故每例前清空 DOM
beforeEach(() => {
	document.body.innerHTML = ''
})

describe('createButton', () => {
	it('known 站点：渲染 status switch + delete btn + popover（含 matchedSiteName）', () => {
		const onMainClick = vi.fn(), onDeleteClick = vi.fn(), onClose = vi.fn()
		const h = createButton({
			isKnownSite: true,
			currentState: 'idle',
			currentSubmissionState: 'not_started',
			matchedSiteName: 'Example',
			callbacks: { onMainClick, onDeleteClick, onClose },
		})!
		expect(document.getElementById(BUTTON_ID)).toBeTruthy()
		expect(h.host.shadowRoot?.querySelector('.status-switch')).toBeTruthy()
		expect(h.host.shadowRoot?.querySelector('.delete-btn')).toBeTruthy()
		expect(h.host.shadowRoot?.querySelector('.delete-popover')?.textContent).toContain('Example')
	})

	it('unknown 站点：渲染 add btn，无 status switch', () => {
		const onAddClick = vi.fn()
		const h = createButton({
			isKnownSite: false,
			currentState: 'idle',
			currentSubmissionState: 'not_started',
			matchedSiteName: null,
			callbacks: { onMainClick: () => {}, onClose: () => {}, onAddClick },
		})!
		expect(h.host.shadowRoot?.querySelector('.add-btn')).toBeTruthy()
		expect(h.host.shadowRoot?.querySelector('.status-switch')).toBeFalsy()
	})

	it('mainBtn click 触发 onMainClick', () => {
		const onMainClick = vi.fn()
		const h = createButton({
			isKnownSite: false,
			currentState: 'idle',
			currentSubmissionState: 'not_started',
			matchedSiteName: null,
			callbacks: { onMainClick, onClose: () => {} },
		})!
		const btn = h.host.shadowRoot!.querySelector('.action-btn') as HTMLButtonElement
		btn.click()
		expect(onMainClick).toHaveBeenCalledOnce()
	})

	it('setState 更新 mainBtn disabled + class', () => {
		const h = createButton({
			isKnownSite: false,
			currentState: 'idle',
			currentSubmissionState: 'not_started',
			matchedSiteName: null,
			callbacks: { onMainClick: () => {}, onClose: () => {} },
		})!
		h.setState('loading')
		const btn = h.host.shadowRoot!.querySelector('.action-btn') as HTMLButtonElement
		expect(btn.disabled).toBe(true)
		expect(btn.classList.contains('loading')).toBe(true)
	})

	it('handle.remove() 移除 DOM', () => {
		const h = createButton({
			isKnownSite: false,
			currentState: 'idle',
			currentSubmissionState: 'not_started',
			matchedSiteName: null,
			callbacks: { onMainClick: () => {}, onClose: () => {} },
		})!
		h.remove()
		expect(document.getElementById(BUTTON_ID)).toBeNull()
	})

	it('segment click 触发 onSegmentClick（带 state）', () => {
		const onSegmentClick = vi.fn()
		const h = createButton({
			isKnownSite: true,
			currentState: 'idle',
			currentSubmissionState: 'not_started',
			matchedSiteName: 'Example',
			callbacks: { onMainClick: () => {}, onClose: () => {}, onSegmentClick },
		})!
		const segments = h.host.shadowRoot!.querySelectorAll<HTMLDivElement>('.status-segment')
		expect(segments.length).toBeGreaterThan(0)
		// 点“成功”段（STATUS_SEGMENTS[1].state === 'submitted'）
		const submitted = Array.from(segments).find(s => s.getAttribute('data-state') === 'submitted')!
		submitted.click()
		expect(onSegmentClick).toHaveBeenCalledOnce()
		expect(onSegmentClick).toHaveBeenCalledWith('submitted')
	})

	it('popover confirm click 触发 onConfirmDelete', () => {
		const onConfirmDelete = vi.fn()
		const h = createButton({
			isKnownSite: true,
			currentState: 'idle',
			currentSubmissionState: 'not_started',
			matchedSiteName: 'Example',
			callbacks: { onMainClick: () => {}, onClose: () => {}, onConfirmDelete },
		})!
		const confirmBtn = h.host.shadowRoot!.querySelector<HTMLButtonElement>('.popover-confirm')!
		confirmBtn.click()
		expect(onConfirmDelete).toHaveBeenCalledOnce()
	})

	it('close btn click 触发 onClose', () => {
		const onClose = vi.fn()
		const h = createButton({
			isKnownSite: false,
			currentState: 'idle',
			currentSubmissionState: 'not_started',
			matchedSiteName: null,
			callbacks: { onMainClick: () => {}, onClose },
		})!
		const closeBtn = h.host.shadowRoot!.querySelector<HTMLButtonElement>('.close-btn')!
		closeBtn.click()
		expect(onClose).toHaveBeenCalledOnce()
	})
})
