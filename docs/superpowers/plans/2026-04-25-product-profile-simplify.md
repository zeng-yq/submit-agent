# 产品信息模型简化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 简化 `ProductProfile` 数据模型——删除 `socialLinks`/`tagline`/`shortDesc`/`categories`，重命名 `longDesc` → `description`，新增 `anchorTexts` 锚文本列表字段，并更新所有关联代码（AI 生成、UI 表单、prompt 模板、Google Sheet 同步）。

**Architecture:** 自底向上修改——先改类型定义，再改 AI 生成器和解析逻辑，然后改 UI 表单，接着改 prompt 和上下文构建，最后改 Google Sheet 同步和选项页展示。每一步完成后执行 `npm run build` 确保编译通过。

**Tech Stack:** TypeScript, React, WXT (浏览器扩展框架), IndexedDB (idb), Vitest

---

## File Structure

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `extension/src/lib/types.ts` | 核心类型定义——删除 4 字段，重命名 1 字段，新增 1 字段 |
| 修改 | `extension/src/lib/profile-generator.ts` | AI 生成器——更新 SYSTEM_PROMPT、parseJsonResponse、GeneratedProfile 类型 |
| 修改 | `extension/src/components/ProductForm.tsx` | 表单 UI——移除旧字段输入，新增锚文本输入，更新 ExtraFields |
| 修改 | `extension/src/components/QuickCreate.tsx` | 快速创建——适配新字段映射 |
| 修改 | `extension/src/agent/prompts/product-context.ts` | 产品上下文——重写 buildProductContext |
| 修改 | `extension/src/agent/prompts/directory-submit-prompt.ts` | 目录提交 prompt——更新规则 |
| 修改 | `extension/src/agent/prompts/blog-comment-prompt.ts` | 博客评论 prompt——新增锚文本规则 |
| 修改 | `extension/src/agent/FormFillEngine.ts` | 表单填写引擎——新增锚文本随机选取并传入 prompt |
| 修改 | `extension/src/lib/sync/types.ts` | Google Sheet 列映射——更新 products 列定义 |
| 修改 | `extension/src/entrypoints/options/App.tsx` | 选项页——移除 tagline 显示和分类徽章 |

---

### Task 1: 修改类型定义

**Files:**
- Modify: `extension/src/lib/types.ts:1-18`

- [ ] **Step 1: 修改 ProductProfile 接口**

将 `extension/src/lib/types.ts` 中第 1-18 行替换为：

```typescript
/** Product profile stored in IndexedDB. User fills this once, agent uses it for every submission. */
export interface ProductProfile {
	id: string
	name: string
	url: string
	description: string
	anchorTexts: string
	logoSquare?: string
	logoBanner?: string
	screenshots: string[]
	founderName: string
	founderEmail: string
	createdAt: number
	updatedAt: number
}
```

- [ ] **Step 2: 验证编译**

Run: `cd extension && npm run build`
Expected: 编译失败，报错指向所有引用旧字段名的地方。这是预期行为，记录报错文件数量以确认影响范围。

- [ ] **Step 3: Commit**

```bash
git add extension/src/lib/types.ts
git commit -m "refactor: 简化 ProductProfile 接口——删除 socialLinks/tagline/shortDesc/categories，重命名 longDesc 为 description，新增 anchorTexts"
```

---

### Task 2: 修改 AI 生成器

**Files:**
- Modify: `extension/src/lib/profile-generator.ts:1-221`

- [ ] **Step 1: 修改 GeneratedProfile 类型（第 4 行）**

将：
```typescript
export type GeneratedProfile = Omit<ProductProfile, 'id' | 'createdAt' | 'updatedAt' | 'screenshots' | 'founderName' | 'founderEmail' | 'socialLinks' | 'logoSquare' | 'logoBanner'>
```
改为：
```typescript
export type GeneratedProfile = Omit<ProductProfile, 'id' | 'createdAt' | 'updatedAt' | 'screenshots' | 'founderName' | 'founderEmail' | 'logoSquare' | 'logoBanner'>
```

- [ ] **Step 2: 修改 SYSTEM_PROMPT（第 13-33 行）**

将整个 `SYSTEM_PROMPT` 常量替换为：

