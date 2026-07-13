/**
 * comment-submit — 博客评论自动提交 + 弱验证（纯 DOM 模块）。
 * 从 autoComment 搬运、改写为 TypeScript，适配 submit-agent 的 selector 体系。
 * 不 import chrome，可在 jsdom 单测；由 content.ts 的 submit case 调用。
 */

/** 判断 URL 是否可能是评论表单提交地址（排除静态资源/analytics/wp-admin） */
export function isFormSubmitUrl(url: string | URL): boolean {
	if (!url) return false
	const s = String(url).toLowerCase()
	const excludePatterns = [
		/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|webp|mp4|webm|ogg|mp3|wav|zip|tar|gz)$/,
		/google-analytics|googletagmanager|doubleclick|facebook\.com\/tr|analytics|tracking|pixel/i,
		/\/wp-admin\/admin-ajax/,
	]
	for (const p of excludePatterns) {
		if (p.test(s)) return false
	}
	return true
}

/** 多语种提交关键词 */
const SUBMIT_KEYWORDS = [
	'submit', 'post', 'comment', 'publish', 'reply', 'respond', 'send',
	'publicar', 'responder', 'enviar', 'comentar', 'anzeigen', 'absenden',
	'提交', '评论', '发送', '发表', '回答', '返信',
]

/** 在指定 form 内查找提交按钮 */
export function findSubmitButtonInForm(form: HTMLFormElement | null): HTMLElement | null {
	if (!form) return null

	// 方法 1：WP / wpDiscuz 标准选择器
	const wpSelectors = [
		'#submit', '#submit-btn', '#publish', '#wp-submit',
		'input[type="submit"]#submit', '.submit', '[name="submit"]',
		'.wpd-submit-btn', '.wpdiscuz-submit-btn', '.wpd-button',
		'button[class*="wpdiscuz"]', '.wc_comment_submit',
	]
	for (const sel of wpSelectors) {
		try {
			const btn = form.querySelector<HTMLElement>(sel)
			if (btn) return btn
		} catch { /* 无效选择器，跳过 */ }
	}

	// 方法 2：显式 submit 类元素（含 button 无 type，默认 submit）
	const candidates = Array.from(form.querySelectorAll<HTMLElement>(
		'button[type="submit"], button:not([type]), input[type="submit"], input[type="image"], [role="submit"]'
	))
	// 优先返回命中关键词的
	for (const btn of candidates) {
		const text = `${btn.getAttribute('value') ?? ''} ${btn.className ?? ''} ${btn.id ?? ''} ${btn.textContent ?? ''}`.toLowerCase()
		if (SUBMIT_KEYWORDS.some(k => text.includes(k))) return btn
	}
	if (candidates.length > 0) return candidates[0]

	// 方法 3：button/input[type=button] 文本关键词
	const allButtons = Array.from(form.querySelectorAll<HTMLElement>('button, input[type="button"]'))
	for (const btn of allButtons) {
		const text = `${btn.textContent ?? (btn as HTMLInputElement).value ?? ''} ${btn.className ?? ''} ${btn.id ?? ''}`.toLowerCase()
		if (SUBMIT_KEYWORDS.some(k => text.includes(k))) return btn
	}
	// 方法 4：表单只有一个按钮
	if (allButtons.length === 1) return allButtons[0]

	return null
}

/** 从评论框 selector（或 WP form 选择器兜底）定位 form + 提交按钮 */
export function resolveSubmitButton(commentSelector: string | null): {
	form: HTMLFormElement | null
	button: HTMLElement | null
} {
	// 优先：用评论框找同表单
	if (commentSelector) {
		const ta = document.querySelector<HTMLElement>(commentSelector)
		if (ta) {
			const form = (ta as HTMLTextAreaElement).form
				|| (ta.closest('form') as HTMLFormElement | null)
			if (form) {
				const btn = findSubmitButtonInForm(form)
				if (btn) return { form, button: btn }
			}
		}
	}

	// 兜底：WP 标准 form 选择器
	const formSelectors = [
		'#commentform', '.comment-form', 'form[name="commentform"]',
		'form[action*="wp-comments-post.php"]', 'form[id*="comment"]',
	]
	for (const sel of formSelectors) {
		const form = document.querySelector<HTMLFormElement>(sel)
		if (form) {
			const btn = findSubmitButtonInForm(form)
			if (btn) return { form, button: btn }
		}
	}

	// 兜底：评论区域内找 form
	const areaSelectors = ['#comments', '#respond', '.comment-respond', '.comments-area']
	for (const sel of areaSelectors) {
		const area = document.querySelector(sel)
		if (area) {
			const form = (area.querySelector('form') || area.closest('form')) as HTMLFormElement | null
			if (form) {
				const btn = findSubmitButtonInForm(form)
				if (btn) return { form, button: btn }
			}
		}
	}

	return { form: null, button: null }
}
