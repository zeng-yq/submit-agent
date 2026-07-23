// src/agent/pipeline/types.ts
import type { ExtensionMessage, FillProgressAction, ProgressPayload } from '@/messaging/messages'
import type { LLMSettings } from '@/lib/types'
import type { ProductProfile, SiteData } from '@/lib/types'
import type { FormAnalysisResult } from '@/agent/FormAnalyzer'
import type { PageContent } from '@/agent/PageContentExtractor'
import type { FieldValueMap, LogLevel, LLMFieldData, SiteType } from '@/agent/types'
import type { ModerationVerdict } from '@/agent/verify-after-navigation'

/** 已解析的待填字段（canonical_id → value + selector） */
export type FieldsToFill = Array<{ canonical_id: string; value: string; selector: string }>

/** 注入到各 phase 的副作用端口（镜像 SubmitFlowDeps） */
export interface FormFillDeps {
  /** 发消息到 content tab（已绑定 tabId） */
  sendToTabMessage: <R>(msg: ExtensionMessage, timeoutMs: number) => Promise<R>
  /** 广播 UI 进度信号 */
  sendProgress: (action: FillProgressAction, payload?: ProgressPayload) => void
  /** 调 LLM（已绑定 llmConfig） */
  callLLM: (opts: {
    systemPrompt: string
    userPrompt: string
    temperature: number
    maxTokens: number
    signal?: AbortSignal
    jsonMode: boolean
  }) => Promise<string>
  /** 跨页面验证（供 submit phase） */
  verifyNavigation: () => Promise<ModerationVerdict>
  /** 日志 */
  log: (level: LogLevel, phase: 'analyze' | 'llm' | 'fill' | 'system', message: string, data?: unknown, url?: string) => void
  /** LLM 字段值展示回调（可选） */
  onLLMFields?: (data: LLMFieldData) => void
}

export interface AnalyzePhaseInput { siteType: SiteType }
export interface AnalyzePhaseOutput { analysis: FormAnalysisResult; pageContent?: PageContent }

export interface LlmPhaseInput {
  analysis: FormAnalysisResult
  pageContent?: PageContent
  product: ProductProfile
  site: SiteData
  siteType: SiteType
  signal?: AbortSignal
}

export interface FillPhaseInput { fieldsToFill: FieldsToFill }
export interface FillPhaseOutput { filled: number; failed: number }

export interface MatchResult {
  fieldsToFill: FieldsToFill
  skipped: number
  matchedViaFuzzy: boolean
}
