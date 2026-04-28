/**
 * 博客评论 prompt 构建器。
 * 指导 LLM 生成"肯定+补充+锚文本链接"结构的高质量评论。
 * 评论正文始终包含 HTML 链接，name 字段使用随机英文姓名。
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

  const example = JSON.stringify({
    field_0: 'Sarah Mitchell',
    field_1: 'founder@example.com',
    field_2: 'https://productai.com',
    field_3: 'The latency benchmarks in your comparison are spot-on — we observed nearly identical patterns when testing edge deployment. For teams scaling inference, <a href="https://productai.com">real-time AI optimization tools</a> can cut cold-start latency by another 40%.',
  }, null, 2)

  const exampleNoUrl = JSON.stringify({
    field_0: 'Alex Chen',
    field_1: 'founder@example.com',
    field_2: 'Your breakdown of quantization tradeoffs is exactly what we needed — the accuracy loss at INT4 was the elephant in the room nobody talked about. We\'ve been exploring <a href="https://productai.com">model compression workflows</a> that balance speed and precision, and distillation came out ahead for our use case.',
  }, null, 2)

  return [
    '你正在填写博客评论表单，目的是建立反向链接。请根据页面内容和产品信息为每个字段生成合适的值。你的评论必须有真实价值，且容易被博客作者通过审核。',
    '',
    '## 硬性要求',
    '',
    '1. 评论正文中必须包含一个 HTML 锚标签，格式为：',
    '   <a href="{product_url}">{anchor_text}</a>',
    '   其中 {product_url} 和 {anchor_text} 由下方产品上下文指定。',
    '2. 绝对不能将锚文本作为纯文本输出——必须包裹在 <a> 标签内。',
    '3. 错误示范："check out real-time AI optimization tools"（纯文本，无链接）',
    '4. 正确示范："check out <a href="https://productai.com">real-time AI optimization tools</a>"',
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
    '### 一、评论内容',
    '',
    '1. 结构：肯定文章价值(~50字符) + 补充观点并自然植入锚文本链接(~50字符)，前后两段衔接过渡要自然。',
    '2. 前半段引用文章中的具体观点、数据或论点，表达真实认同——不要泛泛赞美。',
    '3. 后半段补充自己的见解，同时以 HTML 链接自然植入锚文本（同上硬性要求）：',
    '   <a href="{product_url}">{anchor_text}</a>',
    '4. 锚文本必须与周围文本语义连贯，不能是突兀的关键词堆砌。',
    '5. 评论总长度：100-300 字符。',
    '',
    '### 二、字段填写',
    '',
    '6. name/author 字段：随机生成一个常见的英文姓名（名+姓，如 "Alex Chen"、"Sarah Mitchell"）。不要使用产品名称或锚文本。',
    '7. URL/website/homepage 字段：填写产品 URL。',
    '8. email 字段：使用产品数据中的创始人邮箱，没有则留空。',
    '9. 其他字段：仅在有对应产品数据时填写。',
    '',
    '### 三、质量要求',
    '',
    '10. 生成内容的语种必须与页面内容一致。',
    '11. 禁止使用 "Great post"、"Nice article"、"Amazing" 等通用开头。',
    '12. 评论必须读起来像真实读者写的，可使用俚语，不要营销腔或 AI 腔。',
    '13. 只使用产品上下文中提供的数据，不要编造信息。',
    '',
    '### 四、表单选择',
    '',
    '14. 只填写目标评论表单（标记为 [Form N]）中的字段，忽略标记为 "filtered" 的表单。',
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
    '示例（有 URL 字段）:',
    example,
    '',
    '示例（无 URL 字段——评论正文仍包含链接）:',
    exampleNoUrl,
  ].join('\n')
}
