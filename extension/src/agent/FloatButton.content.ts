/**
 * FloatButton.content.ts
 * Injects a floating "Auto-fill" button into every page.
 * Users decide when to use it — no form detection.
 * Uses Shadow DOM to isolate styles from the host page.
 */

type ButtonState = 'idle' | 'loading' | 'done' | 'error' | 'no-product'

const BUTTON_ID = 'submit-agent-float'

const LABELS: Record<ButtonState, string> = {
	'idle': '✦ Auto-fill',
	'loading': 'Filling...',
	'done': '✓ Done',
	'error': '✗ Failed',
	'no-product': 'Set up product first',
}

const COLORS: Record<ButtonState, string> = {
	'idle': '#6366f1',
	'loading': '#8b5cf6',
	'done': '#22c55e',
	'error': '#ef4444',
	'no-product': '#f59e0b',
}

let host: HTMLElement | null = null
let shadow: ShadowRoot | null = null
let btn: HTMLButtonElement | null = null
let currentState: ButtonState = 'idle'
let userEnabled = true

function setState(state: ButtonState) {
	if (!btn) return
	currentState = state
	btn.textContent = LABELS[state]
	btn.style.background = COLORS[state]
	btn.disabled = state === 'loading'
	btn.style.cursor = state === 'loading' ? 'default' : 'pointer'

	if (state === 'done' || state === 'error') {
		setTimeout(() => setState('idle'), 4000)
	}
}

function createButton() {
	if (document.getElementById(BUTTON_ID)) return

	host = document.createElement('div')
	host.id = BUTTON_ID
	host.style.cssText = [
		'position: fixed',
		'bottom: 20px',
		'right: 20px',
		'z-index: 2147483647',
		'font-family: system-ui, sans-serif',
	].join(';')

	shadow = host.attachShadow({ mode: 'open' })

	const style = document.createElement('style')
	style.textContent = `
		.wrap {
			position: relative;
			display: inline-block;
		}
		button {
			padding: 8px 14px;
			border: none;
			border-radius: 20px;
			color: #fff;
			font-size: 13px;
			font-weight: 600;
			letter-spacing: 0.01em;
			box-shadow: 0 2px 12px rgba(0,0,0,0.18);
			transition: opacity 0.15s, transform 0.15s;
			white-space: nowrap;
			outline: none;
			cursor: pointer;
		}
		button:hover:not(:disabled) {
			opacity: 0.88;
			transform: translateY(-1px);
		}
		button:disabled {
			opacity: 0.75;
			cursor: default;
		}
		.close-btn {
			position: absolute;
			top: -5px;
			right: -5px;
			padding: 0 !important;
			width: 14px;
			height: 14px;
			border-radius: 50% !important;
			background: rgba(80,80,80,0.85) !important;
			color: #fff;
			font-size: 9px !important;
			line-height: 1;
			display: flex;
			align-items: center;
			justify-content: center;
			box-shadow: 0 1px 3px rgba(0,0,0,0.3) !important;
			cursor: pointer !important;
			transform: none !important;
			opacity: 0.8;
		}
		.close-btn:hover {
			opacity: 1 !important;
			transform: none !important;
		}
	`

	const wrap = document.createElement('div')
	wrap.className = 'wrap'

	btn = document.createElement('button')
	btn.textContent = LABELS['idle']
	btn.style.background = COLORS['idle']
	btn.addEventListener('click', handleClick)

	const closeBtn = document.createElement('button')
	closeBtn.className = 'close-btn'
	closeBtn.textContent = '✕'
	closeBtn.title = 'Hide float button'
	closeBtn.addEventListener('click', (e) => {
		e.stopPropagation()
		removeButton()
		chrome.runtime.sendMessage({ type: 'FLOAT_BUTTON_TOGGLE', enabled: false }).catch(() => {})
	})

	wrap.appendChild(btn)
	wrap.appendChild(closeBtn)
	shadow.appendChild(style)
	shadow.appendChild(wrap)
	document.body.appendChild(host)
}

function removeButton() {
	const existing = document.getElementById(BUTTON_ID)
	if (existing) existing.remove()
	host = null
	shadow = null
	btn = null
}

function handleClick() {
	if (currentState === 'loading') return

	setState('loading')

	chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'start' }, (response) => {
		if (chrome.runtime.lastError || !response?.ok) {
			setState('error')
		}
		// State will be updated by incoming messages from sidepanel
	})
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
		if (message.type !== 'FLOAT_FILL') return
		switch (message.action) {
			case 'progress':
				setState('loading')
				break
			case 'done':
				setState('done')
				break
			case 'error':
				setState('error')
				break
			case 'no-product':
				setState('no-product')
				break
		}
	})

	// Show immediately if enabled, no form detection
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', checkAndToggleButton)
	} else {
		checkAndToggleButton()
	}
}