```typescript
const SYSTEM_PROMPT = `You are a product analyst and SEO expert. Given a product's webpage content, generate a structured profile for directory submission and link building.

Return ONLY valid JSON with these exact fields:
{
  "name": "Product Name",
  "url": "the canonical product URL",
  "description": "A 120-180 word detailed product description covering what the product does, who it's for, and key benefits",
  "anchorTexts": "keyword1, keyword2, keyword3, ..."
}

Rules:
- name: The official product/brand name (from the page title or og:title, not the domain)
- description: Detailed but not salesy, covers features, target audience, and value proposition. 120-180 words.
- anchorTexts: A comma-separated list of SEO anchor texts for this product page. Include:
  - 3-5 core keywords (the main terms this product should rank for)
  - 3-5 secondary keywords (related terms, alternative phrasings)
  - 2-3 potential synonyms (words users might search instead of the core terms)
  - 2-3 long-tail keywords (specific phrases, e.g. "best AI tool for task management")
  Total approximately 10-15 keywords/phrases, separated by commas.
- All text in English
- Base your analysis on the actual page content provided, not assumptions
- Return ONLY the JSON object, no markdown fences, no explanation`
```

- [ ] **Step 3: 修改 parseJsonResponse（第 116-123 行）**

将 return 块：
```typescript
return {
	name: typeof parsed.name === 'string' ? parsed.name : '',
	url: typeof parsed.url === 'string' ? parsed.url : '',
	tagline: typeof parsed.tagline === 'string' ? parsed.tagline : '',
	shortDesc: typeof parsed.shortDesc === 'string' ? parsed.shortDesc : '',
	longDesc: typeof parsed.longDesc === 'string' ? parsed.longDesc : '',
	categories: Array.isArray(parsed.categories) ? parsed.categories.filter((c): c is string => typeof c === 'string') : [],
}
```
改为：
```typescript
return {
	name: typeof parsed.name === 'string' ? parsed.name : '',
	url: typeof parsed.url === 'string' ? parsed.url : '',
	description: typeof parsed.description === 'string' ? parsed.description : '',
	anchorTexts: typeof parsed.anchorTexts === 'string' ? parsed.anchorTexts : '',
}
```

- [ ] **Step 4: 验证编译**

Run: `cd extension && npm run build`
Expected: 编译通过（profile-generator.ts 无外部消费者引用旧字段名，除 ProductForm/QuickCreate 外）。

- [ ] **Step 5: Commit**

```bash
git add extension/src/lib/profile-generator.ts
git commit -m "refactor: 更新 AI 生成器——适配新 ProductProfile 字段，新增锚文本生成"
```

---

### Task 3: 修改 UI 表单

**Files:**
- Modify: `extension/src/components/ProductForm.tsx:1-192`

- [ ] **Step 1: 修改 EMPTY_FORM 默认值（第 17-28 行）**

将：
```typescript
const EMPTY_FORM: FormData = {
	name: '',
	url: '',
	tagline: '',
	shortDesc: '',
	longDesc: '',
	categories: [],
	screenshots: [],
	founderName: '',
	founderEmail: '',
	socialLinks: {},
}
```
改为：
```typescript
const EMPTY_FORM: FormData = {
	name: '',
	url: '',
	description: '',
	anchorTexts: '',
	screenshots: [],
	founderName: '',
	founderEmail: '',
}
```

- [ ] **Step 2: 修改表单主体——移除旧字段，新增锚文本输入（第 78-115 行）**

将"一句话介绍"（tagline）、"简短描述"（shortDesc）、"分类"（categories）三个输入区域全部移除，将"详细描述"改为"产品描述"，并在其后添加"锚文本列表"输入。

替换第 78 行到第 115 行（从 `{/* tagline input */}` 到 `{/* categories input */}`）为：

```tsx
			<Textarea
				label={'产品描述（约 150 词）'}
				placeholder={'详细的产品描述...'}
				value={form.description}
				onChange={(e) => update('description', e.target.value)}
				rows={textareaRows ?? 5}
				required
			/>

			<Textarea
				label={'锚文本列表（用英文逗号分隔）'}
				placeholder={'AI工具, 效率提升, 任务管理, 项目管理软件, team collaboration tool, ...'}
				value={form.anchorTexts}
				onChange={(e) => update('anchorTexts', e.target.value)}
				rows={textareaRows ?? 3}
			/>
```

