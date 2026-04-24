/**
 * 目录提交 prompt 构建器。
 * 生成中文指令 prompt，指导 LLM 填写目录/列表表单。
 * 从页面提取的内容保持原文，生成内容语种与页面语种一致。
 */

import type { FormField, PageInfo, FormGroup } from '../FormAnalyzer'
import { buildFieldList } from '../FormAnalyzer'

export interface DirectorySubmitPromptInput {
  productContext: string
  pageInfo: PageInfo
  fields: FormField[]
  forms: FormGroup[]
}

export function buildDirectorySubmitPrompt(input: DirectorySubmitPromptInput): string {
  const { productContext, pageInfo, fields, forms } = input

  const fieldList = buildFieldList(fields, forms)

  const example = JSON.stringify({
    field_0: 'My Product',
    field_1: 'https://myproduct.com',
    field_2: 'A great tool for X',
    field_3: 'Detailed description here...',
  }, null, 2)

  return [
    '你正在填写一个目录/列表网站上的产品提交表单。请根据产品信息为每个字段填写合适的内容。',
    '',
    productContext,
    '',
    '## 页面上下文',
    '',
    `**标题:** ${pageInfo.title}`,
    `**描述:** ${pageInfo.description}`,
    pageInfo.headings.length > 0 ? `**标题列表:**\n${pageInfo.headings.join('\n')}` : '',
    '',
    '## 表单字段',
    '',
    fieldList,
    '',
    '## 规则',
    '',
    '1. 页面可能包含多个表单。只填写目标提交表单中的字段（上面标记为 [Form N] 的表单）。忽略标记为 "filtered" 的表单——这些是搜索栏、登录表单或新闻订阅，不应接收任何值。',
    '2. 根据字段标签和类型，将产品信息映射到对应的表单字段。',
    '3. 名称/标题字段使用产品名称，摘要字段使用简短描述，描述字段使用详细描述。',
    '4. URL 字段使用产品 URL。分类字段从产品分类中选择最佳匹配。',
    '5. 遵守 maxlength 限制——必要时进行截断。',
    '6. 填写所有必填字段。可选字段仅在有相关产品数据时才填写。',
    '7. 生成的内容语种必须与页面内容的语种保持一致。例如页面是英文，则输出英文；页面是中文，则输出中文。',
    '8. 不要编造信息。只使用产品上下文中的数据。',
    '9. 如果某个字段需要的信息在产品数据中不可用，使用空字符串。',
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
    '示例:',
    example,
  ].join('\n')
}
