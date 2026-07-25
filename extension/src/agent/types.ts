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
	| 'unverified' // 提交触发整页跳转，但跳转后无法确认发布状态（保守判失败）
	| 'blocked_cloudflare' // 提交触发整页跳转，落定页是 Cloudflare 人机验证挑战页（评论未发布）
	| 'captcha' // 检测到 reCAPTCHA/hCaptcha/图片验证码，需人工、无法自动通过，命中即放弃提交
	| 'not_attempted' // 未尝试提交（找不到按钮 / 点击失败 / 响应丢失）

/** 自动提交后判定为「已确认成功」的验证结果集合（navigating/pagehide 仅在跳转后验证通过后才成立） */
export const VERIFIED_SUCCESS: readonly VerifyResult[] = ['ajax', 'cleared', 'navigating', 'pagehide']

/** 把提交验证结果映射为直白的中文状态文案（供日志/失败提示统一展示）。
 * 参数取 string 而非强类型 VerifyResult：调用方（如 useFloatFill）可能持有弱类型 string，
 * 且 switch 有 default 兜底，非法值统一映射为「未知提交状态」。 */
export function verifyResultLabel(r: string | undefined): string {
	switch (r) {
		case 'ajax':
		case 'navigating':
		case 'pagehide':
		case 'cleared':
			return '评论已发布'
		case 'timeout':
			return '提交超时，未能确认结果'
		case 'login_required':
			return '需要登录，提交未成功'
		case 'pending_moderation':
			return '评论待审核，未发布'
		case 'unverified':
			return '提交后页面未见评论，判定未发布'
		case 'blocked_cloudflare':
			return '需要 Cloudflare 人机验证，未发布'
		case 'captcha':
			return '遇到验证码，无法自动提交'
		case 'not_attempted':
			return '未提交（未找到按钮或点击失败）'
		default:
			return '未知提交状态'
	}
}

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
