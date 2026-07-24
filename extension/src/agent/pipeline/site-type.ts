// src/agent/pipeline/site-type.ts
import type { SiteData, SiteCategory } from '@/lib/types'
import type { FormAnalysisResult, PageInfo } from '@/agent/FormAnalyzer'
import type { PageContent } from '@/agent/PageContentExtractor'
import type { SiteType } from '@/agent/types'
import { buildBlogCommentPrompt } from '@/agent/prompts/blog-comment-prompt'
import { buildDirectorySubmitPrompt } from '@/agent/prompts/directory-submit-prompt'

export interface SystemPromptCtx {
	productContext: string
	pageContent?: PageContent
	pageInfo: PageInfo
	fields: FormAnalysisResult['fields']
	forms: FormAnalysisResult['forms']
}

export interface SiteTypeStrategy {
	/** 日志标签 */
	label: string
	/** LLM temperature */
	temperature: number
	/** 构建 system prompt */
	buildSystemPrompt: (ctx: SystemPromptCtx) => string
	/** 构建 user prompt */
	buildUserPrompt: (site: SiteData) => string
	/** 是否在填写成功后自动提交（blog_comment:true，directory_submit:false） */
	autoSubmit: boolean
}

export const SITE_TYPE_STRATEGIES: Record<SiteType, SiteTypeStrategy> = {
	blog_comment: {
		label: '博客评论',
		temperature: 0.7,
		autoSubmit: true,
		buildSystemPrompt: (ctx) => ctx.pageContent
			? buildBlogCommentPrompt({ productContext: ctx.productContext, pageContent: ctx.pageContent, fields: ctx.fields, forms: ctx.forms })
			: buildDirectorySubmitPrompt({ productContext: ctx.productContext, pageInfo: ctx.pageInfo, fields: ctx.fields, forms: ctx.forms }),
		buildUserPrompt: (site) => `Fill the comment form on ${site.name}. Page URL: ${site.submit_url || 'current page'}.`,
	},
	directory_submit: {
		label: '目录提交',
		temperature: 0.3,
		autoSubmit: false,
		buildSystemPrompt: (ctx) => buildDirectorySubmitPrompt({ productContext: ctx.productContext, pageInfo: ctx.pageInfo, fields: ctx.fields, forms: ctx.forms }),
		buildUserPrompt: (site) => `Fill the submission form on ${site.name}. Submit URL: ${site.submit_url || 'current page'}.`,
	},
}

/** SiteCategory → SiteType（消除 useFormFillEngine 两处重复映射） */
export function siteTypeFromCategory(category: SiteCategory): SiteType {
	return category === 'blog_comment' ? 'blog_comment' : 'directory_submit'
}
