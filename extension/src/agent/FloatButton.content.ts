import type { ExtensionMessage } from '@/messaging/messages'
import { BUTTON_ID, type ButtonCallbacks, type ButtonRenderOpts, type SubmissionState } from '@/agent/floatButtonUi'
import { FloatButtonStore } from '@/agent/floatButtonStore'

/** 胶水层：渲染在 floatButtonUi.ts，状态/生命周期在 floatButtonStore.ts。这里只做消息↔状态↔UI 接线。 */

let store: FloatButtonStore | null = null

/** MV3 service-worker 唤醒重试（sendMessage 失败时退避重试）。*/
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

export async function initFloatButton(enabled: boolean): Promise<void> {
	store = new FloatButtonStore(enabled)
	await refreshAndMount()
	store.registerMessageHandler(handleMessage)
}

export function disposeFloatButton(): void {
	store?.dispose()
	store = null
}

/** CHECK_SITE_MATCH → 写入 store 业务状态 → 按 userEnabled mount/unmount。 */
async function refreshAndMount() {
	if (!store) return
	try {
		const response: any = await chrome.runtime.sendMessage({
			type: 'CHECK_SITE_MATCH',
			payload: { url: window.location.href },
		})
		const known = response?.isKnownSite === true
		store.setSiteMatch(known, response?.siteName ?? null)
		if (known && response?.submissionStatus) {
			store.currentSubmissionState = response.submissionStatus
		}
	} catch {
		store.setSiteMatch(false, null)
	}
	checkAndToggle()
}

function checkAndToggle() {
	if (!store) return
	if (store.userEnabled) {
		if (!document.getElementById(BUTTON_ID)) store.mount(buildOpts())
	} else {
		store.unmount()
	}
}

/** 构造 render opts（绑业务回调）。 */
function buildOpts(): ButtonRenderOpts {
	const callbacks: ButtonCallbacks = {
		onMainClick: handleMainClick,
		onClose: () => {
			store?.unmount()
			chrome.runtime.sendMessage({ type: 'FLOAT_BUTTON_TOGGLE', enabled: false }).catch(() => {})
		},
		onAddClick: handleAddClick,
		onDeleteClick: () => store?.showDeletePopover(),
		onConfirmDelete: performDelete,
		onSegmentClick: (state: SubmissionState) => {
			store?.setSubmissionState(state)
			chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', payload: { status: state } }).catch(() => {})
		},
	}
	return {
		isKnownSite: store!.isKnownSite,
		currentState: store!.currentState,
		currentSubmissionState: store!.currentSubmissionState,
		matchedSiteName: store!.matchedSiteName,
		callbacks,
	}
}

/** 主按钮：触发填写+提交流程（失败置 error）。 */
function handleMainClick() {
	if (store?.currentState === 'loading') return
	sendMessageWithRetry({ type: 'FILL_PROGRESS', action: 'start' })
		.then((response: any) => {
			if (!response?.ok) store?.setState('error')
		})
		.catch(() => store?.setState('error'))
}

/** 未知站点：加入外链库。 */
function handleAddClick() {
	chrome.runtime.sendMessage({
		type: 'FLOAT_ADD_SITE',
		url: window.location.href,
	}).catch(() => {})
}

/** 删除当前站点：局部捕获 siteName 防 round-trip 期间 matchedSiteName 变更。 */
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

/** 同步 submission toggle（保留原 isKnownSite 守卫——store.setSubmissionState 无守卫）。 */
function syncSubmission(state: SubmissionState) {
	if (!store?.isKnownSite) return
	store.setSubmissionState(state)
}

/** 消息路由：FLOAT_BUTTON_TOGGLE / FILL_PROGRESS / SUBMISSION_STATUS_CHANGED / SITE_ADDED。 */
function handleMessage(msg: ExtensionMessage): void {
	if (!store) return
	if (msg.type === 'FLOAT_BUTTON_TOGGLE') {
		store.userEnabled = msg.enabled
		checkAndToggle()
		return
	}
	if (msg.type === 'FILL_PROGRESS') {
		switch (msg.action) {
			case 'progress':
			case 'confirm':
				store.setState('loading'); break
			case 'done':
				store.setState('done'); syncSubmission('submitted'); break
			case 'error':
				store.setState('error'); syncSubmission('failed'); break
			case 'no-match':
				store.setState('error'); break
			case 'no-product':
				store.setState('no-product'); break
			case 'all-done':
				store.setState('done'); syncSubmission('submitted'); break
			case 'reset':
				store.setState('idle'); syncSubmission('not_started'); break
		}
		return
	}
	if (msg.type === 'SUBMISSION_STATUS_CHANGED') {
		const { siteName, toggleState } = msg.payload ?? {}
		if (siteName && siteName === store.matchedSiteName) syncSubmission(toggleState)
		return
	}
	if (msg.type === 'SITE_ADDED') {
		// unmount 重置业务状态（userEnabled 保留）；refresh 须在 unmount 之后，再用新状态重建按钮。
		store.unmount()
		refreshAndMount()
		return
	}
}
