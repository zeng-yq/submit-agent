/**
 * floatButtonUi.ts
 * 纯渲染层：浮动按钮 CSS + DOM 构建 + 视觉方法。
 * 零 chrome.*、零模块级可变状态。参数化 + 回调驱动，返回 ButtonHandle。
 *
 * 设计语言：premium glass-morphism with warm stone palette。
 * 布局：unified glass container — [status switch | separator | action button]
 */

export type ButtonState = 'idle' | 'loading' | 'done' | 'error' | 'no-product'
export type SubmissionState = 'not_started' | 'submitted' | 'failed'

export const BUTTON_ID = 'submit-agent-float'

// Main action button configs — gradient backgrounds with layered shadows
export const BUTTON_CONFIG: Record<ButtonState, { bg: string; shadow: string; icon: string }> = {
	idle: { bg: 'linear-gradient(135deg, #E8A308 0%, #CA8A04 100%)', shadow: '0 2px 8px rgba(202, 138, 4, 0.35), 0 1px 2px rgba(202, 138, 4, 0.2)', icon: '▶' },
	loading: { bg: 'linear-gradient(135deg, #FBBF24 0%, #F59E0B 100%)', shadow: '0 2px 8px rgba(245, 158, 11, 0.35), 0 1px 2px rgba(245, 158, 11, 0.2)', icon: '↻' },
	done: { bg: 'linear-gradient(135deg, #34D399 0%, #16A34A 100%)', shadow: '0 2px 8px rgba(22, 163, 74, 0.35), 0 1px 2px rgba(22, 163, 74, 0.2)', icon: '✓' },
	error: { bg: 'linear-gradient(135deg, #F87171 0%, #DC2626 100%)', shadow: '0 2px 8px rgba(220, 38, 38, 0.35), 0 1px 2px rgba(220, 38, 38, 0.2)', icon: '✗' },
	'no-product': { bg: 'linear-gradient(135deg, #D6D3D1 0%, #A8A29E 100%)', shadow: '0 2px 8px rgba(168, 162, 158, 0.25), 0 1px 2px rgba(168, 162, 158, 0.15)', icon: '!' },
}

// Status switch segment configs
export const STATUS_SEGMENTS: Array<{ state: SubmissionState; label: string; activeColor: string; indicatorBg: string }> = [
	{ state: 'not_started', label: '未提交', activeColor: '#92400E', indicatorBg: '#FEF3C7' },
	{ state: 'submitted', label: '成功', activeColor: '#166534', indicatorBg: '#DCFCE7' },
	{ state: 'failed', label: '失败', activeColor: '#991B1B', indicatorBg: '#FEE2E2' },
]

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

/**
 * 创建浮动按钮（Shadow DOM 隔离）。纯渲染：不读模块状态、不调 chrome.*。
 * 所有业务行为经 callbacks 回驱动；视觉更新经返回的 handle 方法。
 * 幂等：若 BUTTON_ID 已存在，返回 null。
 */
