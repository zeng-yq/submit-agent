import { buildCopyGenerationPrompt } from './prompts'
import { callLLM, parseLLMJson } from './llm-utils'
import { validateProductLinks } from './copy-validator'
import { DEFAULT_COPY_CHAR_LIMITS, type CopyCharLimits } from './copy-limits'
import type { LLMSettings, Product } from './types'

export interface GeneratedCopy {
	intro: string
	description: string
}

export interface GenerateCopyDeps {
	callLLM: (options: { systemPrompt: string; userPrompt: string }) => Promise<string>
	generateSeed?: () => string
	/** 字数软限制（注入提示词约束 LLM，超出不报错）；默认 300/1000 */
	limits?: CopyCharLimits
}

const MAX_ATTEMPTS = 2

/**
 * 文案生成管线（测试接缝）：随机种子提示词（含字数软限制） → 一次 LLM 调用 → JSON 解析
 * → 链接数硬校验（1~3 个产品域名链接） → 违规自动重试一次。
 */
export async function generateCopy(product: Product, deps: GenerateCopyDeps): Promise<GeneratedCopy> {
	if (!product.analysis) {
		throw new Error(`产品 ${product.domain} 还没有产品分析，请删除后重新添加该产品`)
	}
	const generateSeed = deps.generateSeed ?? defaultSeed
	const limits = deps.limits ?? DEFAULT_COPY_CHAR_LIMITS

	const violationsByAttempt: string[][] = []
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		const { systemPrompt, userPrompt } = buildCopyGenerationPrompt({
			productName: product.name,
			domain: product.domain,
			url: product.url,
			analysis: product.analysis,
			seed: generateSeed(),
			maxIntroChars: limits.maxIntroChars,
			maxDescriptionChars: limits.maxDescriptionChars,
		})

		const raw = await deps.callLLM({ systemPrompt, userPrompt })
		const { intro, description } = parseCopyResponse(raw)

		const violations = validateProductLinks(description, product.domain)
		if (violations.length === 0) {
			return { intro, description }
		}
		violationsByAttempt.push(violations)
	}

	const violationSummary = violationsByAttempt
		.map((violations, index) => `第 ${index + 1} 次: ${violations.join('；')}`)
		.join('；')
	throw new Error(`生成文案不符合要求（已自动重试一次）: ${violationSummary}`)
}

/** 生成文案的 LLM 调用策略：temperature 1.0 + JSON 模式（多样性靠随机种子 + 高温度） */
export function createCopyLLMCaller(config: LLMSettings) {
	return (options: { systemPrompt: string; userPrompt: string }) =>
		callLLM({ ...options, config, temperature: 1.0, jsonMode: true })
}

function parseCopyResponse(raw: string): { intro: string; description: string } {
	const parsed = parseLLMJson(raw) as Record<string, unknown>
	if (typeof parsed.intro !== 'string') {
		throw new Error(`LLM 返回缺少 intro 字段: ${raw.slice(0, 200)}`)
	}
	if (typeof parsed.description !== 'string') {
		throw new Error(`LLM 返回缺少 description 字段: ${raw.slice(0, 200)}`)
	}
	return { intro: parsed.intro, description: parsed.description }
}

function defaultSeed(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16))
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
