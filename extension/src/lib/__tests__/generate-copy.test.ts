import 'fake-indexeddb/auto'
import { describe, it, expect, vi } from 'vitest'
import { generateCopy } from '@/lib/generate-copy'
import { saveProduct } from '@/lib/db'
import type { Product } from '@/lib/types'

function makeProduct(overrides: Partial<Product> = {}): Product {
	return {
		id: 'product-copy-1',
		domain: 'example.com',
		name: 'ExampleFlow',
		url: 'https://example.com',
		email: 'support@example.com',
		analysis: 'ExampleFlow is a workflow automation tool for small teams. Key features: visual builder, 60+ integrations, usage analytics.',
		createdAt: 1_700_000_000_000,
		updatedAt: 1_700_000_000_000,
		...overrides,
	}
}

const VALID_COPY_JSON = JSON.stringify({
	intro: 'ExampleFlow helps small teams automate repetitive work without code.',
	description:
		'ExampleFlow is a [workflow automation](https://example.com) tool built for small teams. You connect your apps, drop in steps, and let it run. The visual builder is easy to pick up. It ships with [60+ integrations](https://example.com/integrations) so most setups need no code. Usage analytics show what actually saves time.',
})

function llmReturning(...payloads: string[]) {
	const fn = vi.fn()
	payloads.forEach((payload) => fn.mockResolvedValueOnce(payload))
	return fn
}

describe('generateCopy · happy path', () => {
	it('一次调用产出简介与详述，提示词含随机种子行、产品分析与域名', async () => {
		const product = makeProduct()
		const callLLM = llmReturning(VALID_COPY_JSON)

		const copy = await generateCopy(product, { callLLM, generateSeed: () => 'a1b2c3d4e5f6' })

		expect(copy.intro).toBe('ExampleFlow helps small teams automate repetitive work without code.')
		expect(copy.description).toContain('[workflow automation](https://example.com)')

		const { systemPrompt, userPrompt } = callLLM.mock.calls[0][0]
		expect(userPrompt.startsWith('Session seed: a1b2c3d4e5f6')).toBe(true)
		expect(userPrompt).toContain('example.com')
		expect(userPrompt).toContain('workflow automation tool')
		// 内置写作指令齐备：英文/短句/禁破折号/自然锚文本/长度上限
		expect(systemPrompt).toContain('English only')
		expect(systemPrompt).toContain('short sentences')
		expect(systemPrompt).toContain('em dashes or en dashes')
		expect(systemPrompt).toContain('never "click here"')
		expect(systemPrompt).toContain('at most 300 characters')
		expect(systemPrompt).toContain('at most 1000 characters')
		expect(callLLM).toHaveBeenCalledTimes(1)
	})

	it('LLM 返回 markdown 围栏包裹的 JSON 也能解析', async () => {
		const callLLM = llmReturning('```json\n' + VALID_COPY_JSON + '\n```')
		const copy = await generateCopy(makeProduct(), { callLLM, generateSeed: () => 'seed-1' })
		expect(copy.intro).toContain('ExampleFlow helps')
	})
})

describe('generateCopy · 守卫', () => {
	it('产品无产品分析：抛出引导重新添加的错误', async () => {
		const product = makeProduct({ analysis: undefined })
		const callLLM = llmReturning(VALID_COPY_JSON)

		await expect(generateCopy(product, { callLLM, generateSeed: () => 's' })).rejects.toThrow(
			'产品 example.com 还没有产品分析，请删除后重新添加该产品',
		)
		expect(callLLM).not.toHaveBeenCalled()
	})

	it('LLM 返回缺字段 JSON：报错含响应片段', async () => {
		const callLLM = llmReturning('{"intro": "only intro"}')
		await expect(
			generateCopy(makeProduct(), { callLLM, generateSeed: () => 's' }),
		).rejects.toThrow(/缺少 description 字段/)
	})
})

