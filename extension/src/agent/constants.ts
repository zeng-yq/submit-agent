import type { LLMSettings } from '@/lib/types'

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
