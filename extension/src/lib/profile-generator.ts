import type { LLMSettings, ProductProfile } from './types'
import { getLLMConfig } from './storage'

export type GeneratedProfile = Omit<ProductProfile, 'id' | 'createdAt' | 'updatedAt' | 'screenshots' | 'founderName' | 'founderEmail' | 'socialLinks' | 'logoSquare' | 'logoBanner'>

const SYSTEM_PROMPT = `You are a product analyst. Given a product URL, generate a structured profile for directory submission.

Return ONLY valid JSON with these exact fields:
{
  "name": "Product Name",
  "url": "the canonical product URL",
  "tagline": "One concise sentence describing the product",
  "shortDesc": "A 40-60 word description suitable for directory listings",
  "longDesc": "A 120-180 word detailed description covering what the product does, who it's for, and key benefits",
  "categories": ["Category1", "Category2", "Category3"]
}

Rules:
- name: The official product/brand name
- tagline: Max one sentence, punchy and clear
- shortDesc: Written for SEO-friendly directory listings, natural tone
- longDesc: Detailed but not salesy, covers features, target audience, and value proposition
- categories: 2-5 relevant categories (e.g. "AI", "Productivity", "Developer Tools", "SaaS", "Marketing")
- All text in English
- Return ONLY the JSON object, no markdown fences, no explanation`

export async function generateProfile(
	url: string,
	signal?: AbortSignal,
	llmConfig?: LLMSettings,
): Promise<GeneratedProfile> {
	const config = llmConfig ?? await getLLMConfig()

	if (!config.baseUrl) {
		throw new Error('LLM not configured. Please set up your LLM in Settings.')
	}

	const baseUrl = config.baseUrl.replace(/\/+$/, '')
	const endpoint = `${baseUrl}/chat/completions`

	const response = await fetch(endpoint, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
		},
		body: JSON.stringify({
			model: config.model,
			messages: [
				{ role: 'system', content: SYSTEM_PROMPT },
				{ role: 'user', content: `Analyze this product and generate a profile:\n\nURL: ${url}` },
			],
			temperature: 0.7,
		}),
		signal,
	})

	if (!response.ok) {
		const text = await response.text().catch(() => '')
		throw new Error(`LLM request failed (${response.status}): ${text.slice(0, 200)}`)
	}

	const data = await response.json()
	const content: string = data.choices?.[0]?.message?.content ?? ''

	const parsed = parseJsonResponse(content)

	return {
		name: parsed.name || '',
		url: parsed.url || url,
		tagline: parsed.tagline || '',
		shortDesc: parsed.shortDesc || '',
		longDesc: parsed.longDesc || '',
		categories: Array.isArray(parsed.categories) ? parsed.categories : [],
	}
}

function parseJsonResponse(content: string): Record<string, unknown> {
	let cleaned = content.trim()

	const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/)
	if (fenceMatch) {
		cleaned = fenceMatch[1].trim()
	}

	try {
		return JSON.parse(cleaned)
	} catch {
		const objectMatch = cleaned.match(/\{[\s\S]*\}/)
		if (objectMatch) {
			return JSON.parse(objectMatch[0])
		}
		throw new Error('Failed to parse LLM response as JSON')
	}
}