- [ ] **Step 3: 修改折叠按钮文本（第 124 行）**

将：
```tsx
{showMore ? '隐藏额外信息' : '更多信息（创始人、社交链接）'}
```
改为：
```tsx
{showMore ? '隐藏额外信息' : '更多信息（创始人信息）'}
```

- [ ] **Step 4: 修改 ExtraFields 组件——移除社交链接（第 146-192 行）**

将整个 ExtraFields 函数替换为：

```tsx
function ExtraFields({
	form,
	update,
}: {
	form: FormData
	update: <K extends keyof FormData>(key: K, value: FormData[K]) => void
}) {
	return (
		<>
			<div className="border-t border-border pt-4 mt-4">
				<div className="text-xs font-semibold mb-3">{'创始人信息'}</div>
				<div className="space-y-3">
					<Input
						label={'姓名'}
						placeholder="Jane Doe"
						value={form.founderName}
						onChange={(e) => update('founderName', e.target.value)}
					/>
					<Input
						label={'邮箱'}
						placeholder="jane@example.com"
						type="email"
						value={form.founderEmail}
						onChange={(e) => update('founderEmail', e.target.value)}
					/>
				</div>
			</div>
		</>
	)
}
```

- [ ] **Step 5: 验证编译**

Run: `cd extension && npm run build`
Expected: 编译通过。

- [ ] **Step 6: Commit**

```bash
git add extension/src/components/ProductForm.tsx
git commit -m "refactor: 简化产品表单——移除社交链接/分类/一句话描述/简单描述，新增锚文本列表输入"
```

---

### Task 4: 修改 QuickCreate 适配

**Files:**
- Modify: `extension/src/components/QuickCreate.tsx:156-168`

- [ ] **Step 1: 修改审核页面字段映射（第 157-168 行）**

将：
```typescript
const initial = {
	name: profile.name,
	url: profile.url || url,
	tagline: profile.tagline,
	shortDesc: profile.shortDesc,
	longDesc: profile.longDesc,
	categories: profile.categories,
	screenshots: [],
	founderName: '',
	founderEmail: '',
	socialLinks: {},
}
```
改为：
```typescript
const initial = {
	name: profile.name,
	url: profile.url || url,
	description: profile.description,
	anchorTexts: profile.anchorTexts,
	screenshots: [],
	founderName: '',
	founderEmail: '',
}
```

- [ ] **Step 2: 验证编译**

Run: `cd extension && npm run build`
Expected: 编译通过。

- [ ] **Step 3: Commit**

```bash
git add extension/src/components/QuickCreate.tsx
git commit -m "refactor: QuickCreate 适配新 ProductProfile 字段"
```

---

### Task 5: 修改产品上下文构建

**Files:**
- Modify: `extension/src/agent/prompts/product-context.ts:1-33`

- [ ] **Step 1: 重写 buildProductContext 函数**

将整个文件内容替换为：

```typescript
import type { ProductProfile } from '@/lib/types'

export function buildProductContext(product: ProductProfile, selectedAnchor?: string): string {
	const lines = [
		'## 产品信息',
		'',
		`**名称:** ${product.name}`,
		`**URL:** ${product.url}`,
		'',
		'### 产品描述',
		product.description,
		'',
		`**锚文本列表:** ${product.anchorTexts}`,
	]

	if (selectedAnchor) {
		lines.push(`**本次使用的锚文本:** ${selectedAnchor}`)
	}

	if (product.founderName) {
		lines.push('', `**创始人姓名:** ${product.founderName}`)
	}
	if (product.founderEmail) {
		lines.push(`**创始人邮箱:** ${product.founderEmail}`)
	}

	return lines.join('\n')
}

/** Randomly select one anchor text from the comma-separated list. Falls back to product name. */
export function pickAnchorText(product: ProductProfile): string {
	const list = product.anchorTexts.split(',').map(s => s.trim()).filter(Boolean)
	return list.length > 0
		? list[Math.floor(Math.random() * list.length)]
		: product.name
}
```