export function createButton(opts: ButtonRenderOpts): ButtonHandle | null {
	if (document.getElementById(BUTTON_ID)) return null

	const host = document.createElement('div')
	host.id = BUTTON_ID
	host.style.cssText = [
		'position: fixed',
		'bottom: 24px',
		'right: 24px',
		'z-index: 2147483647',
		'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
	].join(';')

	const shadow = host.attachShadow({ mode: 'open' })

	const style = document.createElement('style')
	style.textContent = `		:host { all: initial; }

		/* Unified glass container */
		.container {
			display: flex;
			align-items: center;
			gap: 6px;
			padding: 4px;
			border-radius: 12px;
			background: rgba(255, 255, 255, 0.82);
			backdrop-filter: blur(16px) saturate(1.8);
			-webkit-backdrop-filter: blur(16px) saturate(1.8);
			border: 1px solid rgba(255, 255, 255, 0.5);
			box-shadow:
				0 0 0 1px rgba(0, 0, 0, 0.03),
				0 2px 4px rgba(0, 0, 0, 0.04),
				0 8px 24px rgba(0, 0, 0, 0.08);
			transition: box-shadow 0.3s ease;
			position: relative;
		}
		.container:hover {
			box-shadow:
				0 0 0 1px rgba(0, 0, 0, 0.04),
				0 4px 8px rgba(0, 0, 0, 0.06),
				0 12px 32px rgba(0, 0, 0, 0.1);
		}

		/* Separator between switch and action */
		.separator {
			width: 1px;
			height: 18px;
			background: rgba(0, 0, 0, 0.08);
			border-radius: 1px;
			flex-shrink: 0;
		}

		/* Status switch — pill-style with sliding indicator */
		.status-switch {
			display: flex;
			position: relative;
			height: 28px;
			border-radius: 8px;
			overflow: hidden;
			user-select: none;
			cursor: pointer;
		}
		/* Sliding pill indicator */
		#status-indicator {
			position: absolute;
			top: 2px;
			bottom: 2px;
			border-radius: 6px;
			transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
			z-index: 0;
		}
		.status-segment {
			flex: 1;
			min-width: 38px;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 0 12px;
			white-space: nowrap;
			color: #A8A29E;
			font-size: 11px;
			font-weight: 500;
			letter-spacing: 0.01em;
			transition: color 0.25s ease;
			position: relative;
			z-index: 1;
		}
		.status-segment.active {
			color: var(--active-color, #57534E);
			font-weight: 600;
		}
		.status-segment:hover:not(.active) {
			color: #78716C;
		}

		/* Action button */
		.action-btn {
			width: 30px;
			height: 30px;
			border: none;
			border-radius: 9px;
			color: #fff;
			font-size: 13px;
			display: flex;
			align-items: center;
			justify-content: center;
			cursor: pointer;
			position: relative;
			transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
			            box-shadow 0.2s ease;
			outline: none;
		}
		/* Glossy highlight */
		.action-btn::after {
			content: '';
			position: absolute;
			inset: 0;
			border-radius: inherit;
			background: linear-gradient(180deg, rgba(255,255,255,0.22) 0%, transparent 60%);
			pointer-events: none;
		}
		.action-btn:hover:not(:disabled) {
			transform: scale(1.1);
		}
		.action-btn:active:not(:disabled) {
			transform: scale(0.95);
		}
		.action-btn:disabled {
			cursor: default;
			opacity: 0.85;
		}

		/* Spinner */
		@keyframes spin {
			from { transform: rotate(0deg); }
			to { transform: rotate(360deg); }
		}
		.action-btn.loading::before {
			content: '';
			width: 14px;
			height: 14px;
			border: 2px solid rgba(255,255,255,0.3);
			border-top-color: #fff;
			border-radius: 50%;
			animation: spin 0.7s linear infinite;
		}
		.action-btn.loading [data-icon] {
			display: none;
		}

		/* Close button — appears on container hover */
		.close-btn {
			position: absolute;
			top: -5px;
			right: -5px;
			width: 16px;
			height: 16px;
			border-radius: 50%;
			background: rgba(120, 113, 108, 0.9);
			color: #fff;
			font-size: 8px;
			line-height: 1;
			display: flex;
			align-items: center;
			justify-content: center;
			border: 2px solid rgba(255, 255, 255, 0.95);
			cursor: pointer;
			padding: 0;
			opacity: 0;
			transform: scale(0.6);
			transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
			z-index: 2;
		}
		.container:hover .close-btn {
			opacity: 1;
			transform: scale(1);
		}
		.close-btn:hover {
			background: #EF4444;
			transform: scale(1.1);
		}

		/* Delete button — matches action-btn style with red gradient */
		.delete-btn {
			width: 30px;
			height: 30px;
			border: none;
			border-radius: 9px;
			background: linear-gradient(135deg, #F87171 0%, #DC2626 100%);
			box-shadow: 0 2px 8px rgba(220, 38, 38, 0.35), 0 1px 2px rgba(220, 38, 38, 0.2);
			color: #fff;
			font-size: 14px;
			display: flex;
			align-items: center;
			justify-content: center;
			cursor: pointer;
			padding: 0;
			position: relative;
			transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
			            box-shadow 0.2s ease;
			outline: none;
		}
		.delete-btn::after {
			content: '';
			position: absolute;
			inset: 0;
			border-radius: inherit;
			background: linear-gradient(180deg, rgba(255,255,255,0.22) 0%, transparent 60%);
			pointer-events: none;
		}
		.delete-btn:hover {
			transform: scale(1.1);
		}
		.delete-btn:active {
			transform: scale(0.95);
		}

		/* Add button — matches action-btn style with blue gradient */
		.add-btn {
			width: 30px;
			height: 30px;
			border: none;
			border-radius: 9px;
			background: linear-gradient(135deg, #60A5FA 0%, #3B82F6 100%);
			box-shadow: 0 2px 8px rgba(59, 130, 246, 0.35), 0 1px 2px rgba(59, 130, 246, 0.2);
			color: #fff;
			font-size: 16px;
			display: flex;
			align-items: center;
			justify-content: center;
			cursor: pointer;
			padding: 0;
			position: relative;
			transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
			            box-shadow 0.2s ease;
			outline: none;
		}
		.add-btn::after {
			content: '';
			position: absolute;
			inset: 0;
			border-radius: inherit;
			background: linear-gradient(180deg, rgba(255,255,255,0.22) 0%, transparent 60%);
			pointer-events: none;
		}
		.add-btn:hover {
			transform: scale(1.1);
		}
		.add-btn:active {
			transform: scale(0.95);
		}

		/* Delete confirm popover */
		.delete-popover {
			position: absolute;
			bottom: calc(100% + 10px);
			right: 0;
			min-width: 220px;
			padding: 12px 14px;
			border-radius: 10px;
			background: rgba(255, 255, 255, 0.92);
			backdrop-filter: blur(16px) saturate(1.8);
			-webkit-backdrop-filter: blur(16px) saturate(1.8);
			border: 1px solid rgba(0, 0, 0, 0.06);
			box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12), 0 1px 4px rgba(0, 0, 0, 0.06);
			z-index: 10;
			opacity: 0;
			transform: translateY(4px) scale(0.96);
			transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
			pointer-events: none;
		}
		.delete-popover.visible {
			opacity: 1;
			transform: translateY(0) scale(1);
			pointer-events: auto;
		}
		.delete-popover::after {
			content: '';
			position: absolute;
			bottom: -6px;
			right: 14px;
			width: 12px;
			height: 12px;
			background: rgba(255, 255, 255, 0.92);
			border-right: 1px solid rgba(0, 0, 0, 0.06);
			border-bottom: 1px solid rgba(0, 0, 0, 0.06);
			transform: rotate(45deg);
		}
		.delete-popover-text {
			font-size: 12.5px;
			color: #44403C;
			line-height: 1.5;
			margin-bottom: 10px;
		}
		.delete-popover-text strong {
			color: #1C1917;
		}
		.delete-popover-actions {
			display: flex;
			justify-content: flex-end;
			gap: 8px;
		}
		.delete-popover-actions button {
			padding: 4px 14px;
			border-radius: 6px;
			font-size: 12px;
			font-weight: 500;
			cursor: pointer;
			border: none;
			transition: all 0.15s ease;
			line-height: 1.4;
		}
		.popover-cancel {
			background: rgba(0, 0, 0, 0.05);
			color: #78716C;
		}
		.popover-cancel:hover {
			background: rgba(0, 0, 0, 0.08);
		}
		.popover-confirm {
			background: linear-gradient(135deg, #F87171, #DC2626);
			color: #fff;
		}
		.popover-confirm:hover {
			opacity: 0.9;
		}	`
	shadow.appendChild(style)

	// Unified container
	const container = document.createElement('div')
	container.className = 'container'

	// mainBtn 在下方创建；视觉闭包前向引用（调用时已赋值）
	let mainBtn: HTMLButtonElement

	// --- 视觉方法（闭包持有 host/shadow/mainBtn）---
	const positionIndicator = () => {
		const indicator = shadow.querySelector<HTMLDivElement>('#status-indicator')
		const activeSeg = shadow.querySelector<HTMLElement>('.status-segment.active')
		if (!indicator || !activeSeg) return

		const switchEl = activeSeg.parentElement
		if (!switchEl) return

		const switchRect = switchEl.getBoundingClientRect()
		const segRect = activeSeg.getBoundingClientRect()

		indicator.style.width = `${segRect.width - 4}px`
		indicator.style.left = `${segRect.left - switchRect.left + 2}px`

		const state = activeSeg.getAttribute('data-state') as SubmissionState
		const seg = STATUS_SEGMENTS.find(s => s.state === state)
		indicator.style.background = seg?.indicatorBg || '#E7E5E4'
	}

	const showDeletePopover = () => {
		const popover = shadow.querySelector('.delete-popover')
		if (popover) popover.classList.add('visible')
	}

	const hideDeletePopover = () => {
		const popover = shadow.querySelector('.delete-popover')
		if (popover) popover.classList.remove('visible')
	}

	const setState = (state: ButtonState) => {
		const config = BUTTON_CONFIG[state]
		mainBtn.style.background = config.bg
		mainBtn.style.boxShadow = config.shadow
		mainBtn.setAttribute('data-icon', config.icon)
		mainBtn.disabled = state === 'loading'
		mainBtn.classList.toggle('loading', state === 'loading')
	}

	const updateToggleVisual = (state: SubmissionState) => {
		const segments = shadow.querySelectorAll<HTMLDivElement>('.status-segment')
		for (const seg of segments) {
			const isActive = seg.getAttribute('data-state') === state
			seg.classList.toggle('active', isActive)
		}

		requestAnimationFrame(() => positionIndicator())
	}

	// --- UI 内部 listener（关 popover，非业务）---
	const handleOutsideClick = (e: Event) => {
		const composed = e.composedPath()
		if (!composed.includes(host)) hideDeletePopover()
	}
	const handleEscapeKey = (e: KeyboardEvent) => {
		if (e.key === 'Escape') hideDeletePopover()
	}

	// --- DOM 构建 ---
	// Status switch (only for known sites)
	if (opts.isKnownSite) {
		const statusSwitch = document.createElement('div')
		statusSwitch.className = 'status-switch'

		// Sliding indicator (pill background)
		const indicator = document.createElement('div')
		indicator.id = 'status-indicator'

		for (const seg of STATUS_SEGMENTS) {
			const segment = document.createElement('div')
			segment.className = `status-segment${seg.state === opts.currentSubmissionState ? ' active' : ''}`
			segment.setAttribute('data-state', seg.state)
			segment.style.setProperty('--active-color', seg.activeColor)
			segment.textContent = seg.label
			segment.addEventListener('click', () => opts.callbacks.onSegmentClick?.(seg.state))
			statusSwitch.appendChild(segment)
		}
		statusSwitch.appendChild(indicator)

		// Separator
		const separator = document.createElement('div')
		separator.className = 'separator'

		container.appendChild(statusSwitch)
		container.appendChild(separator)

		// Delete button
		const deleteBtn = document.createElement('button')
		deleteBtn.className = 'delete-btn'
		deleteBtn.title = '从外链库删除'
		deleteBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`
		deleteBtn.addEventListener('click', () => opts.callbacks.onDeleteClick?.())

		// Delete confirm popover
		const popover = document.createElement('div')
		popover.className = 'delete-popover'
		popover.innerHTML = `
			<div class="delete-popover-text">确定要从外链库中删除「<strong>${opts.matchedSiteName}</strong>」吗？</div>
			<div class="delete-popover-actions">
				<button class="popover-cancel">取消</button>
				<button class="popover-confirm">删除</button>
			</div>
		`
		popover.querySelector('.popover-cancel')!.addEventListener('click', (e) => {
			e.stopPropagation()
			hideDeletePopover()
		})
		popover.querySelector('.popover-confirm')!.addEventListener('click', (e) => {
			e.stopPropagation()
			hideDeletePopover()
			opts.callbacks.onConfirmDelete?.()
		})

		container.appendChild(deleteBtn)
		container.appendChild(popover)
	}

	// Action button

	mainBtn = document.createElement('button')
	mainBtn.className = 'action-btn'
	const iconSpan = document.createElement('span')
	iconSpan.setAttribute('data-icon', 'true')
	iconSpan.textContent = BUTTON_CONFIG[opts.currentState].icon
	mainBtn.appendChild(iconSpan)
	mainBtn.style.background = BUTTON_CONFIG[opts.currentState].bg
	mainBtn.style.boxShadow = BUTTON_CONFIG[opts.currentState].shadow
	mainBtn.addEventListener('click', () => opts.callbacks.onMainClick())

	const closeBtn = document.createElement('button')
	closeBtn.className = 'close-btn'
	closeBtn.textContent = '✕'
	closeBtn.title = 'Hide'
	closeBtn.addEventListener('click', (e) => {
		e.stopPropagation()
		opts.callbacks.onClose()
	})

	container.appendChild(mainBtn)

	// Add-to-library button (only for unknown sites)
	if (!opts.isKnownSite) {
		const addBtn = document.createElement('button')
		addBtn.className = 'add-btn'
		addBtn.title = '添加到外链库'
		addBtn.textContent = '+'
		addBtn.addEventListener('click', () => opts.callbacks.onAddClick?.())
		container.appendChild(addBtn)
	}

	container.appendChild(closeBtn)

	shadow.appendChild(container)
	document.body.appendChild(host)

	// Close popover on outside click or Escape
	document.addEventListener('click', handleOutsideClick)
	document.addEventListener('keydown', handleEscapeKey)

	// Position indicator after layout
	requestAnimationFrame(() => positionIndicator())

	const handle: ButtonHandle = {
		host,
		setState,
		updateToggleVisual,
		showDeletePopover,
		hideDeletePopover,
		positionIndicator,
		remove: () => {
			host.remove()
			document.removeEventListener('click', handleOutsideClick)
			document.removeEventListener('keydown', handleEscapeKey)
			// 注意：不重置业务状态——那是 store/glue 职责
		},
	}
	return handle
}
