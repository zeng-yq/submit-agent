import type { CommentLinkResult } from './types'

const EXTERNAL_LINK_DOMAIN_THRESHOLD = 5;

const COMMENT_CONTAINER_SELECTORS = [
  '#comments',
  '.comments-area',
  '.comments',
  '#comment-list',
  '.comment-list',
];

const COMMENT_META_SELECTORS = [
  '.reply',
  '.comment-reply',
  '.comment-meta',
  '.comment-metadata',
  '.comment-author',
  '.vcard',
  '.says',
  '.must-log-in',
  'nav',
  '.navigation',
  '.nav-links',
  '.comment-navigation',
  '.comment-reply-login',
  '.comment-actions',
  '.blog-admin',
  '.comment-replybox-single',
].join(', ');

/**
 * Detect external links within comment sections.
 */
export function detectCommentLinks(doc: Document): CommentLinkResult {
  let container: Element | null = null;
  for (const selector of COMMENT_CONTAINER_SELECTORS) {
    container = doc.querySelector(selector);
    if (container) break;
  }

  if (!container) {
    return { hasExternalLinks: false, uniqueDomains: 0, totalLinks: 0 };
  }

  const pageHostname = doc.location.hostname;

  const allLinks = container.querySelectorAll('a[href]');
  const externalDomains = new Set<string>();
  let totalLinks = 0;

  for (const link of allLinks) {
    if (link.closest(COMMENT_META_SELECTORS)) continue;

    const href = (link as HTMLAnchorElement).href;
    if (!href.startsWith('http:') && !href.startsWith('https:')) continue;

    try {
      const url = new URL(href, doc.location.href);
      if (url.hostname === pageHostname) continue;
      externalDomains.add(url.hostname);
      totalLinks++;
    } catch {
      // Invalid URL, skip
    }
  }

  return {
    hasExternalLinks: externalDomains.size >= EXTERNAL_LINK_DOMAIN_THRESHOLD,
    uniqueDomains: externalDomains.size,
    totalLinks,
  };
}
