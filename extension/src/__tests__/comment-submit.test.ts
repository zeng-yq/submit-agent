import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { JSDOM } from 'jsdom'

let dom: JSDOM
let doc: Document
let win: Window & typeof globalThis

async function loadModule() {
	dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
		runScripts: 'dangerously',
		url: 'https://example.com',
	})
	// 注入到全局，让模块拿到正确的 document/window
	globalThis.document = dom.window.document
	globalThis.window = dom.window as unknown as Window & typeof globalThis
	doc = dom.window.document
	win = dom.window as unknown as Window & typeof globalThis
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

	it('Blogger/Google 评论组件：无 form 的 <div role="button">Publicar</div>', async () => {
		const mod = await loadModule()
		// 还原实测结构：textarea 无 id/name、祖先 class 不含 "comment"、
		// 提交按钮是 Material 风格的 <div role="button" aria-disabled>
		doc.body.innerHTML = `
			<div>
				<textarea class="KHxj8b"></textarea>
				<div role="button" tabindex="-1" aria-disabled="true">Publicar</div>
			</div>`
		const res = mod.resolveSubmitButton('textarea.KHxj8b')
		expect(res.button?.tagName).toBe('DIV')
		expect(res.button?.textContent).toBe('Publicar')
	})

	it('Blogger/Google：提交按钮在 textarea 多层祖先外、祖先 class 不含 comment', async () => {
		const mod = await loadModule()
		// 还原实测结构：textarea 祖先链全是混淆类名（不含 comment），
		// Publicar 按钮在 textarea 第 4 层祖先的另一子树里，不在 parentElement 内
		doc.body.innerHTML = `
			<div class="x5vlw">
				<div class="qhsbmc">
					<div class="edhGSc"><div class="RpC4Ne"><div class="Pc9Gce">
						<textarea class="KHxj8b"></textarea>
					</div></div></div>
					<div class="submit-area">
						<div role="button" tabindex="-1">Editar</div>
						<div role="button" tabindex="-1" aria-disabled="true">Publicar</div>
					</div>
				</div>
			</div>`
		const res = mod.resolveSubmitButton('textarea.KHxj8b')
		expect(res.button?.textContent).toBe('Publicar')
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

describe('detectCloudflareChallengePage', () => {
	// 提交触发整页跳转后，新页面若是 Cloudflare 人机验证整页挑战（"Just a moment..."），
	// 应判定失败而非沿用 commentVisible 降级误判成功。此处检测整页挑战信号，
	// 区别于表单内 Turnstile widget（detectCloudflare）。

	it('title 为 "Just a moment..." → 整页 CF 挑战', async () => {
		const mod = await loadModule()
		doc.title = 'Just a moment...'
		expect(mod.detectCloudflareChallengePage()).toBe(true)
	})

	it('#cf-challenge-running 元素 → 整页 CF 挑战', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<div id="cf-challenge-running"></div>`
		expect(mod.detectCloudflareChallengePage()).toBe(true)
	})

	it('.cf-browser-verification 元素 → 整页 CF 挑战', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<div class="cf-browser-verification"></div>`
		expect(mod.detectCloudflareChallengePage()).toBe(true)
	})

	it('表单内 Turnstile widget 不被误判为整页挑战', async () => {
		// 表单内嵌的 Turnstile（由 detectCloudflare 处理，等待自动完成后提交）不应触发整页挑战判定，
		// 否则正常的 CF Turnstile 站点会被误判失败。
		const mod = await loadModule()
		doc.title = '文章标题'
		doc.body.innerHTML = `<form><div class="cf-turnstile" data-sitekey="x"></div></form>`
		expect(mod.detectCloudflareChallengePage()).toBe(false)
	})

	it('普通博客页面 → false', async () => {
		const mod = await loadModule()
		doc.title = '我的博客文章'
		doc.body.innerHTML = `<form><textarea id="comment"></textarea></form>`
		expect(mod.detectCloudflareChallengePage()).toBe(false)
	})
})

describe('detectImageCaptcha', () => {
	it('检测到 Captcha.ashx 图片验证码', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<form><img src="https://www.studyguideindia.com/blogs/Contents/Captcha.ashx"><input name="txtSecurityCode" type="text"></form>`
		expect(mod.detectImageCaptcha(doc.querySelector('form')!)).toBe(true)
	})

	it('src 大小写不敏感', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<form><img src="/CAPTCHA.PNG"></form>`
		expect(mod.detectImageCaptcha(doc.querySelector('form')!)).toBe(true)
	})

	it('普通图片不误判', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<form><img src="/logo.png"></form>`
		expect(mod.detectImageCaptcha(doc.querySelector('form')!)).toBe(false)
	})

	it('无图片返回 false', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<form><input type="text"></form>`
		expect(mod.detectImageCaptcha(doc.querySelector('form')!)).toBe(false)
	})

	it('验证码 label 文本（__Captcha__ + blob 图片，如 conspirazzi）→ true', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<form><textarea id="comment"></textarea><label>__Captcha__ *</label><img src="blob:http://x/y"><input name="captcha_code" type="text"></form>`
		expect(mod.detectImageCaptcha(doc.querySelector('form')!)).toBe(true)
	})

	it('验证码字段名（input name 含 captcha）→ true', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<form><input name="my_captcha" type="text"></form>`
		expect(mod.detectImageCaptcha(doc.querySelector('form')!)).toBe(true)
	})

	it('普通 WP 评论表单（Comment/Name/Email）不误判', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<form><label>Comment</label><textarea name="comment"></textarea><label>Name</label><input name="author"><label>Email</label><input name="email"></form>`
		expect(mod.detectImageCaptcha(doc.querySelector('form')!)).toBe(false)
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

describe('commentVisibleOnPage', () => {
	it('body 含评论文本（含多余空白/换行）→ true', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<div>  Great   article,\nthanks   for  sharing!  </div>`
		expect(mod.commentVisibleOnPage('Great article, thanks for sharing!')).toBe(true)
	})

	it('body 不含评论文本 → false', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<div>Some unrelated content here.</div>`
		expect(mod.commentVisibleOnPage('Great article, thanks for sharing!')).toBe(false)
	})

	it('文本过短（归一化后 <6 字符）→ true（降级，不误判失败）', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<div>totally different</div>`
		expect(mod.commentVisibleOnPage('hi')).toBe(true)
	})
})

