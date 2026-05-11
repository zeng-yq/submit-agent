# 创始人姓名多值随机选取 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将创始人姓名字段从单值改为逗号分隔的多值列表，提交外链时随机选取一个。

**Architecture:** 复用 `anchorTexts` 的逗号分隔字符串模式。新增 `pickFounderName()` 函数，修改 `buildProductContext()` 接受选中姓名参数，UI 改为 Textarea。无需数据库迁移。

**Tech Stack:** TypeScript, React, Vitest

---

### Task 1: 新增 `pickFounderName()` 函数和测试

**Files:**
- Modify: `extension/src/agent/prompts/product-context.ts`
- Modify: `extension/src/__tests__/product-context.test.ts`

- [ ] **Step 1: 在 product-context.ts 中添加 `pickFounderName` 函数**

在 `pickAnchorText` 函数之后添加：

```ts
/** Randomly select one founder name from the comma-separated list. Falls back to empty string. */
export function pickFounderName(product: ProductProfile): string {
	const list = product.founderName.split(',').map(s => s.trim()).filter(Boolean)
	return list.length > 0
		? list[Math.floor(Math.random() * list.length)]
		: ''
}
```

- [ ] **Step 2: 在 product-context.test.ts 中添加测试**

在文件末尾（`pickAnchorText` describe block 之后）添加：

```ts
describe('pickFounderName', () => {
  it('returns empty string when founderName is empty', () => {
    const product = { ...mockProduct, founderName: '' }
    expect(pickFounderName(product)).toBe('')
  })

  it('returns the single name when only one is provided', () => {
    const product = { ...mockProduct, founderName: '张三' }
    expect(pickFounderName(product)).toBe('张三')
  })

  it('returns one of the names from comma-separated list', () => {
    const product = { ...mockProduct, founderName: '张三, John Doe, 李四' }
    const result = pickFounderName(product)
    expect(['张三', 'John Doe', '李四']).toContain(result)
  })

  it('trims whitespace around names', () => {
    const product = { ...mockProduct, founderName: '  Alice  ,  Bob  ,  Charlie  ' }
    const result = pickFounderName(product)
    expect(['Alice', 'Bob', 'Charlie']).toContain(result)
  })
})
```

同时在文件顶部的 import 中添加 `pickFounderName`：

```ts
import { buildProductContext, pickAnchorText, pickFounderName } from '@/agent/prompts/product-context'
```

- [ ] **Step 3: 运行测试确认通过**

Run: `npx vitest run extension/src/__tests__/product-context.test.ts`
Expected: 所有测试 PASS

- [ ] **Step 4: Commit**

```bash
git add extension/src/agent/prompts/product-context.ts extension/src/__tests__/product-context.test.ts
git commit -m "feat: 新增 pickFounderName 支持从姓名列表随机选取"
```

---

### Task 2: 修改 `buildProductContext` 接受选中姓名参数

**Files:**
- Modify: `extension/src/agent/prompts/product-context.ts`
- Modify: `extension/src/__tests__/product-context.test.ts`

- [ ] **Step 1: 修改 `buildProductContext` 函数签名和逻辑**

将函数签名从：

```ts
export function buildProductContext(product: ProductProfile, selectedAnchor?: string): string {
```

改为：

```ts
export function buildProductContext(product: ProductProfile, selectedAnchor?: string, selectedFounderName?: string): string {
```

将创始人姓名注入部分（第 21-23 行）从：

```ts
		if (product.founderName) {
			lines.push('', `**创始人姓名:** ${product.founderName}`)
		}
```

改为：

```ts
		if (selectedFounderName) {
			lines.push('', `**创始人姓名:** ${selectedFounderName}`)
		}
```

这样 prompt 中注入的是随机选中的单个姓名，而非完整列表。

- [ ] **Step 2: 更新测试以覆盖新参数**

在 `buildProductContext` 的 describe block 中添加：

