import type { LLMSettings } from './types'
import {
	DEFAULT_COPY_CHAR_LIMITS,
	isDescriptionCharLimit,
	isIntroCharLimit,
	type CopyCharLimits,
} from './copy-limits'

/** 内置 LLM 供应商：端点与模型固定，仅 API Key 可配置（见 GLOSSARY.md「LLM 供应商」） */
export const LLM_PROVIDERS = {
	deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash' },
	hy: { label: 'HY', baseUrl: 'https://tokenhub.tencentmaas.com/v1', model: 'hy4-flash' },
} as const

export type LLMProviderId = keyof typeof LLM_PROVIDERS

export const DEFAULT_LLM_PROVIDER: LLMProviderId = 'deepseek'

const STORAGE_KEYS = {
	llmProvider: 'submitAgent_llmProvider',
	activeProductId: 'submitAgent_activeProductId',
	introCharLimit: 'submitAgent_introCharLimit',
	descriptionCharLimit: 'submitAgent_descriptionCharLimit',
	apiKeyByProvider: {
		deepseek: 'submitAgent_deepseekApiKey',
		hy: 'submitAgent_hyApiKey',
	} as Record<LLMProviderId, string>,
} as const

function isProviderId(value: unknown): value is LLMProviderId {
	return typeof value === 'string' && value in LLM_PROVIDERS
}

export async function getActiveProvider(): Promise<LLMProviderId> {
	const result = await chrome.storage.local.get(STORAGE_KEYS.llmProvider)
	const stored = result[STORAGE_KEYS.llmProvider]
	// 正常写入必经 isProviderId 校验；回退仅兜底外部手工改坏存储的场景
	return isProviderId(stored) ? stored : DEFAULT_LLM_PROVIDER
}

/** 切换即启用：产品分析与文案生成走当前供应商 */
export async function setActiveProvider(provider: LLMProviderId): Promise<void> {
	await chrome.storage.local.set({ [STORAGE_KEYS.llmProvider]: provider })
}

export async function getLLMApiKey(provider: LLMProviderId): Promise<string> {
	const key = STORAGE_KEYS.apiKeyByProvider[provider]
	const result = await chrome.storage.local.get(key)
	return (result[key] as string) ?? ''
}

export async function setLLMApiKey(provider: LLMProviderId, apiKey: string): Promise<void> {
	const key = STORAGE_KEYS.apiKeyByProvider[provider]
	await chrome.storage.local.set({ [key]: apiKey })
}

/** 组装当前启用供应商的完整调用配置 */
export async function getActiveLLMConfig(): Promise<LLMSettings> {
	const provider = await getActiveProvider()
	const apiKey = await getLLMApiKey(provider)
	return { apiKey, baseUrl: LLM_PROVIDERS[provider].baseUrl, model: LLM_PROVIDERS[provider].model }
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

/** 文案字数软限制档位（不在预设清单内的存储值回退默认） */
export async function getCopyCharLimits(): Promise<CopyCharLimits> {
	const result = await chrome.storage.local.get([STORAGE_KEYS.introCharLimit, STORAGE_KEYS.descriptionCharLimit])
	const intro = result[STORAGE_KEYS.introCharLimit]
	const description = result[STORAGE_KEYS.descriptionCharLimit]
	return {
		maxIntroChars: isIntroCharLimit(intro) ? intro : DEFAULT_COPY_CHAR_LIMITS.maxIntroChars,
		maxDescriptionChars: isDescriptionCharLimit(description)
			? description
			: DEFAULT_COPY_CHAR_LIMITS.maxDescriptionChars,
	}
}

export async function setCopyCharLimits(limits: CopyCharLimits): Promise<void> {
	await chrome.storage.local.set({
		[STORAGE_KEYS.introCharLimit]: limits.maxIntroChars,
		[STORAGE_KEYS.descriptionCharLimit]: limits.maxDescriptionChars,
	})
}
