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

/** Result of a form fill operation */
export interface FillResult {
	filled: number
	skipped: number
	failed: number
	notes: string
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
