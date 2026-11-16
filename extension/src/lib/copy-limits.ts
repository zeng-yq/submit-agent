/** 生成文案的字数软限制档位：注入提示词约束 LLM，超出不报错不重试（区别于链接数的硬校验）。 */

export const INTRO_CHAR_LIMIT_OPTIONS = [150, 300, 500] as const
export const DESCRIPTION_CHAR_LIMIT_OPTIONS = [1000, 2000, 3000] as const

export interface CopyCharLimits {
	maxIntroChars: number
	maxDescriptionChars: number
}

export const DEFAULT_COPY_CHAR_LIMITS: CopyCharLimits = {
	maxIntroChars: 300,
	maxDescriptionChars: 1000,
}

export function isIntroCharLimit(value: unknown): value is (typeof INTRO_CHAR_LIMIT_OPTIONS)[number] {
	return typeof value === 'number' && (INTRO_CHAR_LIMIT_OPTIONS as readonly number[]).includes(value)
}

export function isDescriptionCharLimit(
	value: unknown,
): value is (typeof DESCRIPTION_CHAR_LIMIT_OPTIONS)[number] {
	return typeof value === 'number' && (DESCRIPTION_CHAR_LIMIT_OPTIONS as readonly number[]).includes(value)
}
