import type { ExtensionMessage } from '@/messaging/messages'
import { BUTTON_ID, type ButtonState, type SubmissionState } from '@/agent/floatButtonUi'
import { FloatButtonStore } from '@/agent/floatButtonStore'

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
 * SP-4 Task 2：状态 + 生命周期抽到 floatButtonStore.ts。本文件保留业务函数，操作 store。
 */

let store: FloatButtonStore | null = null

/** 视觉适配：委托 store.setState（同步状态 + handle.setState） */
function setState(state: ButtonState) {
	store?.setState(state)
}

/**
 * 视觉适配：保留原 isKnownSite 守卫 + 委托 store.setSubmissionState（同步状态 + handle.updateToggleVisual）。
 * （守卫在 glue 层；floatButtonUi 的 handle.updateToggleVisual 无守卫，纯视觉。）
 */
function updateToggleVisual(state: SubmissionState) {
	if (!store?.isKnownSite) return
	store.setSubmissionState(state)
}

function setSubmissionState(state: SubmissionState) {
	updateToggleVisual(state)

	chrome.runtime.sendMessage({
		type: 'STATUS_UPDATE',
		payload: { status: state },
	}).catch(() => {})
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
	if (store?.currentState === 'loading') return

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
	if (!store) return
	try {
		const response = await chrome.runtime.sendMessage({
			type: 'CHECK_SITE_MATCH',
			payload: { url: window.location.href },
		})
		const known = response?.isKnownSite === true
		const name = response?.siteName ?? null
		store.setSiteMatch(known, name)
		if (known && response?.submissionStatus) {
			store.currentSubmissionState = response.submissionStatus
		}
	} catch {
		store.isKnownSite = false
	}
}

function handleAddClick() {
	chrome.runtime.sendMessage({
		type: 'FLOAT_ADD_SITE',
		url: window.location.href,
	}).catch(() => {})
}

function handleDeleteClick() {
	if (!store?.matchedSiteName) return
	store.showDeletePopover()
}

function performDelete() {
	if (!store?.matchedSiteName) return
	const siteName = store.matchedSiteName

	chrome.runtime.sendMessage({
		type: 'DELETE_SITE',
		payload: { siteName },
	}).then((response: any) => {
		if (response?.success) {
			chrome.runtime.sendMessage({ type: 'CLOSE_TAB' })
			store?.unmount()
		}
	}).catch(() => {})
}

function updateButtonState(state: ButtonState) {
	setState(state)
}

function checkAndToggleButton() {
	if (!store) return
	if (store.userEnabled) {
		if (!document.getElementById(BUTTON_ID)) {
			store.mount({
				isKnownSite: store.isKnownSite,
				currentState: store.currentState,
				currentSubmissionState: store.currentSubmissionState,
				matchedSiteName: store.matchedSiteName,
				callbacks: {
					onMainClick: handleMainClick,
					onDeleteClick: handleDeleteClick,
					onAddClick: handleAddClick,
					onClose: () => {
						store?.unmount()
						chrome.runtime.sendMessage({ type: 'FLOAT_BUTTON_TOGGLE', enabled: false }).catch(() => {})
					},
					onSegmentClick: setSubmissionState,
					onConfirmDelete: performDelete,
				},
			})
		}
	} else {
		store.unmount()
	}
}

export async function initFloatButton(enabled: boolean) {
	store = new FloatButtonStore(enabled)

	// 通过 background 判断当前页面是否在资源库中
	//（content script 无法访问扩展的 IndexedDB，必须委托给 background）
	try {
		const response = await chrome.runtime.sendMessage({
			type: 'CHECK_SITE_MATCH',
			payload: { url: window.location.href },
		})
		const known = response?.isKnownSite === true
		const name = response?.siteName ?? null
		store.setSiteMatch(known, name)
		if (known && response?.submissionStatus) {
			store.currentSubmissionState = response.submissionStatus
		}
	} catch {
		store.isKnownSite = false
	}

	store.registerMessageHandler((message: ExtensionMessage) => {
		if (message.type === 'FLOAT_BUTTON_TOGGLE') {
			store!.userEnabled = message.enabled
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
			if (siteName && siteName === store?.matchedSiteName) {
				updateToggleVisual(toggleState)
			}
		}
		if (message.type === 'SITE_ADDED') {
			// unmount 会重置业务状态（userEnabled 保留），故 refresh 必须在 unmount 之后，
			// 再用新状态重建按钮——与原 refresh→remove→check 行为等价。
			store?.unmount()
			refreshSiteMatch().then(() => checkAndToggleButton())
		}
	})

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', checkAndToggleButton)
	} else {
		checkAndToggleButton()
	}
}