- [ ] **Step 2: 验证编译**

Run: `cd extension && npm run build`
Expected: 编译失败——FormFillEngine.ts 需要适配新签名。这是预期行为。

- [ ] **Step 3: Commit**

```bash
git add extension/src/agent/prompts/product-context.ts
git commit -m "refactor: 重写产品上下文构建——适配新字段，新增 pickAnchorText 工具函数"
```

---

### Task 6: 修改目录提交 Prompt

**Files:**
- Modify: `extension/src/agent/prompts/directory-submit-prompt.ts:46-49`

- [ ] **Step 1: 更新规则文本（第 46-49 行）**

将：
```
'3. 名称/标题字段使用产品名称，摘要字段使用简短描述，描述字段使用详细描述。',
'4. URL 字段使用产品 URL。分类字段从产品分类中选择最佳匹配。',
```
改为：
```
'3. 名称/标题字段使用产品名称，描述字段使用产品描述。如果描述过长，适当截断。',
'4. URL 字段使用产品 URL。',
'5. 如果有链接/网站名称相关的字段，使用本次指定的锚文本作为显示文本（如果提供了"本次使用的锚文本"）。',
```

同时将原第 5 行（现在的第 6 行）的编号从 `'5.'` 改为 `'6.'`，以此类推——将原第 5-9 行的编号各加 1：

```
'6. 遵守 maxlength 限制——必要时进行截断。',
'7. 填写所有必填字段。可选字段仅在有相关产品数据时才填写。',
'8. 生成的内容语种必须与页面内容的语种保持一致。例如页面是英文，则输出英文；页面是中文，则输出中文。',
'9. 不要编造信息。只使用产品上下文中的数据。',
'10. 如果某个字段需要的信息在产品数据中不可用，使用空字符串。',
```

- [ ] **Step 2: 验证编译**

Run: `cd extension && npm run build`

- [ ] **Step 3: Commit**

```bash
git add extension/src/agent/prompts/directory-submit-prompt.ts
git commit -m "refactor: 更新目录提交 prompt——适配新字段，新增锚文本使用规则"
```

---

### Task 7: 修改博客评论 Prompt

**Files:**
- Modify: `extension/src/agent/prompts/blog-comment-prompt.ts:58-67`

- [ ] **Step 1: 更新链接放置规则（第 58-67 行）**

将第 60 行：
```
'   - 次选：有 "name" / "author" 字段 → 使用产品名称（或产品标语中的关键词）作为显示名称。这是首选的锚文本策略。',
```
改为：
```
'   - 次选：有 "name" / "author" 字段 → 如果产品数据中有"本次使用的锚文本"，使用该锚文本作为显示名称；否则使用产品名称。',
```

将第 61 行：
```
'   - 备选：如果既没有 URL/website 字段，也没有 name/author 字段，则在评论正文中使用 HTML 放置链接：`<a href="{product_url}" rel="dofollow">{keyword}</a>`。链接文字必须与评论内容语义连贯。',
```
改为：
```
'   - 备选：如果既没有 URL/website 字段，也没有 name/author 字段，则在评论正文中使用 HTML 放置链接：`<a href="{product_url}" rel="dofollow">{anchor_text}</a>`。链接文字使用产品数据中提供的"本次使用的锚文本"（如果有的话），必须与评论内容语义连贯。',
```

将第 63 行：
```
'   - 关键词必须与周围评论文本自然关联',
```
改为：
```
'   - 锚文本必须与周围评论文本自然关联',
```

- [ ] **Step 2: 验证编译**

Run: `cd extension && npm run build`

- [ ] **Step 3: Commit**

```bash
git add extension/src/agent/prompts/blog-comment-prompt.ts
git commit -m "refactor: 更新博客评论 prompt——使用锚文本替代产品标语关键词"
```

---

### Task 8: 修改 FormFillEngine——接入锚文本选取

**Files:**
- Modify: `extension/src/agent/FormFillEngine.ts:13,212-219`

- [ ] **Step 1: 更新 import（第 13 行）**

