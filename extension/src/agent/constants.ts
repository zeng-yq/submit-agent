import type { LLMSettings } from '@/lib/types'

export function isLLMConfigured(config: LLMSettings): boolean {
	return !!config.baseUrl && !!config.model
}
