# 产品信息模型简化设计

## 概述

简化 `ProductProfile` 数据模型，移除冗余字段，新增锚文本列表功能。

## 变更摘要

| 操作 | 字段 | 说明 |
|------|------|------|
| 删除 | `socialLinks` | 移除社交链接相关内容 |
| 删除 | `tagline` | 移除一句话描述 |
| 删除 | `shortDesc` | 移除简单描述 |
| 删除 | `categories` | 移除分类 |
| 重命名 | `longDesc` → `description` | "详细描述"改为"产品描述" |
| 新增 | `anchorTexts` | 锚文本列表，逗号分隔的字符串 |

无需数据迁移，用户手动删除旧产品并创建新产品即可。

---

## 1. 数据模型变更

**文件**: `extension/src/lib/types.ts`

```typescript
// 变更后
export interface ProductProfile {
  id: string
  name: string
  url: string
  description: string       // 原 longDesc，产品描述
  anchorTexts: string       // 逗号分隔的锚文本列表
  logoSquare?: string
  logoBanner?: string
  screenshots: string[]
  founderName: string
  founderEmail: string
  createdAt: number
  updatedAt: number
}
```

---

## 2. AI 产品分析变更

**文件**: `extension/src/lib/profile-generator.ts`

### SYSTEM_PROMPT 修改

新的 LLM 输出 JSON 结构：
```json
{
  "name": "Product Name",
  "url": "the canonical product URL",
  "description": "A 120-180 word detailed product description",
  "anchorTexts": "keyword1, keyword2, keyword3, ..."
}
```

锚文本生成规则：
- 核心关键词（3-5 个）
- 次要关键词（3-5 个）
- 潜在语义词（2-3 个）
- 长尾关键词（2-3 个）
- 用英文逗号分隔，共约 10-15 个关键词

### parseJsonResponse 修改

- 移除 `tagline`、`shortDesc`、`categories` 的提取
- `longDesc` 改为 `description`
- 新增 `anchorTexts` 的提取

### GeneratedProfile 类型

```typescript
export type GeneratedProfile = Omit<ProductProfile, 'id' | 'createdAt' | 'updatedAt' | 'screenshots' | 'founderName' | 'founderEmail' | 'logoSquare' | 'logoBanner'>
```

---

## 3. UI 表单变更

**文件**: `extension/src/components/ProductForm.tsx`

### 移除
- "一句话介绍" 输入框（tagline）
- "简单描述" 文本域（shortDesc）
- "分类" 输入（categories）
- "社交链接" 区域（社交链接部分，保留创始人信息）
- EMPTY_FORM 中移除 `tagline`、`shortDesc`、`socialLinks`、`categories`

### 修改
- "详细描述" → "产品描述"，字段从 `longDesc` 改为 `description`

### 新增
- "锚文本列表" 文本输入框（anchorTexts），放置在产品描述下方
- 辅助文本：用英文逗号分隔多个锚文本

### ExtraFields 组件
- 移除社交链接部分，仅保留创始人姓名和邮箱

---

## 4. QuickCreate 适配

**文件**: `extension/src/components/QuickCreate.tsx`

- 审核页面字段映射：移除旧字段，新增 `anchorTexts`
- `socialLinks: {}` 初始化移除

---

## 5. 产品上下文与 Prompt 变更

### product-context.ts

**文件**: `extension/src/agent/prompts/product-context.ts`

新的上下文格式：
```markdown
## 产品信息
- 名称：{name}
- URL：{url}

### 产品描述
{description}

### 锚文本列表
{anchorTexts}

### 创始人
- 姓名：{founderName}
- 邮箱：{founderEmail}
```

### directory-submit-prompt.ts

**文件**: `extension/src/agent/prompts/directory-submit-prompt.ts`

- 移除对 `shortDesc`、`categories` 的引用
- 描述字段使用产品的产品描述
- 新增规则：从锚文本列表中选取一个作为链接文本

### blog-comment-prompt.ts

**文件**: `extension/src/agent/prompts/blog-comment-prompt.ts`

- 移除对 `shortDesc` 的引用
- 新增规则：使用随机选取的锚文本作为评论中链接的文本

### 锚文本随机选取逻辑

在调用 prompt 构建函数时随机选取：
```typescript
const anchorList = product.anchorTexts.split(',').map(s => s.trim()).filter(Boolean)
const selectedAnchor = anchorList.length > 0
  ? anchorList[Math.floor(Math.random() * anchorList.length)]
  : product.name
```

---

## 6. Google Sheet 同步变更

**文件**: `extension/src/lib/sync/types.ts`

新的 `products` tab 列映射：
```typescript
products: {
  tabName: 'products',
  columns: [
    { header: 'id', key: 'id' },
    { header: 'name', key: 'name' },
    { header: 'url', key: 'url' },
    { header: 'description', key: 'description' },
    { header: 'anchorTexts', key: 'anchorTexts' },
    { header: 'logoSquare', key: 'logoSquare' },
    { header: 'logoBanner', key: 'logoBanner' },
    { header: 'screenshots', key: 'screenshots', encode: 'json' },
    { header: 'founderName', key: 'founderName' },
    { header: 'founderEmail', key: 'founderEmail' },
    { header: 'createdAt', key: 'createdAt', encode: 'date' },
    { header: 'updatedAt', key: 'updatedAt', encode: 'date' },
  ],
},
```

`serializer.ts` 无需修改，通用序列化逻辑已支持。

---

## 7. 选项页变更

**文件**: `extension/src/entrypoints/options/App.tsx`

- 移除产品卡片中的分类徽章（Badge）显示
- 移除产品卡片中的 tagline（标语）显示

---

## 影响文件清单

| 文件 | 变更类型 |
|------|----------|
| `extension/src/lib/types.ts` | 修改接口定义 |
| `extension/src/components/ProductForm.tsx` | 修改表单 UI |
| `extension/src/lib/profile-generator.ts` | 修改 AI 生成逻辑 |
| `extension/src/agent/prompts/product-context.ts` | 修改上下文构建 |
| `extension/src/agent/prompts/directory-submit-prompt.ts` | 修改目录提交 prompt |
| `extension/src/agent/prompts/blog-comment-prompt.ts` | 修改博客评论 prompt |
| `extension/src/lib/sync/types.ts` | 修改 Sheet 列映射 |
| `extension/src/components/QuickCreate.tsx` | 适配新字段 |
| `extension/src/entrypoints/options/App.tsx` | 移除分类显示 |
| `extension/src/agent/FormFillEngine.ts` | 新增锚文本随机选取逻辑 |
