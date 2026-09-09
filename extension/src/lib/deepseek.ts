import type { LLMSettings } from './types'

/**
 * DeepSeek V4 系列（deepseek-v4-flash / deepseek-v4-pro）默认开启思考模式，
 * 思考链计入 output tokens，会挤占 max_tokens 预算导致正文为空（finish_reason: length）。
 * 通过 thinking 参数关闭：https://api-docs.deepseek.com/guides/thinking_mode
 *
 * 仅 DeepSeek 端点附加该参数——其他 provider 对未知参数会报 400。
 * 返回需合并进请求 body 的字段，非 DeepSeek 端点返回空对象。
 */
export function disableDeepSeekThinking(config: LLMSettings): Record<string, unknown> {
	if (!config.baseUrl.toLowerCase().includes('deepseek.com')) return {}
	return { thinking: { type: 'disabled' } }
}
