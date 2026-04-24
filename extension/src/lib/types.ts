/** Product profile stored in IndexedDB. User fills this once, agent uses it for every submission. */
export interface ProductProfile {
	id: string
	name: string
	url: string
	description: string
	anchorTexts: string
	logoSquare?: string
	logoBanner?: string
	screenshots: string[]
	founderName: string
	founderEmail: string
	createdAt: number
	updatedAt: number
}

export type SubmissionStatus =
	| 'not_started'
	| 'in_progress'
	| 'submitted'
	| 'approved'
	| 'rejected'
	| 'failed'
	| 'skipped'

/** Tracks per-site submission state in IndexedDB */
export interface SubmissionRecord {
	id: string
	siteName: string
	productId: string
	status: SubmissionStatus
	rewrittenDesc?: string
	submittedAt?: number
	notes?: string
	error?: string        // 失败时的错误信息
	failedAt?: number     // 失败时间戳 (Date.now())
	submittedFromFloatButton?: boolean
	createdAt: number
	updatedAt: number
}

/** Site record stored in IndexedDB, extends SiteData with DB metadata */
export interface SiteRecord extends SiteData {
  domain?: string
  createdAt: number
  updatedAt: number
}

/** Site category — fixed set of 3 categories for the submit dashboard */
export type SiteCategory = 'blog_comment' | 'ai_directory' | 'others'

export const SITE_CATEGORIES: { value: SiteCategory; label: string }[] = [
  { value: 'blog_comment', label: '博客评论' },
  { value: 'ai_directory', label: 'AI 目录' },
  { value: 'others', label: '其他' },
]

/** Get display label for a category value; unknown values map to their raw string. */
export function getCategoryLabel(category: string): string {
  return SITE_CATEGORIES.find((c) => c.value === category)?.label ?? category
}

/** One entry from sites.json */
export interface SiteData {
	name: string
	submit_url: string | null
	category: SiteCategory
	dr: number | null
	status?: string
	monthly_traffic?: number
	pricing?: string
	notes?: string
}

/** sites.json top-level structure */
export interface SitesDatabase {
	meta: {
		name: string
		description: string
		last_updated: string
		total_sites: number
		license: string
		repository: string
	}
	sites: SiteData[]
}

/** LLM config persisted in chrome.storage.local */
export interface LLMSettings {
	apiKey: string
	baseUrl: string
	model: string
}

export type ProviderKey = 'openrouter' | 'openai' | 'deepseek' | 'custom'

/** Per-provider LLM configs + active provider selection */
export interface ProviderConfigs {
	active: ProviderKey
	configs: Record<ProviderKey, LLMSettings>
}

/** Extension-wide settings persisted in chrome.storage.local */
export interface ExtSettings {
	llm: LLMSettings
	autoRewriteDesc: boolean
}

/** Message types for background <-> content script communication */
export type MessageType =
	| 'SUBMIT_CONTROL'
	| 'FETCH_PAGE_CONTENT'
	| 'FLOAT_BUTTON_TOGGLE'
	| 'FLOAT_FILL'
	| 'STATUS_UPDATE'

/** FLOAT_FILL message actions */
export type FloatFillAction =
	| 'start'
	| 'analyze'
	| 'fill'
	| 'progress'
	| 'done'
	| 'error'
	| 'no-product'
	| 'all-done'

export interface ExtMessage {
	type: MessageType
	action: string
	payload?: unknown
	targetTabId?: number
}

/** Analysis status for imported backlinks */
export type BacklinkStatus =
	| 'pending'
	| 'publishable'
	| 'not_publishable'
	| 'skipped'
	| 'error'

/** Extended analysis result from LLM for backlink suitability */
export interface BacklinkAnalysisResult {
	canComment: boolean
	summary: string
	formType: 'blog_comment' | 'directory' | 'contact_form' | 'forum' | 'none'
	cmsType: 'wordpress' | 'blogger' | 'discuz' | 'custom' | 'unknown'
	detectedFields: string[]
	confidence: number
	commentSystem?: string
}

/** Backlink record imported from Semrush CSV, stored in IndexedDB */
export interface BacklinkRecord {
	id: string
	sourceUrl: string
	sourceTitle: string
	pageAscore: number
	status: BacklinkStatus
	analysisLog: string[]
	analysisResult?: BacklinkAnalysisResult
	domain?: string
	createdAt: number
	updatedAt: number
}
