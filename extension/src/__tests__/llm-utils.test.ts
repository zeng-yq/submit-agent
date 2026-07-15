import { describe, it, expect } from 'vitest'
import { parseLLMJson, injectHrefNewline } from '@/agent/llm-utils'

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

describe('injectHrefNewline', () => {
	it('inserts a real newline before the closing quote of an href', () => {
		const input = '<a href="https://example.com/">点击这里</a>'
		const out = injectHrefNewline(input)
		expect(out).toBe('<a href="https://example.com/\n">点击这里</a>')
		// 必须是真实换行符，而非字面 \+n
		expect(out).toMatch(/\/\n">/)
		expect(out).not.toContain('\\n')
	})

	it('only inserts before the href closing quote, not other quotes', () => {
		const input = 'see <a href="https://productai.com">the tool</a> for more'
		const out = injectHrefNewline(input)
		expect(out).toBe('see <a href="https://productai.com\n">the tool</a> for more')
	})

	it('handles multiple links in one comment', () => {
		const input = '<a href="https://a.com">A</a> and <a href="https://b.com">B</a>'
		const out = injectHrefNewline(input)
		expect(out).toBe('<a href="https://a.com\n">A</a> and <a href="https://b.com\n">B</a>')
	})

	it('is idempotent — does not double-insert when a newline is already present', () => {
		const once = injectHrefNewline('<a href="https://example.com/">x</a>')
		const twice = injectHrefNewline(once)
		expect(twice).toBe(once)
		expect(twice.match(/\n/g)?.length).toBe(1)
	})

	it('returns non-string input unchanged', () => {
		expect(injectHrefNewline(undefined as unknown as string)).toBeUndefined()
		expect(injectHrefNewline(123 as unknown as string)).toBe(123)
	})

	it('returns strings without href= unchanged (e.g. directory submit values)', () => {
		const input = 'https://productai.com'
		expect(injectHrefNewline(input)).toBe(input)
	})
})
