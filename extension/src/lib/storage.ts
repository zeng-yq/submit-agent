import type { ExtSettings, LLMSettings, ProviderConfigs, ProviderKey } from './types'

const STORAGE_KEYS = {
	llmConfig: 'submitAgent_llmConfig',
	providerConfigs: 'submitAgent_providerConfigs',
	autoRewrite: 'submitAgent_autoRewrite',
	activeProductId: 'submitAgent_activeProductId',
	floatButtonEnabled: 'submitAgent_floatButtonEnabled',
} as const

const EMPTY_LLM: LLMSettings = { apiKey: '', baseUrl: '', model: '' }

function defaultProviderConfigs(): ProviderConfigs {
	return {
		active: 'openrouter',
		configs: {
			openrouter: { apiKey: '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', baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemini-2.0-flash-lite-001' },
			openai: { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
			deepseek: { apiKey: '', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
			custom: { ...EMPTY_LLM },
		},
	}
}

export async function getProviderConfigs(): Promise<ProviderConfigs> {
	const result = await chrome.storage.local.get(STORAGE_KEYS.providerConfigs)
	const stored = result[STORAGE_KEYS.providerConfigs] as ProviderConfigs | undefined
	if (stored?.active && stored?.configs) return stored
	return defaultProviderConfigs()
}

export async function setProviderConfigs(configs: ProviderConfigs): Promise<void> {
	await chrome.storage.local.set({ [STORAGE_KEYS.providerConfigs]: configs })
}

/** Resolves the active provider config into a single LLMSettings for the agent to use */
export async function getLLMConfig(): Promise<LLMSettings> {
	const pc = await getProviderConfigs()
	const cfg = pc.configs[pc.active]
	if (!cfg || (!cfg.baseUrl && !cfg.model)) {
		return defaultProviderConfigs().configs.openrouter
	}
	return cfg
}

export async function setLLMConfig(config: LLMSettings): Promise<void> {
	await chrome.storage.local.set({ [STORAGE_KEYS.llmConfig]: config })
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
	const [llm, autoRewriteDesc] = await Promise.all([
		getLLMConfig(),
		getAutoRewrite(),
	])
	return { llm, autoRewriteDesc }
}
