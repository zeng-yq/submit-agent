
/**
 * FloatButton.content.ts
 * Floating button with three-state toggle for semi-auto form submission.
 * Uses Shadow DOM for style isolation.
 *
 * Layout: unified glass container — [status switch | separator | action button]
 *
 * Design language: premium glass-morphism with warm stone palette.
 * Primary: amber-gold, success: emerald, error: rose.
 */

type ButtonState = 'idle' | 'loading' | 'done' | 'error' | 'no-product'
type SubmissionState = 'not_started' | 'submitted' | 'failed'

const BUTTON_ID = 'submit-agent-float'

// Main action button configs — gradient backgrounds with layered shadows
const BUTTON_CONFIG: Record<ButtonState, { bg: string; shadow: string; icon: string }> = {
	idle: { bg: 'linear-gradient(135deg, #E8A308 0%, #CA8A04 100%)', shadow: '0 2px 8px rgba(202, 138, 4, 0.35), 0 1px 2px rgba(202, 138, 4, 0.2)', icon: '▶' },
	loading: { bg: 'linear-gradient(135deg, #FBBF24 0%, #F59E0B 100%)', shadow: '0 2px 8px rgba(245, 158, 11, 0.35), 0 1px 2px rgba(245, 158, 11, 0.2)', icon: '↻' },
	done: { bg: 'linear-gradient(135deg, #34D399 0%, #16A34A 100%)', shadow: '0 2px 8px rgba(22, 163, 74, 0.35), 0 1px 2px rgba(22, 163, 74, 0.2)', icon: '✓' },
	error: { bg: 'linear-gradient(135deg, #F87171 0%, #DC2626 100%)', shadow: '0 2px 8px rgba(220, 38, 38, 0.35), 0 1px 2px rgba(220, 38, 38, 0.2)', icon: '✗' },
	'no-product': { bg: 'linear-gradient(135deg, #D6D3D1 0%, #A8A29E 100%)', shadow: '0 2px 8px rgba(168, 162, 158, 0.25), 0 1px 2px rgba(168, 162, 158, 0.15)', icon: '!' },
}

// Status switch segment configs
const STATUS_SEGMENTS: Array<{ state: SubmissionState; label: string; activeColor: string; indicatorBg: string }> = [
	{ state: 'not_started', label: '未提交', activeColor: '#92400E', indicatorBg: '#FEF3C7' },
	{ state: 'submitted', label: '成功', activeColor: '#166534', indicatorBg: '#DCFCE7' },
	{ state: 'failed', label: '失败', activeColor: '#991B1B', indicatorBg: '#FEE2E2' },
]

let host: HTMLElement | null = null
let shadow: ShadowRoot | null = null
let mainBtn: HTMLButtonElement | null = null
let currentState: ButtonState = 'idle'
let currentSubmissionState: SubmissionState = 'not_started'
let userEnabled = true
let isKnownSite = false
let matchedSiteName: string | null = null

function setState(state: ButtonState) {
	if (!mainBtn) return
	currentState = state

	const config = BUTTON_CONFIG[state]
	mainBtn.style.background = config.bg
	mainBtn.style.boxShadow = config.shadow
	mainBtn.setAttribute('data-icon', config.icon)
	mainBtn.disabled = state === 'loading'
	mainBtn.classList.toggle('loading', state === 'loading')
}

