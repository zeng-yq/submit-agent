# 设计文档：使用创始人姓名替代随机生成的姓名

## 背景

在外链提交（blog_comment 类型）过程中，遇到表单中的姓名字段时，当前行为是由 LLM 随机生成一个英文姓名。这不利于 SEO，因为使用一致的创始人姓名有助于建立品牌关联。

## 目标

将 blog_comment 场景下姓名字段的填写内容，从随机生成的姓名改为使用产品信息中的创始人姓名（`founderName`）。

## 改动范围

仅修改 `extension/src/agent/prompts/blog-comment-prompt.ts`。

### 变更 1：姓名字段指令

**位置**：第 111 行
**当前**：
```
9. name/author 字段：随机生成一个常见的英文姓名（名+姓，如 "Alex Chen"、"Sarah Mitchell"）。不要使用产品名称或锚文本。
```

**改为**：
```
9. name/author 字段：使用产品数据中的创始人姓名。不要使用产品名称或锚文本。
```

### 变更 2：JSON 示例中的姓名

**位置**：第 23-34 行的示例 JSON
**当前**：使用硬编码的随机姓名 `Sarah Mitchell` 和 `Alex Chen`
**改为**：使用 `John Smith` 作为通用示例（仅作为示例用途，实际填写时 LLM 会使用产品数据中的创始人姓名）

## 不受影响的部分

- `directory-submit-prompt.ts`：目录提交场景不受影响
- `product-context.ts`：已将 `founderName` 传入 LLM prompt，无需修改
- 表单填写引擎、DOM 操作等：无需修改
- 数据结构（`ProductProfile`）：已有 `founderName` 字段，无需修改

## 前提条件

用户已在产品信息中填写了创始人姓名（`founderName` 不为空）。根据用户确认，该字段不会为空。
