/**
 * LLM calling and response parsing utilities.
 * Single LLM call pattern with JSON mode and regex fallback.
 */

import type { LLMSettings } from '@/lib/types'

export interface CallLLMOptions {
	config: LLMSettings
	systemPrompt: string
	userPrompt: string
	temperature?: number
	maxTokens?: number
	signal?: AbortSignal
	jsonMode?: boolean
}

/**
 * Call an OpenAI-compatible LLM endpoint.
 */
export async function callLLM(options: CallLLMOptions): Promise<string> {
	const {
		config,
		systemPrompt,
		userPrompt,
		temperature = 0.3,
		maxTokens = 2048,
		signal,
		jsonMode = false,
	} = options

	if (!config.baseUrl) throw new Error('LLM 未配置，请在设置中填写 Base URL')
	if (!config.model) throw new Error('模型未配置，请在设置中填写模型名称')

	const baseUrl = config.baseUrl.replace(/\/+$/, '')
	const endpoint = `${baseUrl}/chat/completions`

	const body: Record<string, unknown> = {
		model: config.model,
		messages: [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userPrompt },
		],
		temperature,
		max_tokens: maxTokens,
	}

	if (jsonMode) {
		body.response_format = { type: 'json_object' }
	}

	const response = await fetch(endpoint, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
		},
		body: JSON.stringify(body),
		signal,
	})

	if (!response.ok) {
		const errorText = await response.text().catch(() => '')
		if (response.status === 401 || response.status === 403) {
			throw new Error('API 认证失败，请检查设置中的 API Key')
		}
		if (response.status === 429) {
			throw new Error('API 请求频率超限，请稍后重试')
		}
		throw new Error(`API 错误 (${response.status}): ${errorText || '未知错误'}`)
	}

	const data = await response.json()
	const content = data.choices?.[0]?.message?.content
	if (!content) {
		throw new Error('LLM 返回了空响应')
	}

	return content
}

/**
 * Fix unquoted property names in JSON-like text.
 * e.g. {canComment: true} → {"canComment": true}
 */
function fixUnquotedKeys(json: string): string {
	return json.replace(
		/([{,]\s*)([a-zA-Z_$][\w$]*)\s*:/g,
		'$1"$2":',
	)
}

/**
 * Parse JSON from LLM response text.
 * Handles markdown fences, unquoted keys, and extracts first JSON object.
 */
export function parseLLMJson(raw: string): unknown {
	let cleaned = raw.trim()

	// Strip markdown code fences
	const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/)
	if (fenceMatch) {
		cleaned = fenceMatch[1].trim()
	}

	// Try direct parse
	try {
		return JSON.parse(cleaned)
	} catch {
		// noop, try fallbacks
	}

	// Try extracting first {...} block
	const objectMatch = cleaned.match(/\{[\s\S]*\}/)
	if (!objectMatch) {
		throw new Error(`无法从 LLM 响应中解析 JSON: ${raw.slice(0, 200)}`)
	}

	// Try fixing unquoted keys (common LLM output issue)
	try {
		return JSON.parse(fixUnquotedKeys(objectMatch[0]))
	} catch {
		// Last resort: try the original extracted block as-is
		try {
			return JSON.parse(objectMatch[0])
		} catch {
			throw new Error(`无法从 LLM 响应中解析 JSON: ${raw.slice(0, 200)}`)
		}
	}
}
