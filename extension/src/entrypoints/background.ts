/** 旧版本功能残留的 chrome.storage.local 键，安装/更新时统一清空 */
const LEGACY_STORAGE_KEYS = [
	'submitAgent_llmConfig',
	'submitAgent_providerConfigs',
	'submitAgent_autoRewrite',
	'submitAgent_floatButtonEnabled',
	'submitAgent_analysisConcurrency',
	'submitAgent_serviceAccount',
	'submitAgent_saAccessToken',
	'submitAgent_saExpiresAt',
]

export default defineBackground(() => {
	chrome.sidePanel
		.setPanelBehavior({ openPanelOnActionClick: true })
		.catch((err: unknown) => console.error('[Submit Agent] 设置侧栏点击行为失败:', err))

	chrome.runtime.onInstalled.addListener(() => {
		chrome.storage.local
			.remove(LEGACY_STORAGE_KEYS)
			.catch((err: unknown) => console.error('[Submit Agent] 清理旧存储键失败:', err))
	})
})