将：
```typescript
import { buildProductContext } from './prompts/product-context'
```
改为：
```typescript
import { buildProductContext, pickAnchorText } from './prompts/product-context'
```

- [ ] **Step 2: 修改 prompt 构建逻辑（第 212-219 行）**

将：
```typescript
		const productContext = buildProductContext(product)
		let systemPrompt: string
```
改为：
```typescript
		const selectedAnchor = pickAnchorText(product)
		const productContext = buildProductContext(product, selectedAnchor)
		let systemPrompt: string
```

- [ ] **Step 3: 验证编译**

Run: `cd extension && npm run build`
Expected: 编译通过——所有类型错误应已修复。

- [ ] **Step 4: 运行测试**

Run: `cd extension && npm run test`
Expected: 所有现有测试通过。

- [ ] **Step 5: Commit**

```bash
git add extension/src/agent/FormFillEngine.ts
git commit -m "feat: FormFillEngine 接入锚文本随机选取逻辑"
```

---

### Task 9: 修改 Google Sheet 同步列映射

**Files:**
- Modify: `extension/src/lib/sync/types.ts:48-67`

- [ ] **Step 1: 更新 products 列定义（第 48-67 行）**

将：
```typescript
  products: {
    tabName: 'products',
    columns: [
      { header: 'id', key: 'id' },
      { header: 'name', key: 'name' },
      { header: 'url', key: 'url' },
      { header: 'tagline', key: 'tagline' },
      { header: 'shortDesc', key: 'shortDesc' },
      { header: 'longDesc', key: 'longDesc' },
      { header: 'categories', key: 'categories', encode: 'json' },
      { header: 'logoSquare', key: 'logoSquare' },
      { header: 'logoBanner', key: 'logoBanner' },
      { header: 'screenshots', key: 'screenshots', encode: 'json' },
      { header: 'founderName', key: 'founderName' },
      { header: 'founderEmail', key: 'founderEmail' },
      { header: 'socialLinks', key: 'socialLinks', encode: 'json' },
      { header: 'createdAt', key: 'createdAt', encode: 'date' },
      { header: 'updatedAt', key: 'updatedAt', encode: 'date' },
    ],
  },
```
改为：
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

- [ ] **Step 2: 验证编译**

Run: `cd extension && npm run build`

- [ ] **Step 3: Commit**

```bash
git add extension/src/lib/sync/types.ts
git commit -m "refactor: 更新 Google Sheet products 列映射——适配新字段"
```

---

### Task 10: 修改选项页——移除 tagline 和分类显示

**Files:**
- Modify: `extension/src/entrypoints/options/App.tsx:231-251`

- [ ] **Step 1: 移除 tagline 显示（第 232 行）**

将：
```tsx
									<div className="text-foreground">{product.tagline}</div>
```
改为：
```tsx
									<div className="text-foreground">{product.description.slice(0, 100)}{product.description.length > 100 ? '...' : ''}</div>
```

- [ ] **Step 2: 移除分类徽章（第 243-251 行）**

删除整个分类显示块：
```tsx
									{product.categories.length > 0 && (
										<div className="flex gap-1 mt-2 flex-wrap">
											{product.categories.map((cat) => (
												<Badge key={cat} variant="outline">
													{cat}
												</Badge>
											))}
										</div>
									)}
```

- [ ] **Step 3: 移除未使用的 Badge import（第 8 行）**

检查 `Badge` 是否在文件中还有其他使用（如"当前使用"徽章在第 198 行）。确认仍有使用后，保留该 import。

- [ ] **Step 4: 验证编译**

Run: `cd extension && npm run build`

- [ ] **Step 5: Commit**

```bash
git add extension/src/entrypoints/options/App.tsx
git commit -m "refactor: 选项页——显示产品描述摘要，移除分类徽章"
```

---

### Task 11: 最终验证

- [ ] **Step 1: 全量构建**

Run: `cd extension && npm run build`
Expected: 构建成功，无错误。

- [ ] **Step 2: 运行全部测试**

Run: `cd extension && npm run test`
Expected: 所有测试通过。

- [ ] **Step 3: 最终 Commit（如有格式修正）**

```bash
git add -A
git commit -m "chore: 产品信息模型简化完成"
```
