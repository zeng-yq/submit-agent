import type { PageAgentCore } from '@page-agent/core'
import * as z from 'zod/v4'

export interface AnalysisAgentTool<TParams = any> {
	description: string
	inputSchema: z.ZodType<TParams>
	execute: (this: PageAgentCore, args: TParams) => Promise<string>
}

function tool<TParams>(options: AnalysisAgentTool<TParams>): AnalysisAgentTool<TParams> {
	return options
}

export interface AnalysisResult {
	publishable: boolean
	category: string
	summary: string
}

export const analysisTools: Record<string, AnalysisAgentTool> = {
	report_analysis_result: tool({
		description:
			'Report the analysis result for the current page. Call this when you have finished analyzing the page and determined whether it supports backlink placement.',
		inputSchema: z.object({
			publishable: z.boolean().describe('Whether the page is suitable for publishing a backlink'),
			category: z.enum([
				'blog_comment',
				'directory',
				'forum',
				'guestbook',
				'profile',
				'resource_page',
				'other',
			]).describe('The type of backlink opportunity found'),
			summary: z.string().describe('Brief explanation of what was found (1-2 sentences)'),
		}),
		execute: async function (input) {
			;(this as any)._analysisResult = {
				publishable: input.publishable,
				category: input.category,
				summary: input.summary,
			} satisfies AnalysisResult
			return `Analysis recorded: ${input.publishable ? 'PUBLISHABLE' : 'NOT PUBLISHABLE'} (${input.category}) — ${input.summary}`
		},
	}),
}
