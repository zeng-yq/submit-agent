import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

// 防止 fake timers 跨用例泄漏
afterEach(() => {
	vi.useRealTimers()
	delete (globalThis as any).navigation
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

	it('<a> 锚点提交按钮（OpenCart/Journal2 等 AJAX 站点）', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `
			<form>
				<input type="text" name="name"/>
				<input type="text" name="email"/>
				<textarea name="comment"></textarea>
				<a class="button comment-submit">Submit</a>
			</form>`
		const form = doc.querySelector('form') as HTMLFormElement
		const btn = mod.findSubmitButtonInForm(form)
		expect(btn?.tagName).toBe('A')
		expect(btn?.textContent?.trim()).toBe('Submit')
	})

	it('<a role="button"> 含提交关键词', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `
			<form>
				<textarea name="comment"></textarea>
				<a role="button">发表评论</a>
			</form>`
		const form = doc.querySelector('form') as HTMLFormElement
		const btn = mod.findSubmitButtonInForm(form)
		expect(btn?.tagName).toBe('A')
		expect(btn?.textContent?.trim()).toBe('发表评论')
	})

	it('普通导航 <a> 不被误判为提交按钮', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `
			<form>
				<textarea name="comment"></textarea>
				<a href="/about">About</a>
				<a href="/contact">Contact</a>
			</form>`
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

	it('评论框 + <a> 锚点提交按钮（非 WP 站点端到端）', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `
			<div class="post-comment">
				<div class="comment-form">
					<form>
						<input type="text" name="name"/>
						<textarea name="comment" id="comment"></textarea>
						<a class="button comment-submit">Submit</a>
					</form>
				</div>
			</div>`
		const res = mod.resolveSubmitButton('#comment')
		expect(res.button?.tagName).toBe('A')
		expect(res.form).not.toBeNull()
	})
})

describe('detectCaptcha', () => {
	it('检测到 reCAPTCHA widget', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<form><div class="g-recaptcha" data-sitekey="x"></div></form>`
		const form = doc.querySelector('form')!
		expect(mod.detectCaptcha(form)).toBe(true)
	})

	it('Turnstile 不被 detectCaptcha 误判（交给 detectCloudflare）', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<form><div class="cf-turnstile" data-sitekey="x"></div></form>`
		expect(mod.detectCaptcha(doc.querySelector('form')!)).toBe(false)
	})

	it('无验证码返回 false', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<form><input type="text"></form>`
		expect(mod.detectCaptcha(doc.querySelector('form')!)).toBe(false)
	})
})

describe('detectCloudflare', () => {
	it('检测到 Turnstile widget', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<form><div class="cf-turnstile" data-sitekey="x"></div></form>`
		expect(mod.detectCloudflare(doc.querySelector('form')!)).toBe(true)
	})

	it('检测到 Turnstile iframe', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<form><iframe src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/"></iframe></form>`
		expect(mod.detectCloudflare(doc.querySelector('form')!)).toBe(true)
	})

	it('reCAPTCHA 不被 detectCloudflare 误判', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<form><div class="g-recaptcha" data-sitekey="x"></div></form>`
		expect(mod.detectCloudflare(doc.querySelector('form')!)).toBe(false)
	})

	it('无验证码返回 false', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<form><input type="text"></form>`
		expect(mod.detectCloudflare(doc.querySelector('form')!)).toBe(false)
	})
})

