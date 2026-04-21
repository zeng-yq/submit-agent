import type { BacklinkAnalysisResult } from './types'
import type { FormAnalysisResult, FormField, FormGroup } from '@/agent/FormAnalyzer'
import { classifyFields } from '@/agent/FormAnalyzer'
import type { LogEntry, LogLevel } from '@/agent/types'

export type AnalysisStep = 'loading' | 'analyzing' | 'done'

export interface AnalyzeBacklinkOptions {
  url: string
  signal?: AbortSignal
  onProgress?: (step: AnalysisStep) => void
  onLog?: (entry: LogEntry) => void
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

export async function analyzeBacklink(
  options: AnalyzeBacklinkOptions
): Promise<BacklinkAnalysisResult> {
  const { url, signal, onProgress, onLog } = options
  let logId = 0
  const log = (level: LogLevel, phase: LogEntry['phase'], message: string, data?: unknown) => {
    onLog?.({ id: ++logId, timestamp: Date.now(), level, phase, message, data })
  }

  // Step 1: Fetch form analysis via background service worker
  checkAbort(signal)
  onProgress?.('loading')
  log('info', 'analyze', '正在获取页面内容...')

  const fetchResponse = await chrome.runtime.sendMessage({
    type: 'FETCH_PAGE_CONTENT',
    url,
  })
  checkAbort(signal)

  if (!fetchResponse?.ok) {
    throw new Error(fetchResponse?.error || `无法获取页面内容: ${url}`)
  }

  const analysis: FormAnalysisResult = fetchResponse.analysis

  // Step 2: Pure code-based analysis
  onProgress?.('analyzing')

  const unfilteredForms = analysis.forms.filter(f => !f.filtered)
  const allFields = analysis.fields

  // Detect comment-related fields (only for canComment determination)
  const { commentFields, textareaFields } = classifyFields(allFields)

  log('info', 'analyze', `表单分析完成 — 发现 ${unfilteredForms.length} 个表单, ${allFields.length} 个字段`, {
    forms: unfilteredForms.length,
    fields: allFields.length,
  })

  // Determine canComment
  const hasUnfilteredForm = unfilteredForms.length > 0
  const hasCommentArea = commentFields.length > 0 || textareaFields.length > 0
  const hasCommentExternalLinks = analysis.commentLinks?.hasExternalLinks ?? false
  const canComment = (hasUnfilteredForm && hasCommentArea) || hasCommentExternalLinks

  // Detect CMS
  let cmsType: BacklinkAnalysisResult['cmsType'] = 'unknown'
  const formActions = unfilteredForms.map(f => f.form_action || '').join(' ')
  if (formActions.includes('wp-comments-post') || formActions.includes('wp-admin')) {
    cmsType = 'wordpress'
  } else if (formActions.includes('blogger.com/comment')) {
    cmsType = 'blogger'
  } else if (formActions.includes('forum.php?mod=post') || formActions.includes('forum.php?mod=misc')) {
    cmsType = 'discuz'
  } else if (hasUnfilteredForm && hasCommentArea) {
    cmsType = 'custom'
  }

  const commentSystem = analysis.commentSystem?.name

  // Infer formType
  let formType: BacklinkAnalysisResult['formType'] = 'none'
  if (canComment) {
    formType = 'blog_comment'
  }

  // Detect field names
  const detectedFields = allFields.map(f => f.inferred_purpose || f.label || f.name).filter(Boolean)

  const confidence = calculateConfidence({
    forms: analysis.forms,
    fields: allFields,
    cmsType,
    hasCommentExternalLinks,
    commentSystem,
  })

  const result: BacklinkAnalysisResult = {
    canComment,
    summary: canComment
      ? hasCommentExternalLinks
        ? '检测到评论外链（无需可见表单）'
        : '检测到评论表单'
      : '未发现评论表单',
    formType,
    cmsType,
    detectedFields,
    confidence,
    commentSystem,
  }

  const level = result.canComment ? 'success' : 'warning'
  log(level, 'analyze', `判定: ${result.canComment ? '可发布' : '不可发布'} (信心度: ${(result.confidence * 100).toFixed(0)}%)${commentSystem ? ` [${commentSystem}]` : ''}`, result)

  onProgress?.('done')
  return result
}

interface ConfidenceInput {
  forms: FormGroup[]
  fields: FormField[]
  cmsType: string
  hasCommentExternalLinks?: boolean
  commentSystem?: string
}

export function calculateConfidence(input: ConfidenceInput): number {
  const { forms, fields, cmsType } = input
  const unfilteredForms = forms.filter(f => !f.filtered)

  const { commentFields, textareaFields, urlFields, emailFields, authorFields } = classifyFields(fields)

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
  if (input.hasCommentExternalLinks) confidence += 0.25
  if (input.commentSystem && input.commentSystem !== 'unknown') confidence += 0.20
  if (hasContactSignal) confidence -= 0.2
  if (onlyMessageNoComment) confidence -= 0.1

  return Math.max(0, Math.min(1, confidence))
}
