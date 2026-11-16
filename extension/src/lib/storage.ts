import type { LLMSettings } from './types'

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1'
export const DEEPSEEK_MODEL = 'deepseek-v4-flash'

const STORAGE_KEYS = {
	deepseekApiKey: 'submitAgent_deepseekApiKey',
	activeProductId: 'submitAgent_activeProductId',
} as const

/** 端点与模型固定，仅 API Key 可配置（DeepSeek 专属，见 GLOSSARY.md） */
export async function getDeepSeekConfig(): Promise<LLMSettings> {
	const result = await chrome.storage.local.get(STORAGE_KEYS.deepseekApiKey)
	const apiKey = (result[STORAGE_KEYS.deepseekApiKey] as string) ?? ''
	return { apiKey, baseUrl: DEEPSEEK_BASE_URL, model: DEEPSEEK_MODEL }
}

export async function setDeepSeekApiKey(apiKey: string): Promise<void> {
	await chrome.storage.local.set({ [STORAGE_KEYS.deepseekApiKey]: apiKey })
}

export async function getActiveProductId(): Promise<string | null> {
	const result = await chrome.storage.local.get(STORAGE_KEYS.activeProductId)
	return (result[STORAGE_KEYS.activeProductId] as string) ?? null
}

export async function setActiveProductId(id: string | null): Promise<void> {
	if (id === null) {
		await chrome.storage.local.remove(STORAGE_KEYS.activeProductId)
	} else {
		await chrome.storage.local.set({ [STORAGE_KEYS.activeProductId]: id })
	}
}
