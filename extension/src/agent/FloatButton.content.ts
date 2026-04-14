/**
 * FloatButton.content.ts
 * Floating button with three-state toggle for semi-auto form submission.
 * Uses Shadow DOM for style isolation.
 *
 * Layout: horizontal — [status switch] [action button]
 *
 * Design language: warm stone palette matching the side panel.
 * Primary: amber-gold (#D4990A), success: emerald, error: rose.
 */

type ButtonState = 'idle' | 'loading' | 'done' | 'error' | 'no-product'
type SubmissionState = 'not_started' | 'submitted' | 'failed'

const BUTTON_ID = 'submit-agent-float'

// Main action button configs — aligned with side panel palette
const BUTTON_CONFIG: Record<ButtonState, { bg: string; shadow: string; icon: string }> = {
	idle: { bg: '#D4990A', shadow: '0 1px 4px rgba(212, 153, 10, 0.3)', icon: '▶' },
	loading: { bg: '#F59E0B', shadow: '0 1px 4px rgba(245, 158, 11, 0.3)', icon: '↻' },
	done: { bg: '#22C55E', shadow: '0 1px 4px rgba(34, 197, 94, 0.3)', icon: '✓' },
	error: { bg: '#EF4444', shadow: '0 1px 4px rgba(239, 68, 68, 0.3)', icon: '✗' },
	'no-product': { bg: '#A8A29E', shadow: '0 1px 4px rgba(168, 162, 158, 0.2)', icon: '!' },
}

// Status switch segment configs
const STATUS_SEGMENTS: Array<{ state: SubmissionState; label: string; activeBg: string; activeColor: string }> = [
	{ state: 'not_started', label: '未提交', activeBg: '#FEF3C7', activeColor: '#92400E' },
	{ state: 'submitted', label: '成功', activeBg: '#DCFCE7', activeColor: '#166534' },
	{ state: 'failed', label: '失败', activeBg: '#FEE2E2', activeColor: '#991B1B' },
]

let host: HTMLElement | null = null
let shadow: ShadowRoot | null = null
let mainBtn: HTMLButtonElement | null = null
let currentState: ButtonState = 'idle'
let currentSubmissionState: SubmissionState = 'not_started'
let userEnabled = true

function setState(state: ButtonState) {
	if (!mainBtn) return
	currentState = state

	const config = BUTTON_CONFIG[state]
	mainBtn.style.background = config.bg
	mainBtn.style.boxShadow = config.shadow
	mainBtn.setAttribute('data-icon', config.icon)
	mainBtn.disabled = state === 'loading'
}

function setSubmissionState(state: SubmissionState) {
	currentSubmissionState = state

	if (!shadow) return
	const segments = shadow.querySelectorAll<HTMLDivElement>('.status-segment')
	for (const seg of segments) {
		const isActive = seg.getAttribute('data-state') === state
		seg.classList.toggle('active', isActive)
	}

	// Send status update to background
	chrome.runtime.sendMessage({
		type: 'STATUS_UPDATE',
		payload: { status: state },
	}).catch(() => {})
}

