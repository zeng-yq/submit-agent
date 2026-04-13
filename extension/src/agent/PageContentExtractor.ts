/**
 * PageContentExtractor — extracts blog page content for blog comment prompt.
 * Runs in the content script. No LLM dependency.
 */

export interface PageContent {
  title: string;
  description: string;
  headings: string[];
  content_preview: string;
}

const MAX_CONTENT_LENGTH = 3000;

/**
 * Extract structured page content for blog comment context.
 */
export function extractPageContent(doc: Document): PageContent {
  const title = doc.title || '';

  const description =
    doc.querySelector<HTMLMetaElement>('meta[name="description"]')
      ?.content || '';

  const headings: string[] = [];
  const headingElements = doc.querySelectorAll('h1, h2, h3, h4, h5, h6');
  for (const h of headingElements) {
    const level = parseInt(h.tagName[1], 10);
    const prefix = '#'.repeat(level);
    const text = h.textContent?.trim();
    if (text) {
      headings.push(`${prefix} ${text}`);
    }
  }

  // Extract main body content
  let contentPreview = '';
  const mainEl =
    doc.querySelector('main') ||
    doc.querySelector('article') ||
    doc.querySelector('[role="main"]');

  if (mainEl) {
    contentPreview = (mainEl.textContent || '').trim().slice(0, MAX_CONTENT_LENGTH);
  } else {
    // Fallback: get body text (less ideal)
    contentPreview = (doc.body?.textContent || '').trim().slice(0, MAX_CONTENT_LENGTH);
  }

  return { title, description, headings, content_preview: contentPreview };
}