describe('waitForSubmitOrNavigate', () => {
	it('submit 事件后无导航 → 延迟 150ms 后判定 ajax', async () => {
		vi.useFakeTimers()
		const mod = await loadModule()
		const p = mod.waitForSubmitOrNavigate(1000)
		win.document.dispatchEvent(new win.Event('submit', { bubbles: true }))
		// 立即不应 resolve（需等待 150ms 确认未发生导航）
		// 推进 150ms：无 beforeunload/pagehide → 判定真正的 AJAX 提交
		vi.advanceTimersByTime(150)
		expect(await p).toBe('ajax')
	})

	it('submit 后 beforeunload 在 150ms 内 → navigating 胜出', async () => {
		vi.useFakeTimers()
		const mod = await loadModule()
		const p = mod.waitForSubmitOrNavigate(1000)
		win.document.dispatchEvent(new win.Event('submit', { bubbles: true }))
		// 150ms 窗口期内触发 beforeunload → navigating 优先于延迟的 ajax
		vi.advanceTimersByTime(100)
		win.dispatchEvent(new win.Event('beforeunload'))
		expect(await p).toBe('navigating')
	})

	it('submit 后 pagehide 在 150ms 内 → pagehide 胜出', async () => {
		vi.useFakeTimers()
		const mod = await loadModule()
		const p = mod.waitForSubmitOrNavigate(1000)
		win.document.dispatchEvent(new win.Event('submit', { bubbles: true }))
		vi.advanceTimersByTime(50)
		win.dispatchEvent(new win.Event('pagehide'))
		expect(await p).toBe('pagehide')
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

	it('Navigation API 检测到跳转登录页 → login_required', async () => {
		let capturedNavigate: ((e: { destination?: { url?: string } }) => void) | undefined
		const removeEventListener = vi.fn()
		;(globalThis as any).navigation = {
			addEventListener: vi.fn((_: string, cb: (e: { destination?: { url?: string } }) => void) => {
				capturedNavigate = cb
			}),
			removeEventListener,
		}
		const mod = await loadModule()
		const p = mod.waitForSubmitOrNavigate(1000)
		capturedNavigate!({ destination: { url: 'https://x.com/login' } })
		expect(await p).toBe('login_required')
		expect(removeEventListener).toHaveBeenCalledWith('navigate', expect.any(Function))
	})

	it('Navigation API 检测到 moderation URL → pending_moderation', async () => {
		let capturedNavigate: ((e: { destination?: { url?: string } }) => void) | undefined
		const removeEventListener = vi.fn()
		;(globalThis as any).navigation = {
			addEventListener: vi.fn((_: string, cb: (e: { destination?: { url?: string } }) => void) => {
				capturedNavigate = cb
			}),
			removeEventListener,
		}
		const mod = await loadModule()
		const p = mod.waitForSubmitOrNavigate(1000)
		capturedNavigate!({ destination: { url: 'https://x.com/post?unapproved=1&moderation-hash=a#comment-1' } })
		expect(await p).toBe('pending_moderation')
		expect(removeEventListener).toHaveBeenCalledWith('navigate', expect.any(Function))
	})
})

describe('performClick', () => {
	it('第一策略成功执行 → 返回 success + submitResult', async () => {
		const mod = await loadModule()
		const fakeWaitFor = vi.fn().mockResolvedValue('ajax')
		doc.body.innerHTML = `<form><button id="btn" type="submit">Go</button></form>`
		const btn = doc.getElementById('btn') as HTMLElement
		const form = doc.querySelector('form') as HTMLFormElement
		const res = await mod.performClick(btn, form, fakeWaitFor)
		expect(res.success).toBe(true)
		expect(res.submitResult).toBe('ajax')
		expect(fakeWaitFor).toHaveBeenCalled()
	})

	it('按钮不存在 → success:false', async () => {
		const mod = await loadModule()
		const res = await mod.performClick(null as unknown as HTMLElement, null)
		expect(res.success).toBe(false)
		expect(res.error).toBeTruthy()
	})

	it('合成事件 + click 都抛异常时，降级到 form.submit', async () => {
		const mod = await loadModule()
		const fakeWaitFor = vi.fn().mockResolvedValue('navigating')
		doc.body.innerHTML = `<form id="f"><button id="btn">Go</button></form>`
		const btn = doc.getElementById('btn') as HTMLElement
		const form = doc.querySelector('form') as HTMLFormElement
		btn.click = () => { throw new Error('nope') }
		Object.defineProperty(btn, 'dispatchEvent', { value: () => { throw new Error('nope') } })
		form.requestSubmit = undefined as unknown as HTMLFormElement['requestSubmit']
		const res = await mod.performClick(btn, form, fakeWaitFor)
		expect(res.success).toBe(true)
		expect(res.submitResult).toBe('navigating')
	})
})

describe('isLoginRedirectUrl', () => {
	it('识别登录页路径', async () => {
		const mod = await loadModule()
		expect(mod.isLoginRedirectUrl('https://x.com/login')).toBe(true)
		expect(mod.isLoginRedirectUrl('https://x.com/signin')).toBe(true)
		expect(mod.isLoginRedirectUrl('https://x.com/sign-in')).toBe(true)
		expect(mod.isLoginRedirectUrl('https://x.com/auth')).toBe(true)
		expect(mod.isLoginRedirectUrl('https://x.com/register')).toBe(true)
		expect(mod.isLoginRedirectUrl('https://x.com/account/login')).toBe(true)
	})

	it('非登录页路径返回 false', async () => {
		const mod = await loadModule()
		expect(mod.isLoginRedirectUrl('https://x.com/events')).toBe(false)
		expect(mod.isLoginRedirectUrl('https://x.com/setting/message')).toBe(false)
		expect(mod.isLoginRedirectUrl('https://x.com/dashboard')).toBe(false)
	})
})

describe('isModerationUrl', () => {
	it('同时包含 unapproved= 和 moderation-hash= → true', async () => {
		const mod = await loadModule()
		expect(mod.isModerationUrl('https://x.com/post?unapproved=8329&moderation-hash=abc')).toBe(true)
	})

	it('仅 unapproved= 无 moderation-hash= → false', async () => {
		const mod = await loadModule()
		expect(mod.isModerationUrl('https://x.com/post?unapproved=8329')).toBe(false)
	})

	it('普通文章 URL → false', async () => {
		const mod = await loadModule()
		expect(mod.isModerationUrl('https://x.com/post')).toBe(false)
	})

	it('仅 #comment 锚点无查询串 → false', async () => {
		const mod = await loadModule()
		expect(mod.isModerationUrl('https://x.com/post#comment-8329')).toBe(false)
	})
})

describe('isModerationContent', () => {
	it('DOM 含 comment-awaiting-moderation 元素 → true', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<em class="comment-awaiting-moderation">Your comment is awaiting moderation.</em>`
		expect(mod.isModerationContent(doc.body)).toBe(true)
	})

	it('文本含 "Your comment is awaiting moderation" → true', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<div>Your comment is awaiting moderation.</div>`
		expect(mod.isModerationContent(doc.body)).toBe(true)
	})

	it('文本含 "评论待审核" → true', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<div>评论待审核</div>`
		expect(mod.isModerationContent(doc.body)).toBe(true)
	})

	it('正常已发布文本 → false', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<div>Comment posted</div>`
		expect(mod.isModerationContent(doc.body)).toBe(false)
	})

	it('null root → false', async () => {
		const mod = await loadModule()
		expect(mod.isModerationContent(null)).toBe(false)
	})
})

describe('detectModeration', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('DOM 含 comment-awaiting-moderation 元素 → true', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<em class="comment-awaiting-moderation">Your comment is awaiting moderation.</em>`
		expect(mod.detectModeration()).toBe(true)
	})

	it('URL 含 moderation 参数 → true（即便 DOM 无标记）', async () => {
		const mod = await loadModule()
		vi.stubGlobal('location', { href: 'https://example.com/post?unapproved=1&moderation-hash=abc#comment-1' })
		doc.body.innerHTML = ''
		expect(mod.detectModeration()).toBe(true)
	})

	it('正常已发布页 → false', async () => {
		const mod = await loadModule()
		vi.stubGlobal('location', { href: 'https://example.com/post#comment-1' })
		doc.body.innerHTML = `<div>Comment posted</div>`
		expect(mod.detectModeration()).toBe(false)
	})
})
