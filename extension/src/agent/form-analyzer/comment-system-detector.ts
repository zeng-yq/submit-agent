import type { CommentSystemResult } from './types'

interface CommentSystemDetector {
  name: string
  selectors: string[]
  boost: number
}

const COMMENT_SYSTEM_DETECTORS: CommentSystemDetector[] = [
  {
    name: 'disqus',
    selectors: ['#disqus_thread', 'iframe[src*="disqus.com"]'],
    boost: 0.20,
  },
  {
    name: 'giscus',
    selectors: ['giscus-widget', 'iframe[src*="giscus.app"]'],
    boost: 0.20,
  },
  {
    name: 'utterances',
    selectors: ['iframe[src*="utteranc.es"]'],
    boost: 0.20,
  },
  {
    name: 'facebook',
    selectors: ['.fb-comments', 'iframe[src*="facebook.com/plugins/comments"]'],
    boost: 0.15,
  },
  {
    name: 'blogger',
    selectors: [
      'iframe#comment-editor[src*="blogger.com/comment"]',
      'iframe.blogger-comment-from-post',
      'iframe[src*="blogger.com/comment/frame"]',
    ],
    boost: 0.15,
  },
  {
    name: 'jetpack',
    selectors: [
      'iframe[name="jetpack_remote_comment"]',
      'iframe[src*="jetpack.wordpress.com/jetpack-comment"]',
      'iframe.jetpack_remote_comment',
    ],
    boost: 0.15,
  },
]

export function detectCommentSystem(doc: Document): CommentSystemResult | null {
  for (const detector of COMMENT_SYSTEM_DETECTORS) {
    for (const selector of detector.selectors) {
      if (doc.querySelector(selector)) {
        return { name: detector.name, boost: detector.boost }
      }
    }
  }
  return null
}

/**
 * 远程 iframe 评论系统：字段在跨域 iframe 内，主文档读不到，
 * 需通过 postMessage 让 iframe 内 content script 分析/填充。
 * name → iframe 宿主 hostname 片段。
 */
const REMOTE_COMMENT_IFRAME_SYSTEMS: Record<string, string> = {
  blogger: 'blogger.com',
  jetpack: 'jetpack.wordpress.com',
}

/** 远程评论 iframe 选择器（主页面侧定位跨域评论 iframe 元素用），从 detector 派生避免重复 */
export const REMOTE_COMMENT_IFRAME_SELECTORS = COMMENT_SYSTEM_DETECTORS
  .filter((d) => d.name in REMOTE_COMMENT_IFRAME_SYSTEMS)
  .flatMap((d) => d.selectors)
  .join(', ')

/** 判断 hostname 是否为需启用 iframe 通信 handler 的远程评论 iframe 宿主 */
export function isRemoteCommentIframeHost(hostname: string): boolean {
  if (!hostname) return false
  return Object.values(REMOTE_COMMENT_IFRAME_SYSTEMS).some((h) => hostname.includes(h))
}

/** 判断 commentSystem name 是否为远程 iframe 评论系统（需走 iframe 通信分支） */
export function isRemoteCommentSystem(name: string | undefined): boolean {
  return !!name && name in REMOTE_COMMENT_IFRAME_SYSTEMS
}
