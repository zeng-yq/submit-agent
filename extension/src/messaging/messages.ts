// src/messaging/messages.ts
import type { FormAnalysisResult } from '@/agent/FormAnalyzer'
import type { SubmitResponse } from '@/agent/comment-submit'
import type { PageContent } from '@/agent/PageContentExtractor'
import type { SiteType, VerifyResult } from '@/agent/types'
import type { SiteData } from '@/lib/types'

/* ---------- FILL_PROGRESS：UI 生命周期信号（chrome.runtime.sendMessage 广播） ---------- */
export type FillProgressAction =
	| 'start' | 'progress' | 'done' | 'error'
	| 'no-product' | 'no-match' | 'reset' | 'all-done' | 'confirm'

export interface ProgressPayload {
	filled?: number
	failed?: number
	verifyResult?: VerifyResult
	message?: string
	notes?: string
	submitError?: string
}

export type FillProgressMessage = {
	type: 'FILL_PROGRESS'
	action: FillProgressAction
	payload?: ProgressPayload
}

/* ---------- TAB_COMMAND：content 指令（chrome.tabs.sendMessage 点对点） ---------- */
export type TabCommandAction =
	| 'analyze' | 'fill' | 'submit'
	| 'annotate' | 'annotate-active' | 'annotate-clear'
	| 'scroll-to-first' | 'verify-moderation'

export interface AnalyzePayload { siteType: SiteType }
export interface FillPayload { fields: Array<{ canonical_id: string; value: string; selector: string }> }
export interface SubmitPayload {
	fields: Array<{ selector: string; type?: string; effective_type?: string; name?: string; id?: string; canonical_id?: string }>
}
export interface AnnotateFieldsPayload { fields: Array<{ selector: string }> }
export interface AnnotateActivePayload { index: number }

export type TabCommandMessage =
	| { type: 'TAB_COMMAND'; action: 'analyze'; payload: AnalyzePayload }
	| { type: 'TAB_COMMAND'; action: 'fill'; payload: FillPayload }
	| { type: 'TAB_COMMAND'; action: 'submit'; payload: SubmitPayload }
	| { type: 'TAB_COMMAND'; action: 'annotate'; payload: AnnotateFieldsPayload }
	| { type: 'TAB_COMMAND'; action: 'annotate-active'; payload: AnnotateActivePayload }
	| { type: 'TAB_COMMAND'; action: 'annotate-clear' }
	| { type: 'TAB_COMMAND'; action: 'scroll-to-first'; payload: AnnotateFieldsPayload }
	| { type: 'TAB_COMMAND'; action: 'verify-moderation'; payload?: { commentText?: string } }

/* ---------- 响应类型（复用既有，避免漂移） ---------- */
export interface AnalyzeResponse { ok: boolean; analysis: FormAnalysisResult; pageContent?: PageContent; error?: string }
export interface FillResponse { ok: boolean; filled: number; failed: number; error?: string }
export interface SimpleResponse { ok: boolean; error?: string }
export interface VerifyModerationResponse { ok: boolean; moderation: boolean; commentVisible: boolean; cloudflare: boolean }

/* ---------- 既有单一职责 type ---------- */
export type ExtensionMessage =
	| FillProgressMessage
	| TabCommandMessage
	| { type: 'CHECK_SITE_MATCH'; payload: { url: string } }
	| { type: 'FLOAT_BUTTON_TOGGLE'; enabled: boolean }
	| { type: 'FLOAT_ADD_SITE'; url: string }
	| { type: 'ADD_SITE'; payload: { name: string; submit_url: string; domain?: string; category: string; dr: number; notes: string } }
	| { type: 'DELETE_SITE'; payload: { siteName: string } }
	| { type: 'CLOSE_TAB' }
	| { type: 'SUBMIT_CONTROL'; action: 'open_submit_page'; payload: string }
	| { type: 'FETCH_PAGE_CONTENT'; payload: { url: string } }
	| { type: 'SUBMISSION_STATUS_CHANGED'; payload: { siteName: string; toggleState: 'not_started' | 'submitted' | 'failed' } }
	| { type: 'STATUS_UPDATE'; payload: { status: string; tabUrl?: string } }
	| { type: 'SITES_CHANGED' }
	| { type: 'PRODUCTS_CHANGED' }
	| { type: 'SITE_ADDED'; url: string }
	/* iframe（仅类型，桥梁不动） */
	| { type: 'SUBMIT_IFRAME'; commentSelector: string | null }
	| { type: 'REQUEST_IFRAME_ANALYSIS' }
	| { type: 'FILL_IFRAME_FIELDS'; fields: unknown }
	| { type: 'IFRAME_SUBMIT_RESULT'; result: unknown }
	| { type: 'IFRAME_FILL_RESULT'; result: unknown }
	| { type: 'IFRAME_ANALYSIS_RESULT'; analysis: unknown }

/** 收窄辅助：按 action 取 TAB_COMMAND 消息 */
export type TabCommandOf<A extends TabCommandAction> = Extract<TabCommandMessage, { action: A }>
/** 收窄辅助：按 action 取 FILL_PROGRESS 消息 */
export type FillProgressOf<A extends FillProgressAction> = Extract<FillProgressMessage, { action: A }>
