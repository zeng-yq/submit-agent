import type { LLMSettings } from '@/lib/types'

declare const __DEFAULT_LLM_BASE_URL__: string
declare const __DEFAULT_LLM_API_KEY__: string
declare const __DEFAULT_LLM_MODEL__: string

export const BUILTIN_LLM_CONFIG: LLMSettings = {
	apiKey: __DEFAULT_LLM_API_KEY__,
	baseUrl: __DEFAULT_LLM_BASE_URL__,
	model: __DEFAULT_LLM_MODEL__,
}

export const DEFAULT_LLM_CONFIG: LLMSettings = {
	apiKey: '',
	baseUrl: '',
	model: '',
}

/**
 * Check if the LLM is configured (has both baseUrl and model).
 */
export function isLLMConfigured(config: LLMSettings): boolean {
	return !!config.baseUrl && !!config.model
}

/** Returns true if config matches the built-in default (user hasn't customized it) */
export function isUsingBuiltinLLM(config: LLMSettings): boolean {
	return config.baseUrl === BUILTIN_LLM_CONFIG.baseUrl && config.model === BUILTIN_LLM_CONFIG.model
}
