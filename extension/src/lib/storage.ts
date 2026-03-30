import { BUILTIN_LLM_CONFIG } from '@/agent/constants'
import type { ExtSettings, LLMSettings } from './types'

const STORAGE_KEYS = {
	llmConfig: 'submitAgent_llmConfig',
	language: 'submitAgent_language',
	autoRewrite: 'submitAgent_autoRewrite',
	activeProductId: 'submitAgent_activeProductId',
	floatButtonEnabled: 'submitAgent_floatButtonEnabled',
} as const

export async function getLLMConfig(): Promise<LLMSettings> {
	const result = await chrome.storage.local.get(STORAGE_KEYS.llmConfig)
	const stored = result[STORAGE_KEYS.llmConfig] as LLMSettings | undefined
	// Fall back to built-in Groq config if user hasn't configured their own
	if (!stored || (!stored.baseUrl && !stored.model)) {
		return BUILTIN_LLM_CONFIG
	}
	return stored
}

export async function setLLMConfig(config: LLMSettings): Promise<void> {
	await chrome.storage.local.set({ [STORAGE_KEYS.llmConfig]: config })
}

export async function getLanguage(): Promise<'en' | 'zh'> {
	const result = await chrome.storage.local.get(STORAGE_KEYS.language)
	return (result[STORAGE_KEYS.language] as 'en' | 'zh') ?? 'en'
}

export async function setLanguage(lang: 'en' | 'zh'): Promise<void> {
	await chrome.storage.local.set({ [STORAGE_KEYS.language]: lang })
}

export async function getAutoRewrite(): Promise<boolean> {
	const result = await chrome.storage.local.get(STORAGE_KEYS.autoRewrite)
	return (result[STORAGE_KEYS.autoRewrite] as boolean) ?? true
}

export async function setAutoRewrite(value: boolean): Promise<void> {
	await chrome.storage.local.set({ [STORAGE_KEYS.autoRewrite]: value })
}

export async function getFloatButtonEnabled(): Promise<boolean> {
	const result = await chrome.storage.local.get(STORAGE_KEYS.floatButtonEnabled)
	return (result[STORAGE_KEYS.floatButtonEnabled] as boolean) ?? true
}

export async function setFloatButtonEnabled(value: boolean): Promise<void> {
	await chrome.storage.local.set({ [STORAGE_KEYS.floatButtonEnabled]: value })
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

export async function getExtSettings(): Promise<ExtSettings> {
	const [llm, language, autoRewriteDesc] = await Promise.all([
		getLLMConfig(),
		getLanguage(),
		getAutoRewrite(),
	])
	return { llm, language, autoRewriteDesc }
}
