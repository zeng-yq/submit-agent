import { describe, it, expect } from 'vitest'
import { isContactOnlyPage } from '@/agent/form-analyzer/contact-detector'
import type { FormAnalysisResult, FormField, FormGroup } from '@/agent/form-analyzer/types'

function makeAnalysis(over: Partial<FormAnalysisResult> = {}): FormAnalysisResult {
	return {
		fields: [],
		forms: [],
		page_info: { title: '', description: '', headings: [], content_preview: '' },
		...over,
	}
}
function form(over: Partial<FormGroup> = {}): FormGroup {
	return { form_index: 0, role: 'unknown', confidence: 'low', field_count: 5, filtered: false, ...over }
}
function field(over: Partial<FormField> = {}): FormField {
	return { canonical_id: 'f', name: '', id: '', type: 'text', label: '', placeholder: '', required: false, maxlength: null, selector: '', tagName: 'input', ...over }
}

describe('isContactOnlyPage', () => {
	it('web3forms action + 无评论系统 → true（contact.php 场景）', () => {
		const a = makeAnalysis({
			forms: [form({ form_action: 'https://api.web3forms.com/submit' })],
			fields: [
				field({ name: 'name' }),
				field({ name: 'email', type: 'email' }),
				field({ name: 'subject' }),
				field({ name: 'phone' }),
				field({ name: 'messege', type: 'textarea', tagName: 'textarea', placeholder: 'Messege' }),
			],
		})
		expect(isContactOnlyPage(a)).toBe(true)
	})

	it('web3forms action + 有评论系统 → false（页面同时有评论表单）', () => {
		const a = makeAnalysis({
			forms: [form({ form_action: 'https://api.web3forms.com/submit' })],
			fields: [field({ name: 'name' })],
			commentSystem: { name: 'wordpress', boost: 1 },
		})
		expect(isContactOnlyPage(a)).toBe(false)
	})

	it('formspree / formsubmit 等邮件服务 host → true', () => {
		expect(isContactOnlyPage(makeAnalysis({ forms: [form({ form_action: 'https://formspree.io/f/xxx' })] }))).toBe(true)
		expect(isContactOnlyPage(makeAnalysis({ forms: [form({ form_action: 'https://formsubmit.co/foo@bar.com' })] }))).toBe(true)
	})

	it('无白名单 host + 字段组合（phone+subject+message textarea 无 comment）→ true', () => {
		const a = makeAnalysis({
			forms: [form({ form_action: '/contact-handler.php' })],
			fields: [
				field({ name: 'name' }),
				field({ name: 'email', type: 'email' }),
				field({ name: 'subject' }),
				field({ name: 'phone', type: 'tel' }),
				field({ name: 'message', type: 'textarea', tagName: 'textarea', placeholder: 'Your message' }),
			],
		})
		expect(isContactOnlyPage(a)).toBe(true)
	})

	it('WP 评论表单（wp-comments-post.php）→ false', () => {
		const a = makeAnalysis({
			forms: [form({ form_action: 'https://a.com/wp-comments-post.php' })],
			fields: [field({ name: 'comment', type: 'textarea', tagName: 'textarea' })],
		})
		expect(isContactOnlyPage(a)).toBe(false)
	})

	it('含 comment/reply 字段（即使有 phone）→ false', () => {
		const a = makeAnalysis({
			forms: [form({ form_action: '/submit' })],
			fields: [field({ name: 'phone' }), field({ name: 'comment', type: 'textarea', tagName: 'textarea' })],
		})
		expect(isContactOnlyPage(a)).toBe(false)
	})

	it('无任何联系表单信号（普通字段）→ false', () => {
		const a = makeAnalysis({
			forms: [form({ form_action: '/search' })],
			fields: [field({ name: 'q' })],
		})
		expect(isContactOnlyPage(a)).toBe(false)
	})

	it('message textarea + 无白名单 host 但缺 phone/subject → false（信号不足）', () => {
		const a = makeAnalysis({
			forms: [form({ form_action: '/submit' })],
			fields: [
				field({ name: 'name' }),
				field({ name: 'email', type: 'email' }),
				field({ name: 'message', type: 'textarea', tagName: 'textarea' }),
			],
		})
		expect(isContactOnlyPage(a)).toBe(false)
	})
})
