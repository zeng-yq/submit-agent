/**
 * contact-detector —— 识别「纯联系表单页面」。
 *
 * 联系表单（Web3Forms / Formspree / FormSubmit 等）的留言转发到站长邮箱、不公开展示，
 * 对评论外链建设无效；若被当 blog_comment 处理，自动提交后页面永不出现评论内容，
 * 却可能因 ajax/timeout→cleared 信号被误判「评论已发布」，且每次提交都会给站长发一封真实邮件。
 *
 * 故当页面「有联系表单 + 无评论表单」时，由 FormFillEngine 直接判失败、跳过填写与提交。
 * 纯函数，基于 FormAnalysisResult（已跨消息序列化）判定，便于 jsdom 单测。
 */
import type { FormAnalysisResult, FormField } from './types'

/** 已知「表单转邮件」第三方服务 host（联系表单后端：留言发站长邮箱、不公开展示） */
const CONTACT_FORM_HOSTS = [
	'web3forms.com',
	'formspree.io',
	'formsubmit.co',
	'getsform.com',
	'basin.fm',
	'formspark.io',
	'formcarry.com',
	'formpost.org',
]

/** WP 原生评论提交地址 */
const WP_COMMENT_ACTION = /wp-comments-post\.php/i

/** 评论字段语义（命中任一说明存在评论表单） */
const COMMENT_FIELD_RE = /comment|reply|respond/i

/** 联系表单 message textarea 语义（含 contact.php 常见的 messege 拼写错误） */
const MESSAGE_FIELD_RE = /mess?a?ge|contact/i

/** 联系表单特征字段（评论表单罕见）：phone / subject */
const CONTACT_FEATURE_RE = /\b(phone|subject)\b/i

function fieldHay(f: FormField): string {
	return `${f.name ?? ''} ${f.id ?? ''} ${f.canonical_id ?? ''} ${f.placeholder ?? ''} ${f.label ?? ''}`
}

/** 提取 action 的 hostname（相对 URL 用占位 base，返回占位 host，不会命中白名单） */
function hostOf(action: string): string {
	try {
		return new URL(action, 'https://placeholder.invalid').hostname.toLowerCase()
	} catch {
		return ''
	}
}

/** form_action 是否指向联系表单邮件服务（host 或其父域命中白名单） */
function isContactFormAction(action: string | undefined): boolean {
	if (!action) return false
	const host = hostOf(action)
	return CONTACT_FORM_HOSTS.some(h => host === h || host.endsWith(`.${h}`))
}

function hasCommentField(fields: FormField[]): boolean {
	return fields.some(f => COMMENT_FIELD_RE.test(fieldHay(f)))
}

function hasMessageTextarea(fields: FormField[]): boolean {
	return fields.some(f =>
		(f.type === 'textarea' || f.tagName === 'textarea') && MESSAGE_FIELD_RE.test(fieldHay(f)))
}

function hasContactFeatureField(fields: FormField[]): boolean {
	return fields.some(f => CONTACT_FEATURE_RE.test(fieldHay(f)))
}

/**
 * 页面是否为「纯联系表单页面」：有联系表单且无评论表单。
 * 命中条件（同时满足）：
 *   1. 无评论表单 —— 无 commentSystem、无 WP 评论 action、无 comment/reply 字段；
 *   2. 有联系表单 —— 某 form_action 命中邮件服务白名单，或字段组合为
 *      「message/contact textarea + phone/subject 特征字段」。
 */
export function isContactOnlyPage(analysis: FormAnalysisResult): boolean {
	const { forms, fields, commentSystem } = analysis

	const hasWpCommentAction = forms.some(f => f.form_action ? WP_COMMENT_ACTION.test(f.form_action) : false)
	if (commentSystem || hasWpCommentAction || hasCommentField(fields)) return false

	const hasContactAction = forms.some(f => isContactFormAction(f.form_action))
	const hasContactFieldCombo = hasMessageTextarea(fields) && hasContactFeatureField(fields)
	return hasContactAction || hasContactFieldCombo
}
