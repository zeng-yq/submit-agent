/** 提取错误信息为可展示文本；非 Error 值用 String 兜底 */
export function toErrorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err)
}
