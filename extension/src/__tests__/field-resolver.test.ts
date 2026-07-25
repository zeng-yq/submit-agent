import { describe, it, expect } from 'vitest'
import { pickCommentField } from '@/agent/form-analyzer/field-resolver'

describe('pickCommentField', () => {
	it('textarea 字段 → 选中（修复 effective_type==="comment" 死分支）', () => {
		// 复现用户反馈 bug：Pligg 等站点评论框是 <textarea>，而 inferEffectiveType 对
		// type!=='text' 的字段直接返回 ''（永不返回 'comment'）。旧逻辑
		// find(f => f.effective_type === 'comment') 永远 miss → commentText 恒 undefined
		// → 触发降级后门 → 无条件误判「评论已发布」。
		const fields = [
			{ type: 'text', name: 'author', id: 'author', canonical_id: 'f0' },
			{ type: 'textarea', name: 'comment_content', id: 'comment', canonical_id: 'f1' },
		]
		expect(pickCommentField(fields)?.canonical_id).toBe('f1')
	})

	it('非 textarea 但 name/id/canonical_id 含 comment|reply|message 语义 → 选中', () => {
		expect(pickCommentField([{ type: 'text', name: 'reply_text', id: '', canonical_id: 'f0' }])?.canonical_id).toBe('f0')
		expect(pickCommentField([{ type: 'text', name: 'msg', id: 'message-box', canonical_id: 'f0' }])?.canonical_id).toBe('f0')
		expect(pickCommentField([{ type: 'text', name: 'x', id: 'x', canonical_id: 'comment-field' }])?.canonical_id).toBe('comment-field')
	})

	it('仅 effective_type==="comment" 不再作为判定依据（防死分支回归）', () => {
		// inferEffectiveType 实际不会产出 'comment'；即便误标了，既非 textarea 也无语义关键词，
		// 也不应被选中——防止未来有人把 `|| f.effective_type === 'comment'` 加回来。
		const fields = [{ type: 'text', effective_type: 'comment', name: 'username', id: 'user', canonical_id: 'f0' }]
		expect(pickCommentField(fields)).toBeUndefined()
	})

	it('无评论框（纯 author/email/url）→ undefined', () => {
		const fields = [
			{ type: 'text', name: 'author', id: 'author', canonical_id: 'f0' },
			{ type: 'email', name: 'email', id: 'email', canonical_id: 'f1' },
			{ type: 'url', name: 'url', id: 'url', canonical_id: 'f2' },
		]
		expect(pickCommentField(fields)).toBeUndefined()
	})

	it('空列表 → undefined', () => {
		expect(pickCommentField([])).toBeUndefined()
	})
})
