/**
 * LLM calling and response parsing utilities.
 * Single LLM call pattern with JSON mode and regex fallback.
 */

import type { LLMSettings } from '@/lib/types'

const LLM_TIMEOUT_MS = 60_000

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
 * Includes a 60-second automatic timeout (combined with any external AbortSignal).
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

	// Combine external signal with automatic timeout
	const timeoutController = new AbortController()
	const timeoutId = setTimeout(() => timeoutController.abort(), LLM_TIMEOUT_MS)

	const combinedSignal = signal
		? AbortSignal.any([signal, timeoutController.signal])
		: timeoutController.signal

	let response: Response
	try {
		response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
			},
			body: JSON.stringify(body),
			signal: combinedSignal,
		})
	} finally {
		clearTimeout(timeoutId)
	}

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
 * Remove trailing commas before } or ] — common LLM output issue.
 * e.g. {"field_0": "value",} → {"field_0": "value"}
 */
function removeTrailingCommas(json: string): string {
	return json.replace(/,\s*([}\]])/g, '$1')
}

/**
 * Parse JSON from LLM response text.
 * Handles markdown fences, trailing commas, unquoted keys, and extracts first JSON object.
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

	// Try fixing trailing commas + unquoted keys (common LLM output issues)
	try {
		return JSON.parse(fixUnquotedKeys(removeTrailingCommas(objectMatch[0])))
	} catch {
		// Last resort: try the original extracted block as-is
		try {
			return JSON.parse(objectMatch[0])
		} catch {
			throw new Error(`无法从 LLM 响应中解析 JSON: ${raw.slice(0, 200)}`)
		}
	}
}