```ts
  it('injects selected founder name when provided', () => {
    const product = { ...mockProduct, founderName: '张三, 李四' }
    const result = buildProductContext(product, 'AI optimization tools', '张三')
    expect(result).toContain('**创始人姓名:** 张三')
    expect(result).not.toContain('张三, 李四')
  })

  it('omits founder name when selectedFounderName is empty', () => {
    const product = { ...mockProduct, founderName: '张三' }
    const result = buildProductContext(product, undefined, '')
    expect(result).not.toContain('创始人姓名')
  })
```

- [ ] **Step 3: 运行测试确认通过**

Run: `npx vitest run extension/src/__tests__/product-context.test.ts`
Expected: 所有测试 PASS

- [ ] **Step 4: Commit**

```bash
git add extension/src/agent/prompts/product-context.ts extension/src/__tests__/product-context.test.ts
git commit -m "feat: buildProductContext 使用随机选中的创始人姓名"
```

---

### Task 3: 修改 FormFillEngine 调用链

**Files:**
- Modify: `extension/src/agent/FormFillEngine.ts`

- [ ] **Step 1: 更新 import**

将第 13 行从：

```ts
import { buildProductContext, pickAnchorText } from './prompts/product-context'
```

改为：

```ts
import { buildProductContext, pickAnchorText, pickFounderName } from './prompts/product-context'
```

- [ ] **Step 2: 在 FormFillEngine 中调用 pickFounderName 并传入 buildProductContext**

将第 213-214 行从：

```ts
			const selectedAnchor = pickAnchorText(product)
			const productContext = buildProductContext(product, selectedAnchor)
```

改为：

```ts
			const selectedAnchor = pickAnchorText(product)
			const selectedFounderName = pickFounderName(product)
			const productContext = buildProductContext(product, selectedAnchor, selectedFounderName)
```

- [ ] **Step 3: 运行构建确认无类型错误**

Run: `npm run build`
Expected: 构建成功，无错误

- [ ] **Step 4: Commit**

```bash
git add extension/src/agent/FormFillEngine.ts
git commit -m "feat: FormFillEngine 使用随机选中的创始人姓名"
```

---

### Task 4: UI 改为 Textarea

**Files:**
- Modify: `extension/src/components/ProductForm.tsx`

- [ ] **Step 1: 修改 ExtraFields 组件中的 founderName 字段**

将第 133-138 行从：

```tsx
						<Input
							label={'姓名'}
							placeholder="Jane Doe"
							value={form.founderName}
							onChange={(e) => update('founderName', e.target.value)}
						/>
```

改为：

```tsx
						<Textarea
							label={'创始人姓名（用英文逗号分隔）'}
							placeholder="张三, John Doe, 李四"
							value={form.founderName}
							onChange={(e) => update('founderName', e.target.value)}
							rows={2}
						/>
```

- [ ] **Step 2: 在 ExtraFields 函数体之前添加 textareaRows 变量（如果 compact 模式需要）**

确认 ExtraFields 组件能访问 `compact` prop。当前 `ExtraFields` 不接收 `compact`，但 `textareaRows` 已在父组件中定义。因为创始人姓名始终在 ExtraFields 中，固定 `rows={2}` 即可（与锚文本在 compact 模式下的行数一致）。

- [ ] **Step 3: 运行构建确认无错误**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 4: Commit**

```bash
git add extension/src/components/ProductForm.tsx
git commit -m "feat: 创始人姓名输入改为多行文本框，支持逗号分隔"
```

---

### Task 5: 最终验证

**Files:** 无新文件

- [ ] **Step 1: 运行全部测试**

Run: `npx vitest run`
Expected: 所有测试 PASS

- [ ] **Step 2: 运行构建**

Run: `npm run build`
Expected: 构建成功，无警告

- [ ] **Step 3: 清理 — 删除设计文档中的实现计划文件**

确认所有改动正确后，删除 `docs/superpowers/specs/2026-05-11-founder-name-list-design.md`（按 CLAUDE.md 规定，所有阶段完成后删除计划文件）。
