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
    field_3: 'finally someone actually benchmarked this properly — the cold-start numbers at the edge match what we saw last quarter. been using <a href="https://productai.com">these inference optimizers</a> for similar workloads and the difference is honestly night and day.',
  }, null, 2)

  const exampleNoUrl = JSON.stringify({
    field_0: 'Alex Chen',
    field_1: 'founder@example.com',
    field_2: 'that INT4 accuracy drop was exactly what we hit too — nobody talks about it but it\'s real. we ended up going with <a href="https://productai.com">model compression tools</a> + distillation instead and honestly it just worked better for our scale.',
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
    '## 评论写作规范',
    '',
    '### 你是一个真实读者，不是 AI 助手',
    '',
    '想象你是在 Hacker News、Reddit 或 Twitter 上回复帖子——随意、直接、有个人观点。你不是在写摘要或读后感，而是在跟帖讨论。',
    '',
    '### 写作风格',
    '',
    '1. **口语化表达**：用日常说话的方式写，而不是书面语。',
    '   - 中文：用"说实话"、"感觉"、"挺有意思的"、"之前也踩过这个坑"、"这确实是个问题"等口语词汇。',
    '   - 英文：用 "honestly"、"tbh"、"fair point"、"ran into this too"、"pretty solid" 等日常用语。',
    '   - 繁体中文/日文等其他语言：同样使用当地网络评论的口语风格。',
    '2. **句式要短、要有断裂感**：真人评论不会一逗到底。适当用短句、省略主语、用破折号做插入。',
    '3. **可以不完美**：允许省略标点、首字母小写（英文）、使用缩写（如 "tbh"、"imo"、"ngl"）。这些是真人评论的标志。',
    '4. **有态度**：可以表达赞同、惊讶、吐槽，但不要过度。语气像朋友之间聊天。',
    '',
    '### 结构要求',
    '',
    '5. 评论由一两个自然段组成，总长度 100-300 字符。',
    '6. 引用文章中的具体观点、数据或论点——不要泛泛而谈。用自己的话复述，不要用"这篇文章深入浅出"之类的套话。',
    '7. 在评论中自然植入锚文本链接（同上硬性要求）：',
    '   <a href="{product_url}">{anchor_text}</a>',
    '   链接要像顺嘴提到一样，不能是广告推销口吻。',
    '8. 锚文本必须与周围文本语义连贯，不能是突兀的关键词堆砌。',
    '',
    '### 绝对禁止（AI 腔调黑名单）',
    '',
    '以下表达会让评论立刻暴露为 AI 生成，严禁使用：',
    '- "这篇文章/这篇博文/本篇文章深入浅出/全面/详细地…"',
    '- "作为一個…的專業人士/从业者/爱好者，我认为…"',
    '- "值得一提的是/不可忽视的是/令人深思的是"',
    '- "总的来说/综上所述/总而言之"',
    '- "充满期待/令人印象深刻/值得借鉴"',
    '- "不仅…而且/既能…又能"',
    '- "从…的角度来看/从…层面来说"',
    '- "为我提供了宝贵的见解/给了我很大的启发"',
    '- 任何四字成语的堆砌（如"深入浅出、条理清晰、受益匪浅"）',
    '- 英文的 "As a [role]…"、"This article provides…"、"It\'s worth noting that…"、"I couldn\'t agree more"',
    '',
    '### 好评论 vs 坏评论',
    '',
    '坏（AI 腔）：',
    '"這篇文章深入淺出地介紹了AI公仔，以及它們在教育、情感陪伴和娛樂方面的應用。對AI公仔的未來展望也讓人充滿期待。作為一個長期關注數據分析的專業人士，我認為在衡量AI公仔的實際應用價值時，可以借助類似<a href="...">excel file checker</a>的工具，來比較不同AI公仔的數據表現和功能差異，從而做出更明智的選擇。"',
    '',
    '好（真人感）：',
    '"ai公仔在教育場景那塊挺有意思的，之前看過幾個case確實有效果。不過說到比較不同產品的數據，我用過一個<a href="...">excel file checker</a>還挺好使的，能直接對比幾個維度的差異"',
    '',
    '### 字段填写',
    '',
    '9. name/author 字段：随机生成一个常见的英文姓名（名+姓，如 "Alex Chen"、"Sarah Mitchell"）。不要使用产品名称或锚文本。',
    '10. URL/website/homepage 字段：填写产品 URL。',
    '11. email 字段：使用产品数据中的创始人邮箱，没有则留空。',
    '12. 其他字段：仅在有对应产品数据时填写。',
    '',
    '### 其他要求',
    '',
    '13. 生成内容的语种必须与页面内容一致。',
    '14. 只使用产品上下文中提供的数据，不要编造信息。',
    '15. 只填写目标评论表单（标记为 [Form N]）中的字段，忽略标记为 "filtered" 的表单。',
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
