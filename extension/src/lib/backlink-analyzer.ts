import type { BacklinkAnalysisResult } from './types'
import type { FormAnalysisResult, FormField, FormGroup } from '@/agent/FormAnalyzer'
import type { LogEntry, LogLevel } from '@/agent/types'

export type AnalysisStep = 'loading' | 'analyzing' | 'done'

export interface AnalyzeBacklinkOptions {
  url: string
  signal?: AbortSignal
  onProgress?: (step: AnalysisStep) => void
  onLog?: (entry: LogEntry) => void
}

export async function analyzeBacklink(
  options: AnalyzeBacklinkOptions
): Promise<BacklinkAnalysisResult> {
  const { url, onProgress, onLog } = options
  let logId = 0
  const log = (level: LogLevel, phase: LogEntry['phase'], message: string, data?: unknown) => {
    onLog?.({ id: ++logId, timestamp: Date.now(), level, phase, message, data })
  }

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

  // Step 2: Pure code-based analysis
  onProgress?.('analyzing')

  const unfilteredForms = analysis.forms.filter(f => !f.filtered)
  const allFields = analysis.fields

  // Detect comment-related fields
  const commentFields = allFields.filter(f => {
    const p = (f.inferred_purpose || f.label || f.name || '').toLowerCase()
    return p.includes('comment') || p.includes('message') || p.includes('reply')
  })
  const urlFields = allFields.filter(f => {
    const p = (f.inferred_purpose || f.label || f.name || '').toLowerCase()
    return p.includes('url') || p.includes('website') || p.includes('site')
  })
  const textareaFields = allFields.filter(f =>
    f.tagName === 'textarea' || f.effective_type === 'textarea'
  )
  const emailFields = allFields.filter(f => {
    const t = (f.type || f.effective_type || '').toLowerCase()
    const p = (f.inferred_purpose || f.label || f.name || '').toLowerCase()
    return t === 'email' || p.includes('email')
  })

  log('info', 'analyze', `表单分析完成 — 发现 ${unfilteredForms.length} 个表单, ${allFields.length} 个字段`, {
    forms: unfilteredForms.length,
    fields: allFields.length,
    commentFields: commentFields.length,
    urlFields: urlFields.length,
    textareaFields: textareaFields.length,
  })

  // Determine canComment
  const hasUnfilteredForm = unfilteredForms.length > 0
  const hasCommentArea = commentFields.length > 0 || textareaFields.length > 0
  const canComment = hasUnfilteredForm && hasCommentArea

  // Detect CMS
  let cmsType: BacklinkAnalysisResult['cmsType'] = 'unknown'
  const formActions = unfilteredForms.map(f => f.form_action || '').join(' ')
  if (formActions.includes('wp-comments-post') || formActions.includes('wp-admin')) {
    cmsType = 'wordpress'
  }

  // Infer formType
  let formType: BacklinkAnalysisResult['formType'] = 'none'
  if (canComment) {
    formType = 'blog_comment'
  }

  // Detect field names
  const detectedFields = allFields.map(f => f.inferred_purpose || f.label || f.name).filter(Boolean)

  // Confidence scoring
  let confidence = 0.3
  if (canComment) {
    if (urlFields.length > 0) confidence += 0.3
    if (textareaFields.length > 0) confidence += 0.2
    if (emailFields.length > 0) confidence += 0.1
    if (commentFields.length > 0) confidence += 0.1
    confidence = Math.min(confidence, 1.0)
  }

  const result: BacklinkAnalysisResult = {
    canComment,
    summary: canComment ? '检测到评论表单' : '未发现评论表单',
    formType,
    cmsType,
    detectedFields,
    confidence,
  }

  const level = result.canComment ? 'success' : 'warning'
  log(level, 'analyze', `判定: ${result.canComment ? '可发布' : '不可发布'} (信心度: ${(result.confidence * 100).toFixed(0)}%)`, result)

  onProgress?.('done')
  return result
}

interface ConfidenceInput {
  forms: FormGroup[]
  fields: FormField[]
  cmsType: string
}

export function calculateConfidence(input: ConfidenceInput): number {
  const { forms, fields, cmsType } = input
  const unfilteredForms = forms.filter(f => !f.filtered)

  const commentFields = fields.filter(f => {
    const p = (f.inferred_purpose || f.label || f.name || '').toLowerCase()
    return p.includes('comment') || p.includes('message') || p.includes('reply')
  })
  const urlFields = fields.filter(f => {
    const p = (f.inferred_purpose || f.label || f.name || '').toLowerCase()
    return p.includes('url') || p.includes('website') || p.includes('site')
  })
  const textareaFields = fields.filter(f =>
    f.tagName === 'textarea' || f.effective_type === 'textarea'
  )
  const emailFields = fields.filter(f => {
    const t = (f.type || f.effective_type || '').toLowerCase()
    const p = (f.inferred_purpose || f.label || f.name || '').toLowerCase()
    return t === 'email' || p.includes('email')
  })
  const authorFields = fields.filter(f => {
    const p = (f.inferred_purpose || f.label || f.name || '').toLowerCase()
    return p.includes('author') || p.includes('nickname') || (p === 'name')
  })

  const formActions = unfilteredForms.map(f => (f.form_action || '').toLowerCase()).join(' ')
  const hasContactSignal = /\/(contact|support|help)/.test(formActions)

  const onlyMessageNoComment = textareaFields.length > 0
    && commentFields.length === 0
    && urlFields.length === 0

  let confidence = 0
  if (unfilteredForms.length > 0) confidence += 0.2
  if (textareaFields.length > 0) confidence += 0.15
  if (commentFields.length > 0) confidence += 0.2
  if (urlFields.length > 0) confidence += 0.2
  if (emailFields.length > 0) confidence += 0.05
  if (authorFields.length > 0) confidence += 0.1
  if (cmsType !== 'unknown') confidence += 0.15
  if (hasContactSignal) confidence -= 0.2
  if (onlyMessageNoComment) confidence -= 0.1

  return Math.max(0, Math.min(1, confidence))
}