function createButton() {
	if (document.getElementById(BUTTON_ID)) return

	host = document.createElement('div')
	host.id = BUTTON_ID
	host.style.cssText = [
		'position: fixed',
		'bottom: 24px',
		'right: 24px',
		'z-index: 2147483647',
		'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
		'display: flex',
		'align-items: center',
		'gap: 4px',
	].join(';')

	shadow = host.attachShadow({ mode: 'open' })

	const style = document.createElement('style')
	style.textContent = `
		:host { all: initial; }

		/* Status switch */
		.status-switch {
			display: flex;
			width: 102px;
			height: 26px;
			border-radius: 8px;
			background: rgba(255, 255, 255, 0.88);
			backdrop-filter: blur(12px);
			-webkit-backdrop-filter: blur(12px);
			border: 1px solid rgba(0, 0, 0, 0.06);
			box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
			overflow: hidden;
			font-size: 11px;
			font-weight: 500;
			user-select: none;
			cursor: pointer;
			letter-spacing: -0.01em;
		}
		.status-segment {
			flex: 1;
			display: flex;
			align-items: center;
			justify-content: center;
			color: #A8A29E;
			transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
			position: relative;
		}
		.status-segment.active {
			color: var(--active-color, #57534E);
			background: var(--active-bg, #E7E5E4);
			font-weight: 600;
		}
		.status-segment:hover:not(.active) {
			color: #78716C;
			background: rgba(0, 0, 0, 0.03);
		}

		/* Action button — same height as switch */
		.action-btn {
			width: 26px;
			height: 26px;
			border: none;
			border-radius: 8px;
			color: #fff;
			font-size: 12px;
			display: flex;
			align-items: center;
			justify-content: center;
			cursor: pointer;
			transition: transform 0.15s cubic-bezier(0.4, 0, 0.2, 1),
			            box-shadow 0.15s ease;
			outline: none;
		}
		.action-btn:hover:not(:disabled) {
			transform: scale(1.08);
		}
		.action-btn:active:not(:disabled) {
			transform: scale(0.94);
		}
		.action-btn:disabled {
			cursor: default;
			opacity: 0.9;
		}

		/* Spinner */
		@keyframes spin {
			from { transform: rotate(0deg); }
			to { transform: rotate(360deg); }
		}
		.action-btn.loading::before {
			content: '';
			width: 12px;
			height: 12px;
			border: 2px solid rgba(255,255,255,0.3);
			border-top-color: #fff;
			border-radius: 50%;
			animation: spin 0.7s linear infinite;
		}
		.action-btn.loading [data-icon] {
			display: none;
		}

		/* Close button */
		.btn-wrap {
			position: relative;
		}
		.close-btn {
			position: absolute;
			top: -3px;
			right: -3px;
			width: 14px;
			height: 14px;
			border-radius: 50%;
			background: #A8A29E;
			color: #fff;
			font-size: 7px;
			line-height: 1;
			display: flex;
			align-items: center;
			justify-content: center;
			border: 1.5px solid rgba(255, 255, 255, 0.92);
			cursor: pointer;
			padding: 0;
			opacity: 0;
			transform: scale(0.8);
			transition: opacity 0.15s, background 0.15s, transform 0.15s;
		}
		.btn-wrap:hover .close-btn {
			opacity: 1;
			transform: scale(1);
		}
		.close-btn:hover {
			background: #EF4444;
		}
	`
	shadow.appendChild(style)

	// Status switch
	const statusSwitch = document.createElement('div')
	statusSwitch.className = 'status-switch'

	for (const seg of STATUS_SEGMENTS) {
		const segment = document.createElement('div')
		segment.className = `status-segment${seg.state === currentSubmissionState ? ' active' : ''}`
		segment.setAttribute('data-state', seg.state)
		segment.style.setProperty('--active-bg', seg.activeBg)
		segment.style.setProperty('--active-color', seg.activeColor)
		segment.textContent = seg.label
		segment.addEventListener('click', () => setSubmissionState(seg.state))
		statusSwitch.appendChild(segment)
	}

	// Action button
	const btnWrap = document.createElement('div')
	btnWrap.className = 'btn-wrap'

	mainBtn = document.createElement('button')
	mainBtn.className = 'action-btn'
	const iconSpan = document.createElement('span')
	iconSpan.setAttribute('data-icon', 'true')
	iconSpan.textContent = BUTTON_CONFIG[currentState].icon
	mainBtn.appendChild(iconSpan)
	mainBtn.style.background = BUTTON_CONFIG[currentState].bg
	mainBtn.style.boxShadow = BUTTON_CONFIG[currentState].shadow
	mainBtn.addEventListener('click', handleMainClick)

	const closeBtn = document.createElement('button')
	closeBtn.className = 'close-btn'
	closeBtn.textContent = '✕'
	closeBtn.title = 'Hide'
	closeBtn.addEventListener('click', (e) => {
		e.stopPropagation()
		removeButton()
		chrome.runtime.sendMessage({ type: 'FLOAT_BUTTON_TOGGLE', enabled: false }).catch(() => {})
	})

	btnWrap.appendChild(mainBtn)
	btnWrap.appendChild(closeBtn)

	shadow.appendChild(statusSwitch)
	shadow.appendChild(btnWrap)

	document.body.appendChild(host)
}

function removeButton() {
	const existing = document.getElementById(BUTTON_ID)
	if (existing) existing.remove()
	host = null
	shadow = null
	mainBtn = null
}

function handleMainClick() {
	if (currentState === 'loading') return

	setState('loading')
	if (mainBtn) mainBtn.classList.add('loading')

	chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'start' }, (response) => {
		if (mainBtn) mainBtn.classList.remove('loading')
		if (chrome.runtime.lastError || !response?.ok) {
			setState('error')
		}
		// On success, stay in loading state until the agent sends progress/done/error
	})
}

function updateButtonState(state: ButtonState) {
	if (mainBtn) mainBtn.classList.remove('loading')
	setState(state)
}

function checkAndToggleButton() {
	if (userEnabled) {
		if (!document.getElementById(BUTTON_ID)) {
			createButton()
		}
	} else {
		removeButton()
	}
}

export function initFloatButton(enabled: boolean) {
	userEnabled = enabled

	chrome.runtime.onMessage.addListener((message) => {
		if (message.type === 'FLOAT_BUTTON_TOGGLE') {
			userEnabled = message.enabled as boolean
			checkAndToggleButton()
			return
		}
		if (message.type === 'FLOAT_FILL') {
			switch (message.action) {
				case 'progress':
					updateButtonState('loading')
					break
				case 'done':
					updateButtonState('done')
					break
				case 'error':
				case 'no-match':
					updateButtonState('error')
					break
				case 'no-product':
					updateButtonState('no-product')
					break
				case 'all-done':
					updateButtonState('done')
					break
				case 'reset':
					updateButtonState('idle')
					break
			}
		}
	})

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', checkAndToggleButton)
	} else {
		checkAndToggleButton()
	}
}
