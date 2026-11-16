import { describe, it, expect, vi, afterEach } from 'vitest'
import { callLLM, parseLLMJson } from '@/lib/llm-utils'

const okLlmResponse = {
	ok: true,
	status: 200,
	json: async () => ({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: {} }),
	text: async () => '',
}

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('callLLM · 思考模式禁用', () => {
	it('DeepSeek 端点 → 请求 body 附带 thinking disabled', async () => {
		const fetchMock = vi.fn().mockResolvedValue(okLlmResponse)
		vi.stubGlobal('fetch', fetchMock)

		await callLLM({
			config: { apiKey: 'k', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash' },
			systemPrompt: 's',
			userPrompt: 'u',
		})

		const body = JSON.parse(fetchMock.mock.calls[0][1].body)
		expect(body.thinking).toEqual({ type: 'disabled' })
	})

	it('HY（腾讯混元 TokenHub）端点 → 同样附带 thinking disabled', async () => {
		const fetchMock = vi.fn().mockResolvedValue(okLlmResponse)
		vi.stubGlobal('fetch', fetchMock)

		await callLLM({
			config: { apiKey: 'k', baseUrl: 'https://tokenhub.tencentmaas.com/v1', model: 'hy4-flash' },
			systemPrompt: 's',
			userPrompt: 'u',
		})

		const body = JSON.parse(fetchMock.mock.calls[0][1].body)
		expect(body.thinking).toEqual({ type: 'disabled' })
	})

	it('其他端点 → 不附带 thinking（避免未知参数 400）', async () => {
		const fetchMock = vi.fn().mockResolvedValue(okLlmResponse)
		vi.stubGlobal('fetch', fetchMock)

		await callLLM({
			config: { apiKey: 'k', baseUrl: 'https://openrouter.ai/api/v1', model: 'gpt-4o' },
			systemPrompt: 's',
			userPrompt: 'u',
		})

		const body = JSON.parse(fetchMock.mock.calls[0][1].body)
		expect(body.thinking).toBeUndefined()
	})
})

describe('parseLLMJson', () => {
	it('parses valid JSON', () => {
		const raw = '{"name": "Test", "value": 42}'
		const result = parseLLMJson(raw) as Record<string, unknown>
		expect(result.name).toBe('Test')
		expect(result.value).toBe(42)
	})

	it('parses JSON wrapped in markdown code fence', () => {
		const raw = '```json\n{"field_0": "hello", "field_1": "world"}\n```'
		const result = parseLLMJson(raw) as Record<string, unknown>
		expect(result.field_0).toBe('hello')
		expect(result.field_1).toBe('world')
	})

	it('parses JSON wrapped in plain code fence', () => {
		const raw = '```\n{"key": "value"}\n```'
		const result = parseLLMJson(raw) as Record<string, unknown>
		expect(result.key).toBe('value')
	})

	it('handles JSON with surrounding text by extracting first object', () => {
		const raw = 'Here is the result:\n{"name": "test", "count": 5}\nHope this helps!'
		const result = parseLLMJson(raw) as Record<string, unknown>
		expect(result.name).toBe('test')
		expect(result.count).toBe(5)
	})

	it('handles unquoted property names', () => {
		const raw = '{field_0: "hello", field_1: "world"}'
		const result = parseLLMJson(raw) as Record<string, unknown>
		expect(result.field_0).toBe('hello')
		expect(result.field_1).toBe('world')
	})

	it('handles unquoted keys inside code fence', () => {
		const raw = '```json\n{field_0: "value"}\n```'
		const result = parseLLMJson(raw) as Record<string, unknown>
		expect(result.field_0).toBe('value')
	})

	it('handles JSON with nested objects', () => {
		const raw = '{"outer": {"inner": "deep value"}, "top": "level"}'
		const result = parseLLMJson(raw) as Record<string, unknown>
		expect((result.outer as Record<string, unknown>).inner).toBe('deep value')
		expect(result.top).toBe('level')
	})

	it('handles JSON array values', () => {
		const raw = '{"tags": ["ai", "productivity"], "name": "Tool"}'
		const result = parseLLMJson(raw) as Record<string, unknown>
		expect(result.tags).toEqual(['ai', 'productivity'])
		expect(result.name).toBe('Tool')
	})

	it('throws for non-JSON text', () => {
		const raw = 'This is just plain text with no JSON at all.'
		expect(() => parseLLMJson(raw)).toThrow('无法从 LLM 响应中解析 JSON')
	})

	it('throws for empty string', () => {
		expect(() => parseLLMJson('')).toThrow('无法从 LLM 响应中解析 JSON')
	})

	it('handles real-world blog comment response', () => {
		const raw = `{
  "field_0": "Sarah Mitchell",
  "field_1": "founder@productai.com",
  "field_2": "https://productai.com",
  "field_3": "The latency benchmarks in your comparison are spot-on. For teams scaling inference, <a href=\\"https://productai.com\\">AI optimization tools</a> can cut cold-start latency significantly."
}`
		const result = parseLLMJson(raw) as Record<string, unknown>
		expect(result.field_0).toBe('Sarah Mitchell')
		expect(result.field_3).toContain('latency benchmarks')
		expect(result.field_3).toContain('<a href=')
	})

	it('handles JSON with whitespace and newlines', () => {
		const raw = '\n\n  {  "key"  :  "value"  }  \n\n'
		const result = parseLLMJson(raw) as Record<string, unknown>
		expect(result.key).toBe('value')
	})
})