describe('executeSubmit', () => {
	it('未找到提交按钮 → not_attempted', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `<div>no form here</div>`
		const r = await mod.executeSubmit(null)
		expect(r.ok).toBe(true)
		expect(r.clicked).toBe(false)
		expect(r.verifyResult).toBe('not_attempted')
		expect(r.error).toContain('未找到提交按钮')
	})

	it('检测到 reCAPTCHA → 短路 captcha', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `
			<form id="commentform">
				<textarea id="comment"></textarea>
				<div class="g-recaptcha" data-sitekey="x"></div>
				<button type="submit">Publish</button>
			</form>`
		const r = await mod.executeSubmit('#comment')
		expect(r.clicked).toBe(false)
		expect(r.verifyResult).toBe('captcha')
	})

	it('检测到图片验证码 → 短路 captcha', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `
			<form id="commentform">
				<textarea id="comment"></textarea>
				<img src="/Captcha.ashx">
				<button type="submit">Publish</button>
			</form>`
		const r = await mod.executeSubmit('#comment')
		expect(r.clicked).toBe(false)
		expect(r.verifyResult).toBe('captcha')
	})

	it('__Captcha__ label + blob 图片（conspirazzi / Really Simple CAPTCHA）→ 短路 captcha', async () => {
		const mod = await loadModule()
		doc.body.innerHTML = `
			<form id="commentform">
				<textarea id="comment"></textarea>
				<label>__Captcha__ *</label>
				<img src="blob:http://www.conspirazzi.com/abc">
				<input name="captcha_code" type="text">
				<button type="submit">Publish</button>
			</form>`
		const r = await mod.executeSubmit('#comment')
		expect(r.clicked).toBe(false)
		expect(r.verifyResult).toBe('captcha')
		expect(r.error).toContain('验证码')
	})

	it('submit 事件 → ajax', async () => {
		vi.useFakeTimers()
		const mod = await loadModule()
		doc.body.innerHTML = `
			<form id="commentform">
				<textarea id="comment"></textarea>
				<button type="submit" id="btn">Publish</button>
			</form>`
		const p = mod.executeSubmit('#comment')
		// performClick 合成事件后 sleep(40) 再等待信号
		await vi.advanceTimersByTimeAsync(40)
		win.document.dispatchEvent(new win.Event('submit', { bubbles: true }))
		// submitDelay 150ms + ajax 后置 moderation 复核 1500ms
		await vi.advanceTimersByTimeAsync(150 + 1500)
		const r = await p
		expect(r.clicked).toBe(true)
		expect(r.verifyResult).toBe('ajax')
	})

	it('timeout 后评论框被清空 → cleared', async () => {
		vi.useFakeTimers()
		const mod = await loadModule()
		doc.body.innerHTML = `
			<form id="commentform">
				<textarea id="comment">filled</textarea>
				<button type="submit" id="btn">Publish</button>
			</form>`
		const ta = doc.getElementById('comment') as HTMLTextAreaElement
		const p = mod.executeSubmit('#comment')
		// synthetic sleep(40) + waitFor 超时 10000（无提交信号）
		await vi.advanceTimersByTimeAsync(40 + 10000)
		// timeout 后置：sleep(3000)，期间评论框被 AJAX 清空
		ta.value = ''
		await vi.advanceTimersByTimeAsync(3000)
		const r = await p
		expect(r.verifyResult).toBe('cleared')
	})
})