function positionIndicator() {
	if (!shadow) return
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

function updateToggleVisual(state: SubmissionState) {
	if (!isKnownSite) return
	currentSubmissionState = state

	if (!shadow) return
	const segments = shadow.querySelectorAll<HTMLDivElement>('.status-segment')
	for (const seg of segments) {
		const isActive = seg.getAttribute('data-state') === state
		seg.classList.toggle('active', isActive)
	}

	requestAnimationFrame(() => positionIndicator())
}

function setSubmissionState(state: SubmissionState) {
	updateToggleVisual(state)

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
	].join(';')

	shadow = host.attachShadow({ mode: 'open' })

	const style = document.createElement('style')
	style.textContent = `
		:host { all: initial; }

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
	`
	shadow.appendChild(style)

	// Unified container
	const container = document.createElement('div')
	container.className = 'container'

	// Status switch (only for known sites)
	if (isKnownSite) {
		const statusSwitch = document.createElement('div')
		statusSwitch.className = 'status-switch'

		// Sliding indicator (pill background)
		const indicator = document.createElement('div')
		indicator.id = 'status-indicator'

		for (const seg of STATUS_SEGMENTS) {
			const segment = document.createElement('div')
			segment.className = `status-segment${seg.state === currentSubmissionState ? ' active' : ''}`
			segment.setAttribute('data-state', seg.state)
			segment.style.setProperty('--active-color', seg.activeColor)
			segment.textContent = seg.label
			segment.addEventListener('click', () => setSubmissionState(seg.state))
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
		deleteBtn.addEventListener('click', handleDeleteClick)

		container.appendChild(deleteBtn)
	}

	// Action button
	const btnWrap = document.createElement('div')
	btnWrap.style.position = 'relative'

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

	container.appendChild(mainBtn)
	container.appendChild(closeBtn)

	shadow.appendChild(container)
	document.body.appendChild(host)

	// Position indicator after layout
	requestAnimationFrame(() => positionIndicator())
}

function removeButton() {
	const existing = document.getElementById(BUTTON_ID)
	if (existing) existing.remove()
	host = null
	shadow = null
	mainBtn = null
}

/**
 * Send a message to the background with automatic retry when the service worker
 * is waking up from suspension (MV3).
 */
function sendMessageWithRetry(
	message: { type: string; action: string },
	maxRetries = 2,
	delayMs = 500,
): Promise<unknown> {
	return new Promise((resolve, reject) => {
		function attempt(retriesLeft: number) {
			chrome.runtime.sendMessage(message, (response) => {
				if (chrome.runtime.lastError) {
					if (retriesLeft > 0) {
						setTimeout(() => attempt(retriesLeft - 1), delayMs)
					} else {
						reject(chrome.runtime.lastError)
					}
				} else {
					resolve(response)
				}
			})
		}
		attempt(maxRetries)
	})
}

function handleMainClick() {
	if (currentState === 'loading') return

	sendMessageWithRetry({ type: 'FLOAT_FILL', action: 'start' })
		.then((response: any) => {
			if (!response?.ok) {
				setState('error')
			}
		})
		.catch(() => {
			setState('error')
		})
}

function handleDeleteClick() {
	if (!matchedSiteName) return

	const confirmed = confirm(`确定要从外链库中删除「${matchedSiteName}」吗？`)
	if (!confirmed) return

	chrome.runtime.sendMessage({
		type: 'DELETE_SITE',
		payload: { siteName: matchedSiteName },
	}).then((response: any) => {
		if (response?.success) {
			chrome.runtime.sendMessage({ type: 'CLOSE_TAB' })
			removeButton()
		}
	}).catch(() => {
		// 删除失败时静默处理
	})
}

function updateButtonState(state: ButtonState) {
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

export async function initFloatButton(enabled: boolean) {
	userEnabled = enabled

	// 通过 background 判断当前页面是否在资源库中
	//（content script 无法访问扩展的 IndexedDB，必须委托给 background）
	try {
		const response = await chrome.runtime.sendMessage({
			type: 'CHECK_SITE_MATCH',
			payload: { url: window.location.href },
		})
		isKnownSite = response?.isKnownSite === true
		matchedSiteName = response?.siteName ?? null
		if (isKnownSite && response?.submissionStatus) {
			currentSubmissionState = response.submissionStatus
		}
	} catch {
		isKnownSite = false
	}

	chrome.runtime.onMessage.addListener((message) => {
		if (message.type === 'FLOAT_BUTTON_TOGGLE') {
			userEnabled = message.enabled as boolean
			checkAndToggleButton()
			return
		}
		if (message.type === 'FLOAT_FILL') {
			switch (message.action) {
				case 'progress':
				case 'confirm':
					updateButtonState('loading')
					break
				case 'done':
					updateButtonState('done')
					updateToggleVisual('submitted')
					break
				case 'error':
					updateButtonState('error')
					updateToggleVisual('failed')
					break
				case 'no-match':
					updateButtonState('error')
					break
				case 'no-product':
					updateButtonState('no-product')
					break
				case 'all-done':
					updateButtonState('done')
					updateToggleVisual('submitted')
					break
				case 'reset':
					updateButtonState('idle')
					updateToggleVisual('not_started')
					break
			}
		}
		if (message.type === 'SUBMISSION_STATUS_CHANGED') {
			const { siteName, toggleState } = message.payload ?? {}
			if (siteName && siteName === matchedSiteName) {
				updateToggleVisual(toggleState)
			}
		}
	})

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', checkAndToggleButton)
	} else {
		checkAndToggleButton()
	}
}
