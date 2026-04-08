import type { LLMSettings } from './types'
import { getLLMConfig } from './storage'

export interface AnalysisResult {
	isBlog: boolean
	canComment: boolean
	summary: string
}

export type AnalysisStep = 'loading' | 'analyzing' | 'done'

const SYSTEM_PROMPT = `You are a Backlink Analyzer. You will receive the HTML source of a webpage along with detected form elements. Determine:

1. Is this a blog page? (A blog post, article, or similar content page — NOT a directory, forum, homepage, or navigation page)
2. Can you submit a comment on this page? (Look for comment forms, reply boxes, especially ones with URL/Website fields)

Return ONLY valid JSON:
{
  "isBlog": true/false,
  "canComment": true/false,
  "summary": "brief explanation in Chinese (1-2 sentences)"
}

Rules:
- isBlog: true only if the page is a blog post or article with editorial content
- canComment: true if there is a visible comment/reply form that allows posting (ideally with a URL field)
- summary: MUST be written in Chinese (简体中文), concise description of the analysis result
- Return ONLY the JSON object, no markdown fences`

function parseJsonResponse(text: string): AnalysisResult {
	let cleaned = text.trim()
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
		throw new Error('Failed to parse analysis result from LLM response')
	}
}

/** Strip HTML to plain text for LLM consumption */
function htmlToText(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, '')
		.replace(/<style[\s\S]*?<\/style>/gi, '')
		.replace(/<nav[\s\S]*?<\/nav>/gi, '')
		.replace(/<footer[\s\S]*?<\/footer>/gi, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#\d+;/g, '')
		.replace(/\s+/g, ' ')
		.trim()
}

/** Extract <title> from HTML */
function extractTitle(html: string): string {
	const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
	return match ? match[1].trim() : ''
}

/** Detect comment form elements in raw HTML */
function detectCommentSignals(html: string): { found: boolean; details: string } {
	const signals: string[] = []

	// Common comment form patterns
	if (/<textarea[^>]*>/i.test(html)) {
		// Check if textarea is near comment-related context
		const textareaCtx = html.match(/.{0,80}<textarea[\s\S]{0,200}/gi)
		if (textareaCtx) {
			const first = textareaCtx[0].toLowerCase()
			if (first.includes('comment') || first.includes('reply') || first.includes('message') || first.includes('respond')) {
				signals.push('textarea with comment context')
			} else {
				signals.push('textarea element found')
			}
		} else {
			signals.push('textarea element found')
		}
	}

	if (/id\s*=\s*["'][^"']*(?:respond|comment-?form|commentform|replytocom)/i.test(html)) {
		signals.push('comment form container (id)')
	}
	if (/class\s*=\s*["'][^"']*(?:comment-?form|comment-?respond|comments-?area|reply-?form)/i.test(html)) {
		signals.push('comment form container (class)')
	}
	if (/<input[^>]*name\s*=\s*["'](?:url|website|site)/i.test(html)) {
		signals.push('URL/Website input field')
	}
	if (/id\s*=\s*["']comments["']/i.test(html) || /class\s*=\s*["'][^"']*comments[\s"']/i.test(html)) {
		signals.push('comments section')
	}

	return {
		found: signals.length > 0,
		details: signals.join('; '),
	}
}

export async function analyzeBacklink(
	url: string,
	signal?: AbortSignal,
	onProgress?: (step: AnalysisStep) => void,
): Promise<AnalysisResult> {
	const config: LLMSettings = await getLLMConfig()
	if (!config.baseUrl) throw new Error('LLM 未配置，请在设置中填写 Base URL')
	if (!config.model) throw new Error('模型未配置，请在设置中填写模型名称')

	// Step 1: Fetch page HTML via background service worker
	onProgress?.('loading')
	const fetchResponse = await chrome.runtime.sendMessage({
		type: 'FETCH_PAGE_CONTENT',
		url,
	})

	if (!fetchResponse?.ok || !fetchResponse.html) {
		throw new Error(fetchResponse?.error || `无法获取页面内容: ${url}`)
	}

	const html: string = fetchResponse.html

	// Step 2: Extract content from HTML
	const title = extractTitle(html)
	const textContent = htmlToText(html)
	const commentSignals = detectCommentSignals(html)

	if (textContent.length < 50) {
		return { isBlog: false, canComment: false, summary: '页面内容为空或过短，无法分析。' }
	}

	// Step 3: Build prompt content
	const truncated = textContent.length > 8000 ? textContent.slice(0, 8000) + '\n...[truncated]' : textContent

	const pageContent = [
		`URL: ${url}`,
		title ? `Title: ${title}` : '',
		`Comment form detection: ${commentSignals.found ? `YES (${commentSignals.details})` : 'No comment form elements detected'}`,
		`Page text content:\n${truncated}`,
	].filter(Boolean).join('\n\n')

	// Step 4: LLM analysis
	onProgress?.('analyzing')
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
				{ role: 'user', content: `Analyze this webpage for backlink opportunities:\n\n${pageContent}` },
			],
			temperature: 0.3,
			max_tokens: 512,
		}),
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

	onProgress?.('done')
	return parseJsonResponse(content)
}
