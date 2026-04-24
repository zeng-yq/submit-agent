/**
 * 博客评论 prompt 构建器。
 * 生成中文指令 prompt，指导 LLM 撰写带有反向链接的相关评论。
 * 从页面提取的内容保持原文，生成内容语种与页面语种一致。
 */

import type { PageContent } from '../PageContentExtractor'
import type { FormField, FormGroup } from '../FormAnalyzer'
import { buildFieldList } from '../FormAnalyzer'

export interface BlogCommentPromptInput {
  productContext: string
  pageContent: PageContent
  fields: FormField[]
  forms: FormGroup[]
}

export function buildBlogCommentPrompt(input: BlogCommentPromptInput): string {
  const { productContext, pageContent, fields, forms } = input

  const fieldList = buildFieldList(fields, forms)

  const exampleWithUrl = JSON.stringify({
    field_0: 'ProductAI',
    field_1: 'founder@example.com',
    field_2: 'https://productai.com',
    field_3: 'Great insights on AI adoption! The section about latency reduction really resonated with our experience — we\'ve seen similar improvements when deploying edge inference.',
  }, null, 2)

  const exampleFallback = JSON.stringify({
    field_0: 'Alex',
    field_1: 'founder@example.com',
    field_2: 'Really appreciate the breakdown of inference optimization strategies. We\'ve been tackling similar challenges at <a href="https://productai.com" rel="dofollow">ProductAI</a> and found that model distillation works even better than quantization for our use case.',
  }, null, 2)

  return [
    '你正在填写博客评论表单，目的是建立反向链接。请根据页面内容和产品信息为每个字段生成合适的值。你的评论必须有真实价值，且容易被博客作者通过审核。',
    '',
    productContext,
    '',
    '## 页面内容',
    '',
    `**标题:** ${pageContent.title}`,
    `**描述:** ${pageContent.description}`,
    pageContent.headings.length > 0 ? `**标题列表:**\n${pageContent.headings.join('\n')}` : '',
    '**内容预览:**',
    pageContent.content_preview,
    '',
    '## 表单字段',
    '',
    fieldList,
    '',
    '## 规则',
    '',
    '1. 页面可能包含多个表单。只填写目标评论表单中的字段（上面标记为 [Form N] 的表单）。忽略标记为 "filtered" 的表单——这些是无关表单，不应接收任何值。评论和个人信息仅填写到评论表单中。',
    '2. 仔细阅读页面内容，撰写相关的、听起来真实的评论（不要泛泛的赞美）。',
    '3. 评论结构：约 30 个字符的真实价值肯定 + 约 50 个字符的补充见解。自然地将产品名称或相关关键词融入评论中。',
    '4. 链接放置优先级（按以下顺序）:',
    '   - 首选：有 "URL" / "website" / "homepage" 字段 → 直接填入产品 URL。',
    '   - 次选：有 "name" / "author" 字段 → 如果产品数据中有"本次使用的锚文本"，使用该锚文本作为显示名称；否则使用产品名称。',
    '   - 备选：如果既没有 URL/website 字段，也没有 name/author 字段，则在评论正文中使用 HTML 放置链接：`<a href="{product_url}" rel="dofollow">{anchor_text}</a>`。链接文字使用产品数据中提供的"本次使用的锚文本"（如果有的话），必须与评论内容语义连贯。',
    '5. 如果在评论正文中放置链接（仅限备选方案）:',
    '   - 使用 HTML 格式：`<a href="{product_url}" rel="dofollow">{keyword}</a>`',
    '   - 锚文本必须与周围评论文本自然关联',
    '   - 不要使用 "最好的工具"、"必须尝试"、"强烈推荐" 等推广性措辞',
    '6. "email" 字段：如果产品数据中有创始人邮箱则使用，否则留空。',
    '7. 填写所有必填字段。可选字段仅在有相关产品数据时才填写。',
    '8. 生成的内容语种必须与页面内容的语种保持一致。例如页面是英文，则输出英文评论；页面是中文，则输出中文评论。',
    '9. 评论必须让人感觉是真实的贡献——不要发垃圾评论、泛泛的赞美或明显的推广。目标是让评论被博客作者审核通过。',
    '10. 评论质量要求:',
    '    - 必须引用页面内容中的具体概念、论点或示例',
    '    - 禁止使用以下开头："Great post"、"Nice article"、"Wonderful content"、"Amazing"、"Excellent" 等通用开头',
    '    - 评论正文中产品名称最多出现一次',
    '    - 链接锚文本（使用备选 HTML 链接时）必须是自然短语，不能是精确的产品名称或 URL',
    '    - 长度：最少 80 个字符，最多 300 个字符（不含 HTML 标签）',
    '    - 必须读起来像真实读者写的，而不是营销人员或 AI',
    '',
    '## 输出格式',
    '',
    '仅返回一个 JSON 对象。键必须是上面列出的 canonical_id 值。',
    '不要使用字段标签、名称或其他标识符作为键。不要添加额外字段。',
    '',
    '要求:',
    '- 上面列出的每个字段都必须有对应的键，即使值为空字符串 ""',
    '- 需要跳过的字段使用空字符串 ""——不要省略该键',
    '- 有 maxlength 限制的字段：按字符计数，在限制处截断',
    '- 永远不要使用 null 或 undefined 作为值',
    '',
    '格式: { "<canonical_id>": "<value>", ... }',
    '',
    '示例（有 URL 字段——评论正文不含链接）:',
    exampleWithUrl,
    '',
    '示例（无 URL 字段——评论正文包含备选链接）:',
    exampleFallback,
  ].join('\n')
}
