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
