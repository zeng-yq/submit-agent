import type { ExtensionMessage } from '@/messaging/messages'
import { createButton, BUTTON_ID, type ButtonState, type SubmissionState, type ButtonHandle } from '@/agent/floatButtonUi'

/**
 * FloatButton.content.ts
 * Floating button with three-state toggle for semi-auto form submission.
 * Uses Shadow DOM for style isolation.
 *
 * Layout: unified glass container — [status switch | separator | action button]
 *
 * Design language: premium glass-morphism with warm stone palette.
 * Primary: amber-gold, success: emerald, error: rose.
 *
 * SP-4 Task 1：CSS / createButton / 视觉函数已抽到 floatButtonUi.ts（纯渲染，回调驱动）。
 * 本文件保留模块状态 + 业务函数，通过构造 opts + callbacks 适配新 UI（行为等价）。
 */

let buttonHandle: ButtonHandle | null = null
let currentState: ButtonState = 'idle'
let currentSubmissionState: SubmissionState = 'not_started'
let userEnabled = true
let isKnownSite = false
let matchedSiteName: string | null = null

/** 视觉适配：同步模块状态 + 委托 handle.setState */
function setState(state: ButtonState) {
	currentState = state
	buttonHandle?.setState(state)
}

/**
 * 视觉适配：保留原 isKnownSite 守卫 + 同步模块状态 + 委托 handle.updateToggleVisual。
 * （守卫在 glue 层；floatButtonUi 的 handle.updateToggleVisual 无守卫，纯视觉。）
 */
function updateToggleVisual(state: SubmissionState) {
	if (!isKnownSite) return
	currentSubmissionState = state
	buttonHandle?.updateToggleVisual(state)
}

function setSubmissionState(state: SubmissionState) {
	updateToggleVisual(state)

	chrome.runtime.sendMessage({
		type: 'STATUS_UPDATE',
		payload: { status: state },
	}).catch(() => {})
}

function removeButton() {
	buttonHandle?.remove()
	buttonHandle = null
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

	sendMessageWithRetry({ type: 'FILL_PROGRESS', action: 'start' })
		.then((response: any) => {
			if (!response?.ok) {
				setState('error')
			}
		})
		.catch(() => {
			setState('error')
		})
}

async function refreshSiteMatch() {
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
}

function handleAddClick() {
	chrome.runtime.sendMessage({
		type: 'FLOAT_ADD_SITE',
		url: window.location.href,
	}).catch(() => {})
}

function handleDeleteClick() {
	if (!matchedSiteName) return
	buttonHandle?.showDeletePopover()
}

function performDelete() {
	if (!matchedSiteName) return

	chrome.runtime.sendMessage({
		type: 'DELETE_SITE',
		payload: { siteName: matchedSiteName },
	}).then((response: any) => {
		if (response?.success) {
			chrome.runtime.sendMessage({ type: 'CLOSE_TAB' })
			removeButton()
		}
	}).catch(() => {})
}

function updateButtonState(state: ButtonState) {
	setState(state)
}

function checkAndToggleButton() {
	if (userEnabled) {
		if (!document.getElementById(BUTTON_ID)) {
			buttonHandle = createButton({
				isKnownSite,
				currentState,
				currentSubmissionState,
				matchedSiteName,
				callbacks: {
					onMainClick: handleMainClick,
					onDeleteClick: handleDeleteClick,
					onAddClick: handleAddClick,
					onClose: () => {
						removeButton()
						chrome.runtime.sendMessage({ type: 'FLOAT_BUTTON_TOGGLE', enabled: false }).catch(() => {})
					},
					onSegmentClick: setSubmissionState,
					onConfirmDelete: performDelete,
				},
			})
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

	chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
		if (message.type === 'FLOAT_BUTTON_TOGGLE') {
			userEnabled = message.enabled
			checkAndToggleButton()
			return
		}
		if (message.type === 'FILL_PROGRESS') {
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
		if (message.type === 'SITE_ADDED') {
			refreshSiteMatch().then(() => {
				removeButton()
				checkAndToggleButton()
			})
		}
	})

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', checkAndToggleButton)
	} else {
		checkAndToggleButton()
	}
}
