import type { LLMSettings } from './types'

/**
 * 思考型模型的思考链计入 output tokens，会挤占 max_tokens 预算导致正文为空
 * （finish_reason: length、reasoning_tokens 耗尽）。通过标准 thinking 字段关闭：
 * https://api-docs.deepseek.com/guides/thinking_mode
 * https://cloud.tencent.com/document/product/1823/135872（混元 HY4 同字段）
 *
 * 仅对已知支持该字段的端点附加——其他端点对未知参数可能报 400。
 * 返回需合并进请求 body 的字段，未知端点返回空对象。
 */
const THINKING_DISABLED_HOSTS = ['deepseek.com', 'tencentmaas.com']

export function disableThinking(config: LLMSettings): Record<string, unknown> {
	const baseUrl = config.baseUrl.toLowerCase()
	if (!THINKING_DISABLED_HOSTS.some((host) => baseUrl.includes(host))) return {}
	return { thinking: { type: 'disabled' } }
}
