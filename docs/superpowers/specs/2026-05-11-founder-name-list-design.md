# 创始人姓名支持多值随机选取

## 背景

当前 `founderName` 是单个字符串，每次提交外链时使用相同的姓名。锚文本 (`anchorTexts`) 已支持逗号分隔的多值列表，提交时随机选取一个。需要让创始人姓名也具备同样的能力。

## 设计决策

- **方案选择**：复用 `anchorTexts` 的逗号分隔字符串模式，不引入数据库迁移
- **向后兼容**：单个姓名的旧数据无需任何处理，`split(',')` 返回单元素数组

## 涉及文件

| 文件 | 改动 |
|------|------|
| `extension/src/agent/prompts/product-context.ts` | 新增 `pickFounderName()` |
| `extension/src/components/ProductForm.tsx` | founderName 输入改为 Textarea |
| `extension/src/agent/prompts/blog-comment-prompt.ts` | 使用选中的姓名 |
| `extension/src/agent/FormFillEngine.ts` | 调用 `pickFounderName()` |
| 测试文件 | 覆盖新逻辑 |

## 数据模型

`founderName` 字段类型不变（string），语义从"单个姓名"变为"逗号分隔的姓名列表"。

## 核心逻辑

```ts
export function pickFounderName(product: ProductProfile): string {
  const list = product.founderName.split(',').map(s => s.trim()).filter(Boolean)
  return list.length > 0
    ? list[Math.floor(Math.random() * list.length)]
    : ''
}
```

- 空字符串 → 返回空字符串
- 单个名字 → `split(',')` 产生单元素数组，返回该名字
- 多个名字 → 随机选取一个

## 提交流程变更

`FormFillEngine.ts` 中：

1. 调用 `pickFounderName(product)` 得到随机姓名
2. 将选中姓名传入 prompt 构建
3. blog-comment-prompt 使用选中的姓名（非完整列表）

## UI 变更

`ProductForm.tsx` 中 `founderName` 字段：

- 从 `<Input>` 改为 `<Textarea>`
- placeholder：`"张三, John Doe, 李四"`
- label：`"创始人姓名（用英文逗号分隔）"`

## 测试

- `pickFounderName()` 单值、多值、空值场景
- UI 渲染为 Textarea
