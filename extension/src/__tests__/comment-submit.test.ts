import { describe, it, expect, beforeEach } from 'vitest'
import { JSDOM } from 'jsdom'

let dom: JSDOM
let doc: Document
let win: Window

async function loadModule() {
	dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
		runScripts: 'dangerously',
		url: 'https://example.com',
	})
	// 注入到全局，让模块拿到正确的 document/window
	globalThis.document = dom.window.document
	globalThis.window = dom.window
	doc = dom.window.document
	win = dom.window
	return await import('@/agent/comment-submit')
}

beforeEach(async () => {
	await loadModule()
})

describe('isFormSubmitUrl', () => {
	it('排除静态资源', async () => {
		const mod = await loadModule()
		expect(mod.isFormSubmitUrl('https://a.com/app.js')).toBe(false)
		expect(mod.isFormSubmitUrl('https://a.com/style.css')).toBe(false)
		expect(mod.isFormSubmitUrl('https://a.com/pic.png')).toBe(false)
	})

	it('排除 analytics / wp-admin admin-ajax', async () => {
		const mod = await loadModule()
		expect(mod.isFormSubmitUrl('https://www.google-analytics.com/collect')).toBe(false)
		expect(mod.isFormSubmitUrl('https://a.com/wp-admin/admin-ajax.php')).toBe(false)
	})

	it('放行评论提交地址', async () => {
		const mod = await loadModule()
		expect(mod.isFormSubmitUrl('https://a.com/wp-comments-post.php')).toBe(true)
		expect(mod.isFormSubmitUrl('https://a.com/api/comment')).toBe(true)
	})

	it('URL 对象：静态资源返回 false', async () => {
		const mod = await loadModule()
		expect(mod.isFormSubmitUrl(new URL('https://a.com/app.js'))).toBe(false)
	})

	it('URL 对象：评论提交地址返回 true', async () => {
		const mod = await loadModule()
		expect(mod.isFormSubmitUrl(new URL('https://a.com/wp-comments-post.php'))).toBe(true)
	})
})

describe('findSubmitButtonInForm', () => {
	it('WP 标准选择器 #submit 优先', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `
			<form id="commentform">
				<input id="submit" type="submit" value="Post Comment">
				<button type="button">Cancel</button>
			</form>`
		const form = doc.getElementById('commentform') as HTMLFormElement
		const btn = mod.findSubmitButtonInForm(form)
		expect(btn?.id).toBe('submit')
	})

	it('button[type=submit] 兜底', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `
			<form>
				<button type="submit">Submit</button>
			</form>`
		const form = doc.querySelector('form') as HTMLFormElement
		expect(mod.findSubmitButtonInForm(form)?.textContent).toBe('Submit')
	})

	it('关键词匹配（中文"提交"）', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `
			<form>
				<button type="button">提交评论</button>
			</form>`
		const form = doc.querySelector('form') as HTMLFormElement
		expect(mod.findSubmitButtonInForm(form)?.textContent).toBe('提交评论')
	})

	it('表单只有一个按钮时返回它', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `
			<form>
				<button>Only</button>
			</form>`
		const form = doc.querySelector('form') as HTMLFormElement
		expect(mod.findSubmitButtonInForm(form)?.textContent).toBe('Only')
	})

	it('无按钮返回 null', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<form><input type="text"></form>`
		const form = doc.querySelector('form') as HTMLFormElement
		expect(mod.findSubmitButtonInForm(form)).toBeNull()
	})
})

describe('resolveSubmitButton', () => {
	it('通过评论框 selector 定位同表单的提交按钮', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `
			<form id="commentform">
				<textarea id="comment" name="comment"></textarea>
				<input id="submit" type="submit">
			</form>`
		const res = mod.resolveSubmitButton('#comment')
		expect(res.button?.id).toBe('submit')
		expect(res.form?.id).toBe('commentform')
	})

	it('评论框 selector 找不到时，用 WP form 选择器兜底', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `
			<form id="commentform" action="/wp-comments-post.php">
				<button type="submit">Post</button>
			</form>`
		const res = mod.resolveSubmitButton(null)
		expect(res.button?.textContent).toBe('Post')
	})

	it('页面上没有任何评论表单时返回 {form:null, button:null}', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<div>no form</div>`
		const res = mod.resolveSubmitButton(null)
		expect(res.form).toBeNull()
		expect(res.button).toBeNull()
	})
})

describe('detectCaptcha', () => {
	it('检测到 reCAPTCHA widget', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<form><div class="g-recaptcha" data-sitekey="x"></div></form>`
		const form = doc.querySelector('form')!
		expect(mod.detectCaptcha(form)).toBe(true)
	})

	it('检测到 Turnstile', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<form><div class="cf-turnstile"></div></form>`
		expect(mod.detectCaptcha(doc.querySelector('form')!)).toBe(true)
	})

	it('无验证码返回 false', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<form><input type="text"></form>`
		expect(mod.detectCaptcha(doc.querySelector('form')!)).toBe(false)
	})
})

describe('waitForSubmitOrNavigate', () => {
	it('submit 事件 → ajax', async () => {
		const mod = await loadModule()
		const p = mod.waitForSubmitOrNavigate(1000)
		win.document.dispatchEvent(new win.Event('submit', { bubbles: true }))
		expect(await p).toBe('ajax')
	})

	it('beforeunload → navigating', async () => {
		const mod = await loadModule()
		const p = mod.waitForSubmitOrNavigate(1000)
		win.dispatchEvent(new win.Event('beforeunload'))
		expect(await p).toBe('navigating')
	})

	it('pagehide → pagehide', async () => {
		const mod = await loadModule()
		const p = mod.waitForSubmitOrNavigate(1000)
		win.dispatchEvent(new win.Event('pagehide'))
		expect(await p).toBe('pagehide')
	})

	it('超时 → timeout，并恢复原始 fetch/XHR', async () => {
		const mod = await loadModule()
		const originalFetch = win.fetch
		const p = mod.waitForSubmitOrNavigate(200)
		expect(await p).toBe('timeout')
		// cleanup 后 fetch 应已恢复
		expect(win.fetch).toBe(originalFetch)
	})

	it('拦截 fetch 评论提交 → ajax', async () => {
		const mod = await loadModule()
		const originalFetch = win.fetch
		const p = mod.waitForSubmitOrNavigate(1000)
		// 模拟站点发出评论提交请求
		try { await win.fetch('https://a.com/wp-comments-post.php') } catch {}
		expect(await p).toBe('ajax')
		// cleanup 恢复
		expect(win.fetch).toBe(originalFetch)
	})
})