describe('generateCopy · 校验与自动重试', () => {
	it('简介超长：自动重试一次，第二次有效则返回，且两次种子不同', async () => {
		const longIntro = 'a'.repeat(301)
		const callLLM = llmReturning(
			JSON.stringify({ intro: longIntro, description: JSON.parse(VALID_COPY_JSON).description }),
			VALID_COPY_JSON,
		)
		const seeds = ['seed-first', 'seed-second']
		const generateSeed = () => seeds.shift() ?? 'seed-overflow'

		const copy = await generateCopy(makeProduct(), { callLLM, generateSeed })

		expect(copy.intro).toBe(JSON.parse(VALID_COPY_JSON).intro)
		expect(callLLM).toHaveBeenCalledTimes(2)
		expect(callLLM.mock.calls[0][0].userPrompt).toContain('seed-first')
		expect(callLLM.mock.calls[1][0].userPrompt).toContain('seed-second')
	})

	it('两次都越界：报错含越界具体值', async () => {
		const longIntro = 'a'.repeat(312)
		const callLLM = llmReturning(
			JSON.stringify({ intro: longIntro, description: JSON.parse(VALID_COPY_JSON).description }),
			JSON.stringify({ intro: 'b'.repeat(305), description: JSON.parse(VALID_COPY_JSON).description }),
		)

		await expect(generateCopy(makeProduct(), { callLLM, generateSeed: () => 's' })).rejects.toThrow(
			/简介 305 字符，超过上限 300/,
		)
	})

	it('详述缺产品域名链接（0 个）：视为越界并重试', async () => {
		const noLinkDescription = 'ExampleFlow is a tool. It helps teams. No links here at all.'
		const callLLM = llmReturning(
			JSON.stringify({ intro: 'ExampleFlow helps small teams automate work.', description: noLinkDescription }),
			VALID_COPY_JSON,
		)

		const copy = await generateCopy(makeProduct(), { callLLM, generateSeed: () => 's' })
		expect(copy.description).toContain('](https://example.com')
		expect(callLLM).toHaveBeenCalledTimes(2)
	})

	it('详述产品域名链接超过 3 个：视为越界', async () => {
		const fourLinks = [
			'[a](https://example.com/a)',
			'[b](https://example.com/b)',
			'[c](https://example.com/c)',
			'[d](https://example.com/d)',
		].join(' ')
		const callLLM = llmReturning(
			JSON.stringify({ intro: 'ExampleFlow helps small teams automate work.', description: fourLinks }),
			VALID_COPY_JSON,
		)

		await generateCopy(makeProduct(), { callLLM, generateSeed: () => 's' })
		expect(callLLM).toHaveBeenCalledTimes(2)
	})

	it('指向他域的链接不计入；子域名计入', async () => {
		const mixedLinks =
			'See [docs](https://docs.example.com/guide) and [blog](https://other-site.org/post). Built by [us](https://example.com).'
		const callLLM = llmReturning(
			JSON.stringify({ intro: 'ExampleFlow helps small teams automate work.', description: mixedLinks }),
			VALID_COPY_JSON,
		)

		await generateCopy(makeProduct(), { callLLM, generateSeed: () => 's' })
		expect(callLLM).toHaveBeenCalledTimes(1)
	})

	it('详述超长（>1000 字符）：报错含长度值', async () => {
		const longDescription =
			'ExampleFlow is a [tool](https://example.com). ' + 'x'.repeat(1001)
		const callLLM = llmReturning(
			JSON.stringify({ intro: 'ExampleFlow helps small teams automate work.', description: longDescription }),
			JSON.stringify({ intro: 'ExampleFlow helps small teams automate work.', description: longDescription }),
		)

		await expect(generateCopy(makeProduct(), { callLLM, generateSeed: () => 's' })).rejects.toThrow(
			/详述 \d+ 字符，超过上限 1000/,
		)
	})
})
