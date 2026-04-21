import { describe, it, expect } from 'vitest'
import { detectCommentSystem } from '@/agent/form-analyzer/comment-system-detector'

function createDoc(html: string): Document {
  const doc = document.implementation.createHTMLDocument()
  doc.body.innerHTML = html
  return doc
}

describe('detectCommentSystem', () => {
  it('无评论系统时返回 null', () => {
    const doc = createDoc('<div>Hello</div>')
    expect(detectCommentSystem(doc)).toBeNull()
  })

  it('检测到 Disqus 容器', () => {
    const doc = createDoc('<div id="disqus_thread"></div>')
    const result = detectCommentSystem(doc)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('disqus')
  })

  it('检测到 Disqus iframe', () => {
    const doc = createDoc('<iframe src="https://disqus.com/embed/comments"></iframe>')
    const result = detectCommentSystem(doc)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('disqus')
  })

  it('检测到 Giscus 自定义元素', () => {
    const doc = createDoc('<giscus-widget></giscus-widget>')
    const result = detectCommentSystem(doc)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('giscus')
  })

  it('检测到 Giscus iframe', () => {
    const doc = createDoc('<iframe src="https://giscus.app/widget"></iframe>')
    const result = detectCommentSystem(doc)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('giscus')
  })

  it('检测到 Utterances iframe', () => {
    const doc = createDoc('<iframe src="https://utteranc.es/abc"></iframe>')
    const result = detectCommentSystem(doc)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('utterances')
  })

  it('检测到 Facebook Comments', () => {
    const doc = createDoc('<div class="fb-comments"></div>')
    const result = detectCommentSystem(doc)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('facebook')
  })

  it('检测到 Facebook Comments iframe', () => {
    const doc = createDoc('<iframe src="https://www.facebook.com/plugins/comments.php"></iframe>')
    const result = detectCommentSystem(doc)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('facebook')
  })

  it('多个系统同时存在时返回优先级最高的（按注册顺序）', () => {
    const doc = createDoc(`
      <div id="disqus_thread"></div>
      <iframe src="https://utteranc.es/abc"></iframe>
    `)
    const result = detectCommentSystem(doc)
    expect(result!.name).toBe('disqus')
  })

  it('检测结果包含 boost 值', () => {
    const doc = createDoc('<div id="disqus_thread"></div>')
    const result = detectCommentSystem(doc)
    expect(result!.boost).toBeGreaterThan(0)
  })
})
