# 博客评论 Prompt 优化设计

**日期**: 2026-04-25
**状态**: 待审核
**涉及文件**: `extension/src/agent/prompts/blog-comment-prompt.ts`

## 背景

当前博客评论 prompt 存在以下问题：
- 链接放置策略混乱：有 URL 字段时正文不放链接，没有时才放——导致 LLM 行为不一致
- name 字段策略与实际需求不符：当前用锚文本作为 name，实际需要随机假名
- 评论质量不稳定：评论结构不明确，LLM 输出模板不固定
- 规则之间存在矛盾（如"正文不放链接"vs"备选方案放链接"）

## 目标

重写 `blog-comment-prompt.ts` 的规则部分，使 LLM 稳定生成高质量评论：
- 评论正文始终包含 HTML 链接
- 链接锚文本在后段自然融入
- name 字段用随机英文姓名
- 评论结构固定为"肯定+补充+链接"

## 设计

### 1. 评论结构模板

```
[肯定文章价值](~30字符) + [补充观点 + 自然植入锚文本链接](~50字符)
```

- 前半段：引用文章具体观点/数据/论点，表达真实认同
- 后半段：补充见解，锚文本以 HTML 链接自然融入
- 链接格式：`<a href="{product_url}" rel="dofollow">{anchor_text}</a>`
- 总长度：80-300 字符（不含 HTML 标签）

### 2. 字段填写策略

| 字段类型 | 填写策略 |
|---------|---------|
| comment 正文 | 始终包含 HTML 链接，结构为"肯定+补充+锚文本" |
| URL/website/homepage | 填产品 URL（如有此字段） |
| name/author | LLM 随机生成"英文名+姓氏"格式（如 "Alex Chen"） |
| email | 用创始人邮箱，没有则留空 |
| 其他 | 仅在有对应产品数据时填写 |

### 3. 新规则文本

替代当前规则 1-10，分为四个清晰分组：

```
## 规则

### 一、评论内容
1. 结构：肯定文章价值(~30字符) + 补充观点并自然植入锚文本链接(~50字符)。
2. 前半段引用文章中的具体观点、数据或论点，表达真实认同——不要泛泛赞美。
3. 后半段补充自己的见解，同时以 HTML 链接自然植入锚文本：
   <a href="{product_url}" rel="dofollow">{anchor_text}</a>
4. 锚文本必须与周围文本语义连贯，不能是突兀的关键词堆砌。
5. 评论总长度：80-300 字符（不含 HTML 标签）。

### 二、字段填写
6. name/author 字段：随机生成一个常见的英文姓名（名+姓，如 "Alex Chen"、"Sarah Mitchell"）。不要使用产品名称或锚文本。
7. URL/website/homepage 字段：填写产品 URL。
8. email 字段：使用产品数据中的创始人邮箱，没有则留空。
9. 其他字段：仅在有对应产品数据时填写。

### 三、质量要求
10. 生成内容的语种必须与页面内容一致。
11. 禁止使用 "Great post"、"Nice article"、"Amazing" 等通用开头。
12. 评论必须读起来像真实读者写的，不要营销腔或 AI 腔。
13. 只使用产品上下文中提供的数据，不要编造信息。

### 四、表单选择
14. 只填写目标评论表单（标记为 [Form N]）中的字段，忽略标记为 "filtered" 的表单。
```

### 4. 示例更新

更新现有示例以匹配新策略：

**示例（标准评论）:**
```json
{
  "field_0": "Sarah Mitchell",
  "field_1": "founder@example.com",
  "field_2": "https://productai.com",
  "field_3": "The latency benchmarks in your comparison are spot-on — we observed nearly identical patterns when testing edge deployment. For teams scaling inference, <a href=\"https://productai.com\" rel=\"dofollow\">real-time AI optimization tools</a> can cut cold-start latency by another 40%."
}
```

**示例（无 URL 字段）:**
```json
{
  "field_0": "Alex Chen",
  "field_1": "founder@example.com",
  "field_2": "Your breakdown of quantization tradeoffs is exactly what we needed — the accuracy loss at INT4 was the elephant in the room nobody talked about. We've been exploring <a href=\"https://productai.com\" rel=\"dofollow\">model compression workflows</a> that balance speed and precision, and distillation came out ahead for our use case."
}
```

### 5. 保持不变的部分

以下内容不做修改：
- `product-context.ts` — 产品上下文构建逻辑
- `FormFillEngine.ts` — 调用逻辑（siteType 判断、LLM 调用、结果解析）
- `llm-utils.ts` — LLM 调用工具
- `PageContentExtractor.ts` — 页面内容提取
- `field-list-builder.ts` — 字段列表构建
- 输出格式部分 — JSON 输出格式保持不变
- user prompt — 保持不变

## 改动范围

仅修改一个文件：`extension/src/agent/prompts/blog-comment-prompt.ts`

改动内容：
1. 重写规则部分（第 53-76 行）为新的 14 条分组规则
2. 更新示例（第 23-34 行、第 92-95 行）以匹配新策略
3. 删除旧的链接放置优先级（规则 4）和备选方案逻辑

## 风险评估

- **低风险**：改动仅涉及 prompt 文本，不改变任何 TypeScript 逻辑
- **可回滚**：单文件改动，git revert 即可
- **测试**：修改后运行 `npm run build` 确认编译通过
