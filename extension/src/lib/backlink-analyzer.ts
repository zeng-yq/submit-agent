import type { LLMSettings } from './types'
import type { BacklinkAnalysisResult } from './types'
import type { FormAnalysisResult } from '@/agent/FormAnalyzer'
import type { PageContent } from '@/agent/PageContentExtractor'
import type { LogEntry, LogLevel } from '@/agent/types'
import { getLLMConfig } from './storage'
import { callLLM, parseLLMJson } from '@/agent/llm-utils'
import { buildFieldList } from '@/agent/FormAnalyzer'

export type AnalysisStep = 'loading' | 'analyzing' | 'done'

const SYSTEM_PROMPT = `You are a Backlink Analyzer. You receive structured form analysis data from a webpage. Determine if this page is suitable for posting a comment with a backlink.

Return ONLY valid JSON:
{
  "canComment": true/false,
  "summary": "简短结论，不超过15个汉字",
  "formType": "blog_comment" | "directory" | "contact_form" | "forum" | "none",
  "cmsType": "wordpress" | "blogger" | "discuz" | "custom" | "unknown",
  "detectedFields": ["field_name_1", "field_name_2"],
  "confidence": 0.0-1.0
}

Rules:
- canComment: true if there is a comment/reply form with fields like name, email, URL/website, and a textarea for the comment body. The form must allow user submission.
- formType: classify the primary form found on the page
- cmsType: detect the CMS from HTML patterns (wp-content/wp-includes = wordpress, blogger.com = blogger, wpdiscuz = discuz, etc.)
- detectedFields: list the inferred purposes of detected fields (e.g. "name", "email", "url", "comment", "website")
- confidence: your confidence in the canComment judgment (0.0 = pure guess, 1.0 = absolutely certain)
- summary: MUST be in Chinese (简体中文), ultra-short conclusion within 15 characters
- Return ONLY the JSON object, no markdown fences`

export interface AnalyzeBacklinkOptions {
  url: string
  signal?: AbortSignal
  onProgress?: (step: AnalysisStep) => void
  onLog?: (entry: LogEntry) => void
}

export async function analyzeBacklink(
  options: AnalyzeBacklinkOptions
): Promise<BacklinkAnalysisResult> {
  const { url, signal, onProgress, onLog } = options
  let logId = 0
  const log = (level: LogLevel, phase: LogEntry['phase'], message: string, data?: unknown) => {
    onLog?.({ id: ++logId, timestamp: Date.now(), level, phase, message, data })
  }

  const config: LLMSettings = await getLLMConfig()
  if (!config.baseUrl) throw new Error('LLM 未配置，请在设置中填写 Base URL')
  if (!config.model) throw new Error('模型未配置，请在设置中填写模型名称')

  // Step 1: Fetch form analysis via background service worker
  onProgress?.('loading')
  log('info', 'analyze', '正在获取页面内容...')

  const fetchResponse = await chrome.runtime.sendMessage({
    type: 'FETCH_PAGE_CONTENT',
    url,
  })

  if (!fetchResponse?.ok) {
    throw new Error(fetchResponse?.error || `无法获取页面内容: ${url}`)
  }

  const analysis: FormAnalysisResult = fetchResponse.analysis
  const pageContent: PageContent | undefined = fetchResponse.pageContent

  const unfilteredForms = analysis.forms.filter(f => !f.filtered)
  const commentFields = analysis.fields.filter(f => {
    const p = (f.inferred_purpose || f.label || f.name || '').toLowerCase()
    return p.includes('comment') || p.includes('message') || p.includes('reply')
      || p.includes('url') || p.includes('website') || p.includes('site')
  })

  log('info', 'analyze', `表单分析完成 — 发现 ${unfilteredForms.length} 个表单, ${analysis.fields.length} 个字段`, {
    forms: unfilteredForms.length,
    fields: analysis.fields.length,
    commentFields: commentFields.length,
  })

  if (commentFields.length > 0) {
    const cmsGuess = analysis.page_info.title?.toLowerCase().includes('wordpress')
      || (analysis.forms.some(f => f.form_action?.includes('wp-comments-post')))
      ? 'WordPress' : 'unknown'
    log('success', 'analyze', `检测到评论相关字段 (${cmsGuess})`, {
      fields: commentFields.map(f => f.inferred_purpose || f.label || f.name),
    })
  } else if (analysis.fields.length === 0) {
    log('warning', 'analyze', '未发现任何表单字段')
  } else {
    log('warning', 'analyze', '未发现评论相关字段')
  }

  // Step 2: Build prompt and call LLM
  onProgress?.('analyzing')
  log('info', 'llm', '正在分析页面适配性...')

  const fieldList = buildFieldList(analysis.fields, analysis.forms)
  const pageSection = pageContent
    ? [
        `**Title:** ${pageContent.title}`,
        pageContent.description ? `**Description:** ${pageContent.description}` : '',
        pageContent.headings.length > 0 ? `**Headings:**\n${pageContent.headings.slice(0, 10).join('\n')}` : '',
        '**Content Preview:**',
        pageContent.content_preview.slice(0, 2000),
      ].filter(Boolean).join('\n')
    : `**Title:** ${analysis.page_info.title}`

  const userPrompt = [
    `URL: ${url}`,
    '',
    '## Page Content',
    pageSection,
    '',
    '## Detected Form Fields',
    fieldList,
    '',
    'Analyze this page for backlink opportunities. Can we submit a comment with a URL field?',
  ].join('\n')

  const rawResponse = await callLLM({
    config,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    temperature: 0.3,
    maxTokens: 512,
    signal,
  })

  const parsed = parseLLMJson(rawResponse) as BacklinkAnalysisResult

  // Validate required fields with defaults
  const result: BacklinkAnalysisResult = {
    canComment: !!parsed.canComment,
    summary: parsed.summary || (parsed.canComment ? '可评论' : '不可评论'),
    formType: parsed.formType || 'none',
    cmsType: parsed.cmsType || 'unknown',
    detectedFields: Array.isArray(parsed.detectedFields) ? parsed.detectedFields : [],
    confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
  }

  const level = result.canComment ? 'success' : 'warning'
  log(level, 'llm', `LLM 判定: ${result.canComment ? '可发布' : '不可发布'} (信心度: ${(result.confidence * 100).toFixed(0)}%)`, result)

  onProgress?.('done')
  return result
}
