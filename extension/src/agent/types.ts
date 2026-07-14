/**
 * Local type definitions for the FormFillEngine.
 * Replaces @page-agent/core imports.
 */

/** Engine execution status */
export type FillEngineStatus =
	| 'idle'
	| 'running'
	| 'analyzing'
	| 'filling'
	| 'done'
	| 'error'
	| 'no-product'

/** 自动提交后的验证结果（仅 blog_comment 自动提交场景） */
export type VerifyResult =
	| 'ajax'        // 拦截到评论提交的 fetch/XHR 或 submit 事件
	| 'navigating'  // 触发 beforeunload（整页跳转，WP 原生评论典型）
	| 'pagehide'    // 触发 pagehide
	| 'timeout'     // 10s 内无任何提交信号，且评论框未清空
	| 'cleared'     // timeout 后再查评论框已被清空（AJAX 提交成功标志）
	| 'login_required' // 提交被重定向到登录页（未登录，提交失败）
	| 'pending_moderation' // 评论待审核（WP moderation-hash，未实际发布）
	| 'not_attempted' // 未尝试提交（找不到按钮 / 点击失败 / 验证码）

/** Result of a form fill operation */
export interface FillResult {
	filled: number
	skipped: number
	failed: number
	notes: string
	/** 是否完成了提交点击动作（仅 blog_comment） */
	submitted?: boolean
	/** 提交验证结果（仅 blog_comment） */
	verifyResult?: VerifyResult
	/** 提交/验证失败原因 */
	submitError?: string
}

/** A single field mapping from LLM response: canonical_id → value */
export type FieldValueMap = Record<string, string>

/** Blog comment LLM response schema */
export interface BlogCommentResponse {
	/** Maps canonical_id to the value to fill */
	[fieldKey: string]: string
}

/** Directory submit LLM response schema */
export interface DirectorySubmitResponse {
	/** Maps canonical_id to the value to fill */
	[fieldKey: string]: string
}

/** Site type for determining prompt strategy */
export type SiteType = 'blog_comment' | 'directory_submit'

/** Log level for activity entries */
export type LogLevel = 'info' | 'success' | 'warning' | 'error'

/** Pipeline phase that produced the log entry */
export type LogPhase = 'analyze' | 'llm' | 'fill' | 'system'

/** A single log entry emitted by FormFillEngine during pipeline execution */
export interface LogEntry {
  id: number
  timestamp: number
  level: LogLevel
  phase: LogPhase
  message: string
  data?: unknown
  /** Optional URL to make part of the message clickable */
  url?: string
}

/** LLM 返回的按字段级别展示的数据 */
export interface LLMFieldValue {
  /** 字段的 label（如 "Name"、"Email"、"Comment"） */
  label: string
  /** LLM 返回的值 */
  value: string
}

/** LLM 字段值展示数据，传递给 ActivityLog 组件 */
export interface LLMFieldData {
  fields: LLMFieldValue[]
}
