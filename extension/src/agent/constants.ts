import type { LLMSettings } from '@/lib/types'

declare const __DEFAULT_LLM_BASE_URL__: string
declare const __DEFAULT_LLM_API_KEY_OBF__: string
declare const __DEFAULT_LLM_MODEL__: string

function deobfuscate(encoded: string): string {
	if (!encoded) return ''
	try {
		const raw = atob(encoded)
		const k = 0x5a
		return Array.from(raw, (c) => String.fromCharCode(c.charCodeAt(0) ^ k)).join('')
	} catch {
		return encoded
	}
}

export const BUILTIN_LLM_CONFIG: LLMSettings = {
	apiKey: deobfuscate(__DEFAULT_LLM_API_KEY_OBF__),
	baseUrl: __DEFAULT_LLM_BASE_URL__,
	model: __DEFAULT_LLM_MODEL__,
}

export const DEFAULT_LLM_CONFIG: LLMSettings = {
	apiKey: '',
	baseUrl: '',
	model: '',
}

export function isLLMConfigured(config: LLMSettings): boolean {
	return !!config.baseUrl && !!config.model
}

export function isUsingBuiltinLLM(config: LLMSettings): boolean {
	return config.baseUrl === BUILTIN_LLM_CONFIG.baseUrl && config.model === BUILTIN_LLM_CONFIG.model
}
