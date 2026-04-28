import type { LLMSettings } from './types'

export type TestResult =
	| { ok: true }
	| { ok: false; code: 'unreachable' | 'unauthorized' | 'not_found' | 'model_not_found' | 'rate_limit' | 'server_error' | 'unknown'; detail?: string }

export async function testLLMConnection(config: LLMSettings): Promise<TestResult> {
	const baseUrl = config.baseUrl.replace(/\/+$/, '')
	const endpoint = `${baseUrl}/chat/completions`

	let response: Response
	try {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), 15_000)

		response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
			},
			body: JSON.stringify({
				model: config.model,
				messages: [{ role: 'user', content: 'Hi' }],
				max_tokens: 1,
			}),
			signal: controller.signal,
		})

		clearTimeout(timeout)
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		if (message.includes('abort') || message.includes('timeout')) {
			return { ok: false, code: 'unreachable', detail: 'Request timed out after 15 seconds' }
		}
		return { ok: false, code: 'unreachable', detail: message }
	}

	if (response.ok) {
		try {
			const data = await response.json()
			if (data.choices?.length > 0) {
				return { ok: true }
			}
			return { ok: true }
		} catch {
			return { ok: false, code: 'unknown', detail: 'Response was not valid JSON' }
		}
	}

	const errorBody = await response.text().catch(() => '')

	switch (response.status) {
		case 401:
		case 403:
			return { ok: false, code: 'unauthorized', detail: errorBody }
		case 404:
			return { ok: false, code: 'not_found', detail: errorBody }
		case 429:
			return { ok: false, code: 'rate_limit', detail: errorBody }
		case 502:
		case 503:
		case 504:
			return { ok: false, code: 'server_error', detail: errorBody }
		case 400: {
			const lower = errorBody.toLowerCase()
			if (lower.includes('model') && (lower.includes('not found') || lower.includes('not exist') || lower.includes('invalid'))) {
				return { ok: false, code: 'model_not_found', detail: errorBody }
			}
			return { ok: false, code: 'unknown', detail: `${response.status}: ${errorBody}` }
		}
		default:
			return { ok: false, code: 'unknown', detail: `${response.status}: ${errorBody}` }
	}
}
