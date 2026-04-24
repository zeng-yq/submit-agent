# Prompt 模板中文化设计

**日期**: 2026-04-24
**状态**: 已批准

## 背景

当前发送给 LLM 的 prompt 模板全部为英文。需要将其改为中文模板，同时保持从页面提取的内容（产品数据、页面信息、表单字段）使用原文。生成的内容语种应与当前提交页面的语种保持一致。

## 范围

### 修改文件

| 文件 | 说明 |
|------|------|
| `extension/src/agent/prompts/directory-submit-prompt.ts` | 目录提交 prompt 模板 |
| `extension/src/agent/prompts/blog-comment-prompt.ts` | 博客评论 prompt 模板 |

### 不修改文件

| 文件 | 原因 |
|------|------|
| `extension/src/agent/prompts/product-context.ts` | 产品上下文保持原有格式 |
| `extension/src/lib/profile-generator.ts` | 产品资料生成独立流程，保持原样 |

## 设计细节

### 1. directory-submit-prompt.ts

**改动**：
- 角色指令从英文改为中文
- 页面上下文标题从 `Page Context` 改为 `页面上下文`
- 表单字段标题从 `Form Fields` 改为 `表单字段`
- 规则标题从 `Rules` 改为 `规则`，所有 9 条规则翻译为中文
- 关键规则修改：第 7 条从 `"Use English unless the page content indicates another language."` 改为 `"生成的内容语种必须与页面内容的语种保持一致。例如页面是英文，则输出英文；页面是中文，则输出中文。"`
- 输出格式标题从 `Output Format` 改为 `输出格式`，说明翻译为中文

**保持不变**：
- 函数签名 `buildDirectorySubmitPrompt(input: DirectorySubmitPromptInput): string`
- 接口 `DirectorySubmitPromptInput`
- `buildFieldList` 调用
- 示例 JSON 结构
- `productContext`、`pageInfo`、`fieldList` 的原文数据

### 2. blog-comment-prompt.ts

**改动**：
- 角色指令从英文改为中文
- 页面内容标题从 `Page Content` 改为 `页面内容`
- 表单字段标题从 `Form Fields` 改为 `表单字段`
- 规则标题从 `Rules` 改为 `规则`，所有 10 条规则翻译为中文
- 关键规则修改：第 8 条从 `"All text should be in the same language as the page content."` 改为 `"生成的内容语种必须与页面内容的语种保持一致。例如页面是英文，则输出英文评论；页面是中文，则输出中文评论。"`
- 评论质量要求翻译为中文（包括禁止通用开头、长度限制、真人风格等）
- 链接放置优先级说明翻译为中文
- 输出格式标题从 `Output Format` 改为 `输出格式`，说明翻译为中文

**保持不变**：
- 函数签名 `buildBlogCommentPrompt(input: BlogCommentPromptInput): string`
- 接口 `BlogCommentPromptInput`
- `buildFieldList` 调用
- 示例 JSON 结构和 HTML 链接格式
- `productContext`、`pageContent`、`fieldList` 的原文数据

### 3. 语言检测策略

保持现有方案：由 LLM 根据提取到的页面内容（标题、描述、正文预览）自行判断页面语种，然后在生成内容时匹配该语种。不在代码中添加显式的语言检测逻辑。

## 约束

- 提取的页面内容和产品数据始终保持原文传入，不做翻译
- 示例 JSON 中的注释和标签保持英文（因为是技术性参考）
- `canonical_id` 等技术标识符保持不变
- 不修改函数签名和类型接口
- 不修改 `buildFieldList` 的输出格式
