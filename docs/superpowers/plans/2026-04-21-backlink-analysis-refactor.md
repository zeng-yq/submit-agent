# 外链分析面板全栈重构 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构外链分析面板代码，清除死代码、消除重复、采用四层严格分层的抽象架构

**Architecture:** 自底向上逐层重构：数据层 → 分析层 → 状态层 → UI 层。分析层将 712 行的 FormAnalyzer.ts 拆分为 6 个职责单一的模块，通过 barrel re-export 保持外部兼容。状态层将 306 行的 useBacklinkAgent.ts 拆分为 UI 状态和分析流程两个 hook。

**Tech Stack:** TypeScript, React 19, Vitest, IndexedDB (idb), WXT (Chrome Extension MV3)

**Pre-existing issue:** `FormFillEngine.test.ts` 有 1 个预存的测试失败（与本次重构无关），运行测试时预期 `5 passed, 1 failed`。

---

## 文件结构总览

### Stage 1: 数据层

| 操作 | 文件 | 说明 |
|------|------|------|
| 修改 | `extension/src/lib/backlinks.ts` | 替换 CSV 解析器，支持 RFC 4180 引号内换行 |
| 修改 | `extension/src/hooks/useBacklinkAgent.ts:257` | 移除 `targetUrl: ''` 死字段 |
| 修改 | `extension/src/lib/db.ts` | 添加 `domain` 索引，优化 `getSiteByDomain` |

### Stage 2: 分析层

| 操作 | 文件 | 说明 |
|------|------|------|
| 创建 | `extension/src/agent/form-analyzer/types.ts` | 共享类型定义 |
| 创建 | `extension/src/agent/form-analyzer/form-scanner.ts` | DOM 扫描、字段提取、蜜罐去重 |
| 创建 | `extension/src/agent/form-analyzer/form-classifier.ts` | 表单分类 |
| 创建 | `extension/src/agent/form-analyzer/field-resolver.ts` | 字段推断 + classifyFields 共享函数 |
| 创建 | `extension/src/agent/form-analyzer/comment-links.ts` | 评论区外链检测 |
| 创建 | `extension/src/agent/form-analyzer/field-list-builder.ts` | LLM 字段列表构建 |
| 创建 | `extension/src/agent/form-analyzer/index.ts` | 公共 API + analyzeForms 编排 |
| 替换 | `extension/src/agent/FormAnalyzer.ts` | 改为 barrel re-export |
| 修改 | `extension/src/lib/backlink-analyzer.ts` | 使用共享的 classifyFields |

### Stage 3: 状态层

| 操作 | 文件 | 说明 |
|------|------|------|
| 创建 | `extension/src/hooks/useBacklinkState.ts` | UI 展示状态 |
| 创建 | `extension/src/hooks/useBacklinkAnalysis.ts` | 分析流程核心逻辑 |
| 删除 | `extension/src/hooks/useBacklinkAgent.ts` | 被上面两个文件替代 |

### Stage 4: UI 层

| 操作 | 文件 | 说明 |
|------|------|------|
| 创建 | `extension/src/components/BacklinkToolbar.tsx` | 工具栏组件 |
| 创建 | `extension/src/components/BacklinkRow.tsx` | 可展开行组件 |
| 创建 | `extension/src/components/BacklinkTable.tsx` | 表格主体 |
| 修改 | `extension/src/components/BacklinkAnalysis.tsx` | 简化为容器组件 |
| 创建 | `extension/src/hooks/useFloatFill.ts` | 浮动按钮填写协调逻辑 |
| 修改 | `extension/src/entrypoints/sidepanel/App.tsx` | 使用新 hooks |

---

## Stage 1: 数据层重构

### Task 1: 替换 CSV 解析器并移除 targetUrl 死代码

**Files:**
- Modify: `extension/src/lib/backlinks.ts:5-58`
- Modify: `extension/src/hooks/useBacklinkAgent.ts:257`

- [ ] **Step 1: 替换 backlinks.ts 中的 CSV 解析器**

将 `parseCsv` 函数替换为支持 RFC 4180（引号内换行）的状态机版本：

```typescript
/** Parse a CSV string into rows (handles quoted fields per RFC 4180) */
function parseCsv(csvText: string): Record<string, string>[] {
	const rows: Record<string, string>[] = []
	let currentRow: string[] = []
	let currentField = ''
	let inQuotes = false
	let i = 0

	while (i < csvText.length) {
		const char = csvText[i]

		if (inQuotes) {
			if (char === '"') {
				if (i + 1 < csvText.length && csvText[i + 1] === '"') {
					currentField += '"'
					i += 2
					continue
				}
				inQuotes = false
			} else {
				currentField += char
			}
		} else {
			if (char === '"') {
				inQuotes = true
			} else if (char === ',') {
				currentRow.push(currentField)
				currentField = ''
			} else if (char === '\r') {
				// Skip CR, handle CRLF
			} else if (char === '\n') {
				currentRow.push(currentField)
				currentField = ''
				if (currentRow.length > 0 && currentRow.some(f => f !== '')) {
					rows.push(currentRow)
				}
				currentRow = []
			} else {
				currentField += char
			}
		}
		i++
	}

	// Handle last field/row
	currentRow.push(currentField)
	if (currentRow.length > 0 && currentRow.some(f => f !== '')) {
		rows.push(currentRow)
	}

	if (rows.length < 2) return []

	const headers = rows[0]
	return rows.slice(1).map(row => {
		const record: Record<string, string> = {}
		for (let j = 0; j < headers.length; j++) {
			record[headers[j]] = row[j] ?? ''
		}
		return record
	})
}
```

删除原来的 `parseCsvLine` 函数（第 26-58 行），因为新 `parseCsv` 不再需要它。

- [ ] **Step 2: 移除 useBacklinkAgent.ts 中的 targetUrl 死字段**

在 `extension/src/hooks/useBacklinkAgent.ts` 第 257 行，将：

```typescript
const record = await saveBacklink({
    sourceUrl: url,
    sourceTitle: '',
    pageAscore: 0,
    targetUrl: '',
    status: 'pending',
    analysisLog: [],
})
```

改为：

```typescript
const record = await saveBacklink({
    sourceUrl: url,
    sourceTitle: '',
    pageAscore: 0,
    status: 'pending',
    analysisLog: [],
})
```

- [ ] **Step 3: 运行构建验证**

Run: `cd extension && npm run build`
Expected: 编译成功

- [ ] **Step 4: 运行测试验证**

Run: `cd extension && npx vitest run`
Expected: `5 passed, 1 failed`（FormFillEngine.test.ts 预存失败）

- [ ] **Step 5: 提交**

```bash
cd extension
git add src/lib/backlinks.ts src/hooks/useBacklinkAgent.ts
git commit -m "refactor(data): 替换 CSV 解析器支持 RFC 4180，移除 targetUrl 死字段"
```

---

### Task 2: 优化 getSiteByDomain 使用 IndexedDB 索引

**Files:**
- Modify: `extension/src/lib/db.ts:6-7` (DB_VERSION)
- Modify: `extension/src/lib/db.ts:24-30` (sites schema)
- Modify: `extension/src/lib/db.ts:60-63` (upgrade callback)
- Modify: `extension/src/lib/db.ts:303-314` (getSiteByDomain)

- [ ] **Step 1: 添加 domain 索引到 sites schema**

修改 `extension/src/lib/db.ts` 中的 `DB_VERSION` 从 `5` 改为 `6`。

修改 `SubmitAgentDB` 接口中 sites 的 indexes（第 24-30 行）：

```typescript
sites: {
    key: string
    value: SiteRecord
    indexes: {
        'by-category': string
        'by-dr': number
        'by-domain': string
    }
}
```

- [ ] **Step 2: 在 upgrade 回调中添加索引创建**

在 upgrade 回调中，在 `oldVersion < 4` 块之后添加：

```typescript
if (oldVersion < 6) {
    const sites = db.objectStoreNames.contains('sites')
        ? db.transaction('sites').objectStore('sites')
        : null
    if (sites) {
        sites.createIndex('by-domain', 'domain')
    }
}
```

- [ ] **Step 3: 更新 seedSites 在写入时自动填充 domain**

修改 `seedSites` 函数，在写入时计算并存储 domain：

```typescript
export async function seedSites(sites: SiteData[]): Promise<void> {
    const db = await getDB()
    const tx = db.transaction('sites', 'readwrite')
    const now = Date.now()
    for (const site of sites) {
        const existing = await tx.store.get(site.name)
        if (!existing) {
            const record: SiteRecord = {
                ...site,
                domain: site.submit_url ? extractDomain(site.submit_url) : undefined,
                createdAt: now,
                updatedAt: now,
            }
            await tx.store.put(record)
        }
    }
    await tx.done
}
```

需要在 `SiteRecord` 类型中添加可选的 `domain` 字段。在 `extension/src/lib/types.ts` 中修改 `SiteRecord`：

```typescript
export interface SiteRecord extends SiteData {
    domain?: string
    createdAt: number
    updatedAt: number
}
```

- [ ] **Step 4: 替换 getSiteByDomain 为索引查询**

将 `getSiteByDomain` 函数（第 303-314 行）替换为：

```typescript
export async function getSiteByDomain(domain: string): Promise<SiteRecord | undefined> {
    const db = await getDB()
    return db.getFromIndex('sites', 'by-domain', domain)
}
```

- [ ] **Step 5: 运行构建验证**

Run: `cd extension && npm run build`
Expected: 编译成功

- [ ] **Step 6: 运行测试验证**

Run: `cd extension && npx vitest run`
Expected: `5 passed, 1 failed`

- [ ] **Step 7: 提交**

```bash
cd extension
git add src/lib/db.ts src/lib/types.ts
git commit -m "perf(db): 为 sites 添加 domain 索引，getSiteByDomain 改用索引查询"
```

---

## Stage 2: 分析层重构

### Task 3: 创建 form-analyzer/types.ts — 共享类型定义

**Files:**
- Create: `extension/src/agent/form-analyzer/types.ts`

- [ ] **Step 1: 创建 types.ts**

从 `FormAnalyzer.ts` 中提取所有类型定义到独立文件：

```typescript
/** Form field metadata extracted from a page form */
export interface FormField {
  canonical_id: string;
  name: string;
  id: string;
  type: string;
  label: string;
  placeholder: string;
  required: boolean;
  maxlength: number | null;
  inferred_purpose?: string;
  effective_type?: string;
  selector: string;
  tagName: string;
  form_index?: number;
}

export interface PageInfo {
  title: string;
  description: string;
  headings: string[];
  content_preview: string;
}

export interface FormAnalysisResult {
  fields: FormField[];
  forms: FormGroup[];
  page_info: PageInfo;
  commentLinks?: CommentLinkResult;
}

export interface CommentLinkResult {
  hasExternalLinks: boolean;
  uniqueDomains: number;
  totalLinks: number;
}

export type FormRole = 'search' | 'login' | 'newsletter' | 'unknown'
export type FormConfidence = 'high' | 'medium' | 'low'

export interface FormGroup {
  form_index: number
  role: FormRole
  confidence: FormConfidence
  form_id?: string
  form_action?: string
  field_count: number
  filtered: boolean
}
```

- [ ] **Step 2: 提交**

```bash
cd extension
git add src/agent/form-analyzer/types.ts
git commit -m "refactor(analyzer): 提取表单分析共享类型定义"
```

---

### Task 4: 创建 form-scanner.ts — DOM 扫描与字段提取

**Files:**
- Create: `extension/src/agent/form-analyzer/form-scanner.ts`

- [ ] **Step 1: 创建 form-scanner.ts**

从 `FormAnalyzer.ts` 中提取以下函数：`cssEscape`、`buildSelector`、`findLabel`、`deduplicateFields`、`extractPageInfo`。

```typescript
import type { FormField, PageInfo } from './types'

/**
 * Escape a string for use in a CSS selector.
 */
export function cssEscape(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/#/g, '\\#')
    .replace(/\./g, '\\.')
    .replace(/:/g, '\\:');
}

/**
 * Generate a stable CSS selector for a form element.
 */
export function buildSelector(el: HTMLElement): string {
  if (el.id) return `#${cssEscape(el.id)}`;

  const name = el.getAttribute('name');
  if (name) return `${el.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;

  const parent = el.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children).filter(
      (c) => c.tagName === el.tagName,
    );
    const index = siblings.indexOf(el);
    if (index >= 0) return `${el.tagName.toLowerCase()}:nth-of-type(${index + 1})`;
  }

  if (el.className && typeof el.className === 'string') {
    const classes = el.className.split(/\s+/).filter(Boolean).slice(0, 2);
    if (classes.length) return `${el.tagName.toLowerCase()}.${classes.join('.')}`;
  }

  return el.tagName.toLowerCase();
}

/**
 * Find the associated label text for a form element.
 * Uses a 7-step cascade from most specific to most general.
 */
export function findLabel(doc: Document, el: HTMLElement): string {
  // 1. <label for="id">
  if (el.id) {
    const label = doc.querySelector(`label[for="${cssEscape(el.id)}"]`);
    if (label) {
      const text = label.textContent?.trim();
      if (text) return text;
    }
  }

  // 2. Wrapping <label>
  const parentLabel = el.closest('label');
  if (parentLabel) {
    const clone = parentLabel.cloneNode(true) as HTMLElement;
    const inputs = clone.querySelectorAll('input, textarea, select');
    inputs.forEach((input) => input.remove());
    const text = clone.textContent?.trim();
    if (text) return text;
  }

  // 3. aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // 4. aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const refEl = doc.getElementById(labelledBy);
    if (refEl) {
      const text = refEl.textContent?.trim();
      if (text) return text;
    }
  }

  // 5. title attribute
  const title = el.getAttribute('title');
  if (title) return title;

  // 6. Adjacent sibling <label>
  let prev = el.previousElementSibling;
  while (prev) {
    if (prev.tagName === 'LABEL') {
      const labelFor = prev.getAttribute('for');
      if (!labelFor || labelFor === el.id) {
        const text = prev.textContent?.trim();
        if (text) return text;
      }
    }
    prev = prev.previousElementSibling;
  }

  // 7. Parent container text
  const parent = el.parentElement;
  if (parent) {
    const labelTags = new Set(['LABEL', 'SPAN', 'DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
    const children = Array.from(parent.children);
    const elIndex = children.indexOf(el);
    for (let i = elIndex - 1; i >= 0; i--) {
      const sibling = children[i];
      if (labelTags.has(sibling.tagName)) {
        if (sibling.tagName === 'LABEL') {
          const labelFor = sibling.getAttribute('for');
          if (labelFor && labelFor !== el.id) continue;
        }
        const text = sibling.textContent?.trim();
        if (text) return text;
      }
    }
  }

  return '';
}

/**
 * Remove honeypot-suspect duplicate fields: same label but different type.
 */
export function deduplicateFields(fields: FormField[]): FormField[] {
  const labelKey = (f: FormField) => (f.label || f.inferred_purpose || '').toLowerCase().trim();

  const groups = new Map<number | undefined, FormField[]>();
  for (const f of fields) {
    const key = f.form_index;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }

  const kept: FormField[] = [];

  for (const [, groupFields] of groups) {
    const removeSet = new Set<string>();
    const byLabel = new Map<string, FormField[]>();
    for (const f of groupFields) {
      const key = labelKey(f);
      if (!key) continue;
      if (!byLabel.has(key)) byLabel.set(key, []);
      byLabel.get(key)!.push(f);
    }

    for (const [, sameLabelFields] of byLabel) {
      if (sameLabelFields.length < 2) continue;

      const score = (f: FormField): number => {
        let s = 0;
        if (f.tagName === 'input') s += 10;
        if (f.type === 'textarea') s += 5;
        if (['url', 'email', 'tel'].includes(f.type)) s += 8;
        if (f.label) s += 3;
        return s;
      };

      sameLabelFields.sort((a, b) => score(b) - score(a));
      for (let i = 1; i < sameLabelFields.length; i++) {
        removeSet.add(sameLabelFields[i].canonical_id);
        console.debug(
          `[SubmitAgent] Honeypot suspect removed: ${sameLabelFields[i].canonical_id}` +
          ` (type=${sameLabelFields[i].type}, label="${sameLabelFields[i].label}")` +
          ` — duplicate of ${sameLabelFields[0].canonical_id} (type=${sameLabelFields[0].type})`
        );
      }
    }

    for (const f of groupFields) {
      if (!removeSet.has(f.canonical_id)) kept.push(f);
    }
  }

  return kept;
}

/**
 * Extract page info (title, description, headings, content preview).
 */
export function extractPageInfo(doc: Document): PageInfo {
  const title = doc.title || '';
  const metaDesc =
    doc.querySelector<HTMLMetaElement>('meta[name="description"]')?.content || '';

  const headings: string[] = [];
  const headingElements = doc.querySelectorAll('h1, h2, h3, h4, h5, h6');
  for (const h of headingElements) {
    const level = parseInt(h.tagName[1], 10);
    const prefix = '#'.repeat(level);
    const text = h.textContent?.trim();
    if (text) headings.push(`${prefix} ${text}`);
  }

  let contentPreview = '';
  const mainEl =
    doc.querySelector('main') ||
    doc.querySelector('article') ||
    doc.querySelector('[role="main"]');
  if (mainEl) {
    contentPreview = (mainEl.textContent || '').trim().slice(0, 3000);
  }

  return { title, description: metaDesc, headings, content_preview: contentPreview };
}
```

- [ ] **Step 2: 提交**

```bash
cd extension
git add src/agent/form-analyzer/form-scanner.ts
git commit -m "refactor(analyzer): 提取 DOM 扫描和字段提取到 form-scanner.ts"
```

---

### Task 5: 创建 form-classifier.ts — 表单分类

**Files:**
- Create: `extension/src/agent/form-analyzer/form-classifier.ts`

- [ ] **Step 1: 创建 form-classifier.ts**

从 `FormAnalyzer.ts` 中提取 `classifyForm` 函数：

```typescript
import type { FormGroup } from './types'

/**
 * Classify a <form> element's role (search, login, newsletter, or unknown).
 */
export function classifyForm(formEl: HTMLFormElement, formIndex: number): FormGroup {
  const id = formEl.id || undefined;
  const action = formEl.getAttribute('action') || undefined;
  const role = formEl.getAttribute('role') || '';

  const allInputs = formEl.querySelectorAll('input, textarea, select');
  let fieldCount = 0;
  let hasPassword = false;
  const fieldNames: string[] = [];

  for (const el of allInputs) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const type = (el as HTMLInputElement).type?.toLowerCase() || 'text';
      if (['hidden', 'submit', 'button', 'reset', 'image', 'file'].includes(type)) continue;
      if (type === 'password') hasPassword = true;
    }
    const name = el.getAttribute('name') || '';
    const elId = el.id || '';
    const cls = el.className || '';
    const captchaSignals = ['captcha', 'recaptcha', 'hcaptcha'];
    const combined = `${name} ${elId} ${cls}`.toLowerCase();
    if (captchaSignals.some(s => combined.includes(s))) continue;

    fieldCount++;
    fieldNames.push(name.toLowerCase());
  }

  // --- Search ---
  if (role === 'search') {
    return { form_index: formIndex, role: 'search', confidence: 'high', form_id: id, form_action: action, field_count: fieldCount, filtered: true };
  }
  if (action && (action.includes('/search') || action.includes('?s='))) {
    return { form_index: formIndex, role: 'search', confidence: 'high', form_id: id, form_action: action, field_count: fieldCount, filtered: true };
  }
  if (fieldCount === 1 && fieldNames.some(n => ['q', 's', 'query', 'keyword', 'search_term', 'search'].includes(n))) {
    return { form_index: formIndex, role: 'search', confidence: 'high', form_id: id, form_action: action, field_count: fieldCount, filtered: true };
  }

  // --- Login ---
  if (hasPassword && fieldCount <= 2) {
    return { form_index: formIndex, role: 'login', confidence: 'high', form_id: id, form_action: action, field_count: fieldCount, filtered: true };
  }
  if (action && (action.includes('/login') || action.includes('/signin') || action.includes('/auth'))) {
    return { form_index: formIndex, role: 'login', confidence: 'high', form_id: id, form_action: action, field_count: fieldCount, filtered: true };
  }
  if (fieldNames.some(n => n.includes('password') || n.includes('passwd'))) {
    return { form_index: formIndex, role: 'login', confidence: 'high', form_id: id, form_action: action, field_count: fieldCount, filtered: true };
  }

  // --- Newsletter ---
  if (action && (action.includes('/subscribe') || action.includes('/newsletter'))) {
    return { form_index: formIndex, role: 'newsletter', confidence: 'high', form_id: id, form_action: action, field_count: fieldCount, filtered: true };
  }
  if (fieldNames.some(n => n.includes('newsletter') || n.includes('subscribe') || n.includes('mailing'))) {
    return { form_index: formIndex, role: 'newsletter', confidence: 'high', form_id: id, form_action: action, field_count: fieldCount, filtered: true };
  }
  if (fieldCount === 1 && fieldNames.some(n => n.includes('email'))) {
    const submitButtons = formEl.querySelectorAll('button[type="submit"], input[type="submit"]');
    if (submitButtons.length > 0) {
      return { form_index: formIndex, role: 'newsletter', confidence: 'medium', form_id: id, form_action: action, field_count: fieldCount, filtered: true };
    }
  }

  return { form_index: formIndex, role: 'unknown', confidence: 'low', form_id: id, form_action: action, field_count: fieldCount, filtered: false };
}
```

- [ ] **Step 2: 提交**

```bash
cd extension
git add src/agent/form-analyzer/form-classifier.ts
git commit -m "refactor(analyzer): 提取表单分类到 form-classifier.ts"
```

---

### Task 6: 创建 field-resolver.ts — 字段推断与 classifyFields

**Files:**
- Create: `extension/src/agent/form-analyzer/field-resolver.ts`

- [ ] **Step 1: 创建 field-resolver.ts**

从 `FormAnalyzer.ts` 中提取 `inferFieldPurpose`、`inferEffectiveType`，并新增共享的 `classifyFields` 函数：

```typescript
import type { FormField } from './types'

/**
 * Infer field purpose from placeholder, name attribute, and type.
 */
export function inferFieldPurpose(field: {
  label: string;
  placeholder: string;
  name: string;
  type: string;
}): string {
  if (field.label) return '';

  const ph = field.placeholder.toLowerCase();
  const name = field.name.toLowerCase();

  if (field.type === 'url') return 'website URL';
  if (field.type === 'email') return 'email address';
  if (field.type === 'tel') return 'phone number';

  if (ph.includes('email') || ph.includes('@')) return 'email address';
  if (ph.includes('http') || ph.includes('https') || ph.includes('url')) return 'website URL';
  if (ph.includes('name')) return 'full name';

  if (name.includes('email') || name.includes('mail')) return 'email address';
  if (name.includes('url') || name.includes('website') || name.includes('link')) return 'website URL';
  if (name.includes('name') || name.includes('author')) return 'name';
  if (name.includes('desc') || name.includes('description')) return 'description';
  if (name.includes('title')) return 'title';
  if (name.includes('category') || name.includes('tag')) return 'category';

  return '';
}

/**
 * Infer a more precise field type from context signals.
 */
export function inferEffectiveType(field: {
  label: string;
  placeholder: string;
  name: string;
  type: string;
}): string {
  if (field.type !== 'text') return '';

  const combined = `${field.label} ${field.placeholder} ${field.name}`.toLowerCase();

  if (combined.includes('email') || combined.includes('@')) return 'email';
  if (/https?:\/\//.test(field.placeholder)) return 'url';
  if (combined.includes('url') || combined.includes('website') || combined.includes('link')) return 'url';
  if (combined.includes('phone') || combined.includes('tel')) return 'tel';

  return '';
}

/**
 * Shared field classification used by both FormAnalyzer and backlink-analyzer.
 * Classifies fields into semantic categories based on name, type, label, and purpose.
 */
export function classifyFields(fields: FormField[]): {
  commentFields: FormField[]
  textareaFields: FormField[]
  urlFields: FormField[]
  emailFields: FormField[]
  authorFields: FormField[]
} {
  const commentFields = fields.filter(f => {
    const p = (f.inferred_purpose || f.label || f.name || '').toLowerCase()
    return p.includes('comment') || p.includes('message') || p.includes('reply')
  })

  const textareaFields = fields.filter(f =>
    f.tagName === 'textarea' || f.effective_type === 'textarea'
  )

  const urlFields = fields.filter(f => {
    const p = (f.inferred_purpose || f.label || f.name || '').toLowerCase()
    return p.includes('url') || p.includes('website') || p.includes('site')
  })

  const emailFields = fields.filter(f => {
    const t = (f.type || f.effective_type || '').toLowerCase()
    const p = (f.inferred_purpose || f.label || f.name || '').toLowerCase()
    return t === 'email' || p.includes('email')
  })

  const authorFields = fields.filter(f => {
    const p = (f.inferred_purpose || f.label || f.name || '').toLowerCase()
    return p.includes('author') || p.includes('nickname') || (p === 'name')
  })

  return { commentFields, textareaFields, urlFields, emailFields, authorFields }
}
```

- [ ] **Step 2: 提交**

```bash
cd extension
git add src/agent/form-analyzer/field-resolver.ts
git commit -m "refactor(analyzer): 提取字段推断到 field-resolver.ts，新增 classifyFields 共享函数"
```

---

### Task 7: 创建 comment-links.ts 和 field-list-builder.ts

**Files:**
- Create: `extension/src/agent/form-analyzer/comment-links.ts`
- Create: `extension/src/agent/form-analyzer/field-list-builder.ts`

- [ ] **Step 1: 创建 comment-links.ts**

从 `FormAnalyzer.ts` 中提取 `detectCommentLinks` 和相关常量：

```typescript
import type { CommentLinkResult } from './types'

const EXTERNAL_LINK_DOMAIN_THRESHOLD = 10;

const COMMENT_CONTAINER_SELECTORS = [
  '#comments',
  '.comments-area',
  '.comments',
  '#comment-list',
  '.comment-list',
];

const COMMENT_META_SELECTORS = [
  '.reply',
  '.comment-reply',
  '.comment-meta',
  '.comment-metadata',
  '.comment-author',
  '.vcard',
  '.says',
  '.must-log-in',
  'nav',
  '.navigation',
  '.nav-links',
  '.comment-navigation',
  '.comment-reply-login',
  '.comment-actions',
  '.blog-admin',
  '.comment-replybox-single',
].join(', ');

/**
 * Detect external links within comment sections.
 */
export function detectCommentLinks(doc: Document): CommentLinkResult {
  let container: Element | null = null;
  for (const selector of COMMENT_CONTAINER_SELECTORS) {
    container = doc.querySelector(selector);
    if (container) break;
  }

  if (!container) {
    return { hasExternalLinks: false, uniqueDomains: 0, totalLinks: 0 };
  }

  const pageHostname = doc.location.hostname;

  const allLinks = container.querySelectorAll('a[href]');
  const externalDomains = new Set<string>();
  let totalLinks = 0;

  for (const link of allLinks) {
    if (link.closest(COMMENT_META_SELECTORS)) continue;

    const href = (link as HTMLAnchorElement).href;
    if (!href.startsWith('http:') && !href.startsWith('https:')) continue;

    try {
      const url = new URL(href, doc.location.href);
      if (url.hostname === pageHostname) continue;
      externalDomains.add(url.hostname);
      totalLinks++;
    } catch {
      // Invalid URL, skip
    }
  }

  return {
    hasExternalLinks: externalDomains.size >= EXTERNAL_LINK_DOMAIN_THRESHOLD,
    uniqueDomains: externalDomains.size,
    totalLinks,
  };
}
```

- [ ] **Step 2: 创建 field-list-builder.ts**

从 `FormAnalyzer.ts` 中提取 `buildFieldList`：

```typescript
import type { FormField, FormGroup } from './types'

/**
 * Build a grouped field list string for LLM prompts.
 */
export function buildFieldList(fields: FormField[], forms: FormGroup[]): string {
  if (forms.length === 0) {
    return fields.map(formatFieldLine).join('\n');
  }

  const lines: string[] = [];

  for (const group of forms) {
    const formLabel = buildFormLabel(group);

    if (group.filtered) {
      lines.push(`${formLabel} — ${group.field_count} field${group.field_count !== 1 ? 's' : ''} (filtered)`);
      lines.push(`- (${group.role} form — skipped)`);
    } else {
      const groupFields = fields.filter(f => f.form_index === group.form_index);
      lines.push(`${formLabel} — ${groupFields.length} field${groupFields.length !== 1 ? 's' : ''}`);
      for (const f of groupFields) {
        lines.push(formatFieldLine(f));
      }
    }
  }

  return lines.join('\n');
}

function buildFormLabel(group: FormGroup): string {
  const parts = [`[Form ${group.form_index + 1}]`];
  if (group.form_id) parts.push(`id="${group.form_id}"`);
  if (group.form_action) parts.push(`action="${group.form_action}"`);
  if (group.role !== 'unknown') parts.push(`role=${group.role}`);
  return parts.join(' ');
}

function formatFieldLine(f: FormField): string {
  const parts = [`${f.canonical_id}: type=${f.effective_type || f.type}`];
  if (f.label) parts.push(`label="${f.label}"`);
  if (f.placeholder) parts.push(`placeholder="${f.placeholder}"`);
  if (f.inferred_purpose) parts.push(`inferred_purpose="${f.inferred_purpose}"`);
  parts.push(f.required ? 'required' : 'optional');
  if (f.maxlength) parts.push(`maxlength=${f.maxlength}`);
  return `- ${parts.join(', ')}`;
}
```

- [ ] **Step 3: 提交**

```bash
cd extension
git add src/agent/form-analyzer/comment-links.ts src/agent/form-analyzer/field-list-builder.ts
git commit -m "refactor(analyzer): 提取评论链接检测和字段列表构建为独立模块"
```

---

### Task 8: 创建 form-analyzer/index.ts 并重构 FormAnalyzer.ts 为 barrel re-export

**Files:**
- Create: `extension/src/agent/form-analyzer/index.ts`
- Rewrite: `extension/src/agent/FormAnalyzer.ts`

这是最关键的一步 — 编排函数 `analyzeForms` 移入 `form-analyzer/index.ts`，原 `FormAnalyzer.ts` 变为纯 re-export。

- [ ] **Step 1: 创建 form-analyzer/index.ts**

```typescript
import { isFormField } from '../dom-utils';
import type { FormField, FormAnalysisResult } from './types';
import { buildSelector, findLabel, deduplicateFields, extractPageInfo } from './form-scanner';
import { classifyForm } from './form-classifier';
import { inferFieldPurpose, inferEffectiveType } from './field-resolver';
import { detectCommentLinks } from './comment-links';

// Re-export all public types and functions
export type { FormField, PageInfo, FormAnalysisResult, CommentLinkResult, FormRole, FormConfidence, FormGroup } from './types'
export { findLabel, deduplicateFields, extractPageInfo, buildSelector, cssEscape } from './form-scanner'
export { classifyForm } from './form-classifier'
export { inferFieldPurpose, inferEffectiveType, classifyFields } from './field-resolver'
export { detectCommentLinks } from './comment-links'
export { buildFieldList } from './field-list-builder'

/**
 * Resolve a DOM element by its canonical_id from a FormAnalysisResult.
 */
export function resolveField(
  analysis: FormAnalysisResult,
  canonicalId: string,
): HTMLElement | null {
  const field = analysis.fields.find((f) => f.canonical_id === canonicalId);
  if (!field) return null;
  try {
    return document.querySelector(field.selector);
  } catch {
    return null;
  }
}

/**
 * Analyze all forms on the page and extract structured field metadata.
 */
export function analyzeForms(doc: Document): FormAnalysisResult {
  const fields: FormField[] = [];
  let fieldIndex = 0;

  const formElements = Array.from(doc.querySelectorAll('form'));
  const formGroups = formElements.map((formEl, i) => classifyForm(formEl, i));
  const filteredIndices = new Set<number>(
    formGroups.filter(g => g.filtered).map(g => g.form_index)
  );

  for (const group of formGroups) {
    if (group.filtered) {
      console.debug(
        `[SubmitAgent] Form ${group.form_index + 1} filtered as "${group.role}"` +
        ` (action=${group.form_action || 'none'}, id=${group.form_id || 'none'})`
      );
    }
  }

  const searchRoots: Array<HTMLElement | Document> =
    formElements.length > 0 ? formElements : [doc.body || doc.documentElement];

  for (let rootIdx = 0; rootIdx < searchRoots.length; rootIdx++) {
    const root = searchRoots[rootIdx];
    if (formElements.length > 0 && filteredIndices.has(rootIdx)) continue;

    const candidates = root.querySelectorAll('input, textarea, select');
    for (const el of candidates) {
      if (!isFormField(el)) continue;

      const htmlEl = el as HTMLElement;
      const tag = el.tagName.toLowerCase();
      const type =
        tag === 'select' ? 'select' : ((el as HTMLInputElement).type?.toLowerCase() || tag);
      const label = findLabel(doc, htmlEl);
      const placeholder = (el as HTMLInputElement).placeholder || '';
      const required = (el as HTMLInputElement).required || false;
      const maxlength = (el as HTMLInputElement).maxLength || null;
      const effectiveMaxlength = maxlength !== null && maxlength >= 0 ? maxlength : null;

      let selector = buildSelector(htmlEl);
      if (doc.querySelectorAll(selector).length > 1) {
        const attr = `data-sa-field-${fieldIndex}`;
        htmlEl.setAttribute(attr, '');
        selector = `[${attr}]`;
      }

      const rawField = {
        name: el.getAttribute('name') || '',
        id: el.id || '',
        type,
        label,
        placeholder,
        required,
        maxlength: effectiveMaxlength,
        selector,
        tagName: tag,
      };

      fields.push({
        canonical_id: `field_${fieldIndex}`,
        ...rawField,
        inferred_purpose: inferFieldPurpose(rawField),
        effective_type: inferEffectiveType(rawField),
        form_index: formElements.length > 0 ? rootIdx : undefined,
      });

      fieldIndex++;
    }

    // contenteditable elements
    {
      const editables = root.querySelectorAll('[contenteditable="true"]');
      for (const el of editables) {
        if (!isFormField(el)) continue;

        const htmlEl = el as HTMLElement;
        const label = findLabel(doc, htmlEl);
        const ariaLabel = el.getAttribute('aria-label') || '';

        let ceSelector = buildSelector(htmlEl);
        if (doc.querySelectorAll(ceSelector).length > 1) {
          const attr = `data-sa-field-${fieldIndex}`;
          htmlEl.setAttribute(attr, '');
          ceSelector = `[${attr}]`;
        }

        const ceField = {
          name: el.getAttribute('name') || '',
          id: el.id || '',
          type: 'contenteditable' as const,
          label: label || ariaLabel,
          placeholder: '',
          required: false,
          maxlength: null as number | null,
          selector: ceSelector,
          tagName: el.tagName.toLowerCase(),
        };

        fields.push({
          canonical_id: `field_${fieldIndex}`,
          ...ceField,
          inferred_purpose: inferFieldPurpose(ceField),
          effective_type: inferEffectiveType(ceField),
          form_index: formElements.length > 0 ? rootIdx : undefined,
        });

        fieldIndex++;
      }
    }
  }

  return {
    fields: deduplicateFields(fields),
    forms: formGroups,
    page_info: extractPageInfo(doc),
    commentLinks: detectCommentLinks(doc),
  };
}
```

- [ ] **Step 2: 将 FormAnalyzer.ts 改为 barrel re-export**

将 `extension/src/agent/FormAnalyzer.ts` 的全部内容替换为：

```typescript
/**
 * FormAnalyzer — barrel re-export.
 * All implementation lives in ./form-analyzer/
 */
export {
  analyzeForms,
  resolveField,
  classifyForm,
  inferFieldPurpose,
  inferEffectiveType,
  detectCommentLinks,
  buildFieldList,
} from './form-analyzer'

export type {
  FormField,
  PageInfo,
  FormAnalysisResult,
  CommentLinkResult,
  FormRole,
  FormConfidence,
  FormGroup,
} from './form-analyzer'
```

- [ ] **Step 3: 运行构建验证**

Run: `cd extension && npm run build`
Expected: 编译成功

- [ ] **Step 4: 运行全部测试验证**

Run: `cd extension && npx vitest run`
Expected: `5 passed, 1 failed`（所有 FormAnalyzer 相关测试必须通过）

- [ ] **Step 5: 提交**

```bash
cd extension
git add src/agent/form-analyzer/index.ts src/agent/FormAnalyzer.ts
git commit -m "refactor(analyzer): 将 FormAnalyzer 拆分为 form-analyzer/ 模块目录，原文件改为 barrel re-export"
```

---

### Task 9: 消除 backlink-analyzer.ts 中的字段检测重复

**Files:**
- Modify: `extension/src/lib/backlink-analyzer.ts`

- [ ] **Step 1: 重构 backlink-analyzer.ts 使用共享的 classifyFields**

将 `extension/src/lib/backlink-analyzer.ts` 中的重复字段检测逻辑替换为调用 `classifyFields`。

修改 import 部分，将第 2 行的 import 替换为：

```typescript
import type { FormAnalysisResult, FormField, FormGroup } from '@/agent/FormAnalyzer'
import { classifyFields } from '@/agent/FormAnalyzer'
import type { LogEntry, LogLevel } from '@/agent/types'
```

在 `analyzeBacklink` 函数中，替换第 44-51 行的字段检测：

```typescript
// Before (remove these lines):
const commentFields = allFields.filter(f => {
  const p = (f.inferred_purpose || f.label || f.name || '').toLowerCase()
  return p.includes('comment') || p.includes('message') || p.includes('reply')
})
const textareaFields = allFields.filter(f =>
  f.tagName === 'textarea' || f.effective_type === 'textarea'
)

// After:
const { commentFields, textareaFields } = classifyFields(allFields)
```

在 `calculateConfidence` 函数中，替换第 118-137 行的字段检测：

```typescript
// Before (remove these lines):
const commentFields = fields.filter(f => { ... })
const urlFields = fields.filter(f => { ... })
const textareaFields = fields.filter(f => { ... })
const emailFields = fields.filter(f => { ... })
const authorFields = fields.filter(f => { ... })

// After:
const { commentFields, textareaFields, urlFields, emailFields, authorFields } = classifyFields(fields)
```

- [ ] **Step 2: 运行测试验证**

Run: `cd extension && npx vitest run src/__tests__/backlink-analyzer.test.ts`
Expected: 所有 `calculateConfidence` 测试通过

- [ ] **Step 3: 运行构建和全部测试**

Run: `cd extension && npm run build && npx vitest run`
Expected: 编译成功，`5 passed, 1 failed`

- [ ] **Step 4: 提交**

```bash
cd extension
git add src/lib/backlink-analyzer.ts
git commit -m "refactor(analyzer): 使用共享 classifyFields 消除 backlink-analyzer 中的字段检测重复"
```

---

## Stage 3: 状态层重构

### Task 10: 创建 useBacklinkState.ts

**Files:**
- Create: `extension/src/hooks/useBacklinkState.ts`

- [ ] **Step 1: 创建 useBacklinkState.ts**

从 `useBacklinkAgent.ts` 中提取 UI 状态管理部分：

```typescript
import { useCallback, useRef, useState } from 'react'
import type { BacklinkRecord } from '@/lib/types'
import { listBacklinks, saveBacklink, getBacklinkByUrl } from '@/lib/db'
import type { LogEntry, LogLevel } from '@/agent/types'

export interface BatchRecord {
	id: string
	startTime: number
	endTime?: number
	status: 'running' | 'completed' | 'stopped'
	itemIds: string[]
	stats: {
		publishable: number
		not_publishable: number
		skipped: number
		error: number
		total: number
	}
}

export function useBacklinkState() {
	const [backlinks, setBacklinks] = useState<BacklinkRecord[]>([])
	const [batchHistory, setBatchHistory] = useState<BatchRecord[]>([])
	const [activeBatchId, setActiveBatchId] = useState<string | null>(null)
	const [logs, setLogs] = useState<LogEntry[]>([])
	const logIdRef = useRef(0)
	const currentBatchIdRef = useRef<string | null>(null)

	const handleLog = useCallback((entry: LogEntry) => {
		setLogs(prev => {
			const next = [...prev, entry]
			return next.length > 200 ? next.slice(-200) : next
		})
	}, [])

	const clearLogs = useCallback(() => {
		setLogs([])
		logIdRef.current = 0
	}, [])

	const reload = useCallback(async () => {
		setBacklinks(await listBacklinks())
	}, [])

	const addUrl = useCallback(
		async (url: string): Promise<{ success: boolean; error?: string }> => {
			try {
				new URL(url)
			} catch {
				return { success: false, error: 'Invalid URL' }
			}

			const existing = await getBacklinkByUrl(url)
			if (existing) {
				return { success: false, error: 'Duplicate URL' }
			}

			const record = await saveBacklink({
				sourceUrl: url,
				sourceTitle: '',
				pageAscore: 0,
				status: 'pending',
				analysisLog: [],
			})

			setBacklinks(prev => [...prev, record])
			return { success: true }
		},
		[]
	)

	const updateBatchStats = useCallback((backlinkId: string, newStatus: string) => {
		const bid = currentBatchIdRef.current
		if (!bid) return
		setBatchHistory(prev => prev.map(b => {
			if (b.id !== bid) return b
			const key = newStatus === 'publishable' ? 'publishable'
				: newStatus === 'not_publishable' ? 'not_publishable'
				: newStatus === 'skipped' ? 'skipped'
				: newStatus === 'error' ? 'error'
				: null
			return {
				...b,
				itemIds: [...b.itemIds, backlinkId],
				stats: key ? { ...b.stats, [key]: b.stats[key] + 1, total: b.stats.total + 1 } : b.stats,
			}
		}))
	}, [])

	const selectBatch = useCallback((id: string | null) => {
		setActiveBatchId(id)
	}, [])

	const dismissBatch = useCallback((id: string) => {
		setBatchHistory(prev => prev.filter(b => b.id !== id))
		setActiveBatchId(prev => prev === id ? null : prev)
	}, [])

	return {
		backlinks,
		setBacklinks,
		reload,
		addUrl,
		batchHistory,
		setBatchHistory,
		activeBatchId,
		setActiveBatchId,
		selectBatch,
		dismissBatch,
		logs,
		handleLog,
		clearLogs,
		logIdRef,
		currentBatchIdRef,
		updateBatchStats,
	}
}
```

- [ ] **Step 2: 提交**

```bash
cd extension
git add src/hooks/useBacklinkState.ts
git commit -m "refactor(state): 提取 UI 状态管理到 useBacklinkState hook"
```

---

### Task 11: 创建 useBacklinkAnalysis.ts 并更新消费方

**Files:**
- Create: `extension/src/hooks/useBacklinkAnalysis.ts`
- Delete: `extension/src/hooks/useBacklinkAgent.ts`
- Modify: `extension/src/entrypoints/sidepanel/App.tsx` (更新 import)

- [ ] **Step 1: 创建 useBacklinkAnalysis.ts**

从 `useBacklinkAgent.ts` 中提取分析流程核心逻辑：

```typescript
import { useCallback, useRef, useState } from 'react'
import type { BacklinkRecord, BacklinkStatus, SiteRecord } from '@/lib/types'
import { updateBacklink, listBacklinksByStatus, listBacklinks, addSite, getSiteByDomain } from '@/lib/db'
import { extractDomain } from '@/lib/backlinks'
import { analyzeBacklink, type AnalysisStep } from '@/lib/backlink-analyzer'
import type { LogEntry, LogLevel } from '@/agent/types'
import type { useBacklinkState } from './useBacklinkState'

export function useBacklinkAnalysis(state: ReturnType<typeof useBacklinkState>) {
	const stopRequestedRef = useRef(false)
	const abortRef = useRef<AbortController | null>(null)

	const [currentStep, setCurrentStep] = useState<AnalysisStep | null>(null)
	const [currentIndex, setCurrentIndex] = useState(0)
	const [batchSize, setBatchSize] = useState(0)
	const [isRunning, setIsRunning] = useState(false)
	const [analyzingId, setAnalyzingId] = useState<string | null>(null)

	const analyzeOne = useCallback(
		async (backlink: BacklinkRecord, progress?: string): Promise<void> => {
			abortRef.current?.abort()
			const ac = new AbortController()
			abortRef.current = ac
			setAnalyzingId(backlink.id)

			try {
				const domain = extractDomain(backlink.sourceUrl)
				const existingSite = await getSiteByDomain(domain)
				if (existingSite) {
					const updated = await updateBacklink({
						...backlink,
						status: 'skipped',
						analysisLog: ['跳过: 该域名已在外链资源库中'],
					})
					state.setBacklinks(prev => prev.map(b => b.id === backlink.id ? updated : b))
					state.updateBatchStats(backlink.id, 'skipped')
					return
				}

				const prefix = progress ? `[${progress}] ` : ''
				state.handleLog({ id: ++state.logIdRef.current, timestamp: Date.now(), level: 'info', phase: 'system', message: `${prefix}开始分析: ${backlink.sourceUrl}` })

				const result = await analyzeBacklink({
					url: backlink.sourceUrl,
					signal: ac.signal,
					onProgress: (step) => setCurrentStep(step),
					onLog: state.handleLog,
				})

				const publishable = !!result?.canComment
				const newStatus: BacklinkStatus = publishable ? 'publishable' : 'not_publishable'

				const analysisLog = [
					result.summary,
					`表单类型: ${result.formType}`,
					`CMS: ${result.cmsType}`,
					`信心度: ${(result.confidence * 100).toFixed(0)}%`,
				]

				const updated = await updateBacklink({
					...backlink,
					status: newStatus,
					analysisLog,
				})

				if (publishable) {
					const siteRecord: SiteRecord = {
						name: backlink.sourceTitle || extractDomain(backlink.sourceUrl),
						submit_url: backlink.sourceUrl,
						category: 'blog_comment',
						dr: null,
						status: 'alive',
						createdAt: Date.now(),
						updatedAt: Date.now(),
					}
					await addSite(siteRecord)
				}

				state.setBacklinks(prev => prev.map(b => b.id === backlink.id ? updated : b))
				state.updateBatchStats(backlink.id, newStatus)
				state.handleLog({ id: ++state.logIdRef.current, timestamp: Date.now(), level: publishable ? 'success' : 'warning', phase: 'system', message: `分析完成: ${publishable ? '可发布' : '不可发布'}` })
			} catch (error) {
				if (ac.signal.aborted) return
				const errorMsg = error instanceof Error ? error.message : String(error)
				state.handleLog({ id: ++state.logIdRef.current, timestamp: Date.now(), level: 'error', phase: 'system', message: `分析出错: ${errorMsg}` })
				try {
					const updated = await updateBacklink({
						...backlink,
						status: 'error',
						analysisLog: [...backlink.analysisLog, `错误: ${errorMsg}`],
					})
					state.setBacklinks(prev => prev.map(b => b.id === backlink.id ? updated : b))
					state.updateBatchStats(backlink.id, 'error')
				} catch {
					console.error('Failed to update backlink error status:', errorMsg)
				}
			} finally {
				setAnalyzingId(null)
			}
		},
		[state]
	)

	const startAnalysis = useCallback(
		async (count: number = 20) => {
			if (isRunning) return
			stopRequestedRef.current = false
			setIsRunning(true)

			const batchId = crypto.randomUUID()
			const newBatch = {
				id: batchId,
				startTime: Date.now(),
				status: 'running' as const,
				itemIds: [] as string[],
				stats: { publishable: 0, not_publishable: 0, skipped: 0, error: 0, total: 0 },
			}
			state.setBatchHistory(prev => [newBatch, ...prev])
			state.setActiveBatchId(batchId)
			state.currentBatchIdRef.current = batchId

			try {
				state.logIdRef.current = 0
				state.clearLogs()

				state.setBacklinks(await listBacklinks())
				const pending = await listBacklinksByStatus('pending')
				const batch = pending.slice(0, count)
				setBatchSize(batch.length)

				for (let i = 0; i < batch.length; i++) {
					if (stopRequestedRef.current) break
					setCurrentIndex(i)
					await analyzeOne(batch[i], `${i + 1}/${batch.length}`)
				}

				state.setBacklinks(await listBacklinks())
			} finally {
				const stopped = stopRequestedRef.current
				const bid = state.currentBatchIdRef.current
				state.setBatchHistory(prev => prev.map(b =>
					b.id === bid
						? { ...b, status: stopped ? 'stopped' : 'completed', endTime: Date.now() }
						: b
				))
				setIsRunning(false)
				setCurrentStep(null)
				state.currentBatchIdRef.current = null
			}
		},
		[analyzeOne, isRunning, state]
	)

	const stop = useCallback(() => {
		stopRequestedRef.current = true
		abortRef.current?.abort()
	}, [])

	return {
		analyzingId,
		currentStep,
		currentIndex,
		batchSize,
		isRunning,
		startAnalysis,
		stop,
		analyzeOne,
	}
}
```

- [ ] **Step 2: 更新 sidepanel/App.tsx 的 import**

将 `extension/src/entrypoints/sidepanel/App.tsx` 中：

```typescript
// Before:
import { useBacklinkAgent } from '@/hooks/useBacklinkAgent'

// After:
import { useBacklinkState } from '@/hooks/useBacklinkState'
import { useBacklinkAnalysis } from '@/hooks/useBacklinkAnalysis'
```

将 `App` 组件中（约第 30-42 行）：

```typescript
// Before:
const {
    analyzingId,
    backlinks,
    isRunning: isBacklinkRunning,
    startAnalysis,
    analyzeOne: analyzeBacklink,
    stop: stopBacklinkAnalysis,
    reset: resetBacklinkAgent,
    reload: reloadBacklinks,
    addUrl,
    logs: backlinkLogs,
    clearLogs: clearBacklinkLogs,
} = useBacklinkAgent()

// After:
const backlinkState = useBacklinkState()
const {
    analyzingId,
    isRunning: isBacklinkRunning,
    startAnalysis,
    analyzeOne: analyzeBacklink,
    stop: stopBacklinkAnalysis,
} = useBacklinkAnalysis(backlinkState)
```

并更新所有从 `useBacklinkAgent` 解构的变量引用，改为从 `backlinkState` 获取：
- `backlinks` → `backlinkState.backlinks`
- `reloadBacklinks` → `backlinkState.reload`
- `addUrl` → `backlinkState.addUrl`
- `backlinkLogs` → `backlinkState.logs`
- `clearBacklinkLogs` → `backlinkState.clearLogs`

移除 `resetBacklinkAgent` 的引用（不在当前 App.tsx 中使用）。

更新 `BacklinkAnalysis` 组件的 props 传递：

```tsx
<BacklinkAnalysis
    backlinks={backlinkState.backlinks}
    analyzingId={analyzingId}
    isRunning={isBacklinkRunning}
    onImportCsv={importBacklinksFromCsv}
    onReload={backlinkState.reload}
    onStartAnalysis={startAnalysis}
    onAnalyzeOne={analyzeBacklink}
    onAddUrl={backlinkState.addUrl}
    onStop={stopBacklinkAnalysis}
    logs={backlinkState.logs}
    onClearLogs={backlinkState.clearLogs}
/>
```

更新 reloadBacklinks 的 useEffect（约第 238-242 行）：

```typescript
useEffect(() => {
    if (tab === 'analysis') {
        backlinkState.reload()
    }
}, [tab, backlinkState.reload])
```

- [ ] **Step 3: 删除 useBacklinkAgent.ts**

Run: `rm extension/src/hooks/useBacklinkAgent.ts`

- [ ] **Step 4: 运行构建验证**

Run: `cd extension && npm run build`
Expected: 编译成功

- [ ] **Step 5: 运行全部测试**

Run: `cd extension && npx vitest run`
Expected: `5 passed, 1 failed`

- [ ] **Step 6: 提交**

```bash
cd extension
git add src/hooks/useBacklinkAnalysis.ts src/hooks/useBacklinkState.ts src/hooks/useBacklinkAgent.ts src/entrypoints/sidepanel/App.tsx
git commit -m "refactor(state): 拆分 useBacklinkAgent 为 useBacklinkState + useBacklinkAnalysis"
```

---

## Stage 4: UI 层重构

### Task 12: 拆分 BacklinkAnalysis.tsx 为子组件

**Files:**
- Create: `extension/src/components/BacklinkToolbar.tsx`
- Create: `extension/src/components/BacklinkRow.tsx`
- Create: `extension/src/components/BacklinkTable.tsx`
- Rewrite: `extension/src/components/BacklinkAnalysis.tsx`

- [ ] **Step 1: 创建 BacklinkToolbar.tsx**

```tsx
import { useRef, useState, useCallback } from 'react'
import { Button } from './ui/Button'

interface BacklinkToolbarProps {
	isRunning: boolean
	stats: { total: number; analyzed: number; publishable: number }
	onImportCsv: (csvText: string) => Promise<{ imported: number; skipped: number }>
	onReload: () => void
	onStartAnalysis: (count: number) => void
	onAddUrl: (url: string) => Promise<{ success: boolean; error?: string }>
	onStop: () => void
}

export function BacklinkToolbar({
	isRunning,
	stats,
	onImportCsv,
	onReload,
	onStartAnalysis,
	onAddUrl,
	onStop,
}: BacklinkToolbarProps) {
	const fileInputRef = useRef<HTMLInputElement>(null)
	const urlInputRef = useRef<HTMLInputElement>(null)
	const [batchCount, setBatchCount] = useState(20)
	const [importMsg, setImportMsg] = useState<string | null>(null)
	const [urlInput, setUrlInput] = useState('')
	const [adding, setAdding] = useState(false)

	const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (!file) return
		const text = await file.text()
		const result = await onImportCsv(text)
		await onReload()
		setImportMsg(`成功导入 ${result.imported} 条新外链，${result.skipped} 条重复被跳过`)
		if (fileInputRef.current) fileInputRef.current.value = ''
		setTimeout(() => setImportMsg(null), 5000)
	}

	const handleAddUrl = useCallback(async () => {
		const raw = urlInput.trim()
		if (!raw) return
		setAdding(true)
		try {
			const urls = raw.split(',').map(u => u.trim()).filter(Boolean)
			let added = 0
			for (const url of urls) {
				const result = await onAddUrl(url)
				if (result.success) added++
			}
			setUrlInput('')
			urlInputRef.current?.focus()
			if (added > 0) {
				setImportMsg(`已添加 ${added} 条`)
				setTimeout(() => setImportMsg(null), 3000)
			}
		} finally {
			setAdding(false)
		}
	}, [urlInput, onAddUrl])

	return (
		<>
			<div className="shrink-0 px-4 pt-3 pb-3 space-y-2">
				<div className="flex items-center gap-2">
					<input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
					<Button variant="outline" size="xs" onClick={() => fileInputRef.current?.click()} disabled={isRunning}>
						{'导入 CSV'}
					</Button>

					<div className="w-px h-5 bg-border/60" />

					<div className="flex items-center gap-1.5 flex-1 min-w-0">
						<input
							ref={urlInputRef}
							type="url"
							className="flex-1 min-w-0 text-xs bg-background border border-border rounded-md px-2.5 h-7 focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/60"
							placeholder={'输入 URL，多条用逗号分隔'}
							value={urlInput}
							onChange={(e) => setUrlInput(e.target.value)}
							onKeyDown={(e) => { if (e.key === 'Enter') handleAddUrl() }}
							disabled={adding || isRunning}
						/>
						<Button variant="default" size="xs" onClick={handleAddUrl} disabled={adding || isRunning || !urlInput.trim()}>
							{adding ? '添加中...' : '添加 URL'}
						</Button>
					</div>
				</div>
				{importMsg && <p className="text-xs text-green-400 pl-0.5">{importMsg}</p>}
			</div>

			<div className="shrink-0 h-px bg-border/60 mx-4" />

			<div className="shrink-0 px-4 py-2 flex items-center gap-2">
				{isRunning ? (
					<Button variant="destructive" size="xs" onClick={onStop}>{'停止分析'}</Button>
				) : (
					<>
						<select className="text-xs bg-background border border-border rounded-md px-2 py-1 h-7" value={batchCount} onChange={e => setBatchCount(Number(e.target.value))}>
							<option value={10}>10</option>
							<option value={20}>20</option>
							<option value={50}>50</option>
						</select>
						<Button variant="default" size="xs" onClick={() => onStartAnalysis(batchCount)} disabled={stats.total === 0 || stats.analyzed === stats.total}>
							{'开始分析'}
						</Button>
					</>
				)}
				<div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
					<span className="tabular-nums">{'已分析 '}{stats.analyzed}{'/'}{stats.total}</span>
					{stats.publishable > 0 && (
						<span className="text-green-400 tabular-nums">{`${stats.publishable} 条可发布`}</span>
					)}
				</div>
			</div>
		</>
	)
}
```

- [ ] **Step 2: 创建 BacklinkRow.tsx**

```tsx
import { Fragment } from 'react'
import type { BacklinkRecord, BacklinkStatus } from '@/lib/types'
import { Button } from './ui/Button'

const BACKLINK_STATUS_LABELS: Record<string, string> = {
	pending: '待分析',
	publishable: '可发布',
	not_publishable: '不可发布',
	error: '错误',
	skipped: '已跳过',
}

const STATUS_COLORS: Record<BacklinkStatus, string> = {
	pending: 'bg-muted text-muted-foreground',
	publishable: 'bg-green-500/20 text-green-400',
	not_publishable: 'bg-red-500/20 text-red-400',
	skipped: 'bg-yellow-500/20 text-yellow-400',
	error: 'bg-destructive/20 text-destructive',
}

interface BacklinkRowProps {
	backlink: BacklinkRecord
	isAnalyzing: boolean
	isDisabled: boolean
	isExpanded: boolean
	onToggleExpand: () => void
	onAnalyze: () => void
}

export function BacklinkRow({ backlink, isAnalyzing, isDisabled, isExpanded, onToggleExpand, onAnalyze }: BacklinkRowProps) {
	return (
		<Fragment>
			<tr className={`border-b border-border/40 transition-colors ${isAnalyzing ? 'bg-blue-500/5' : 'hover:bg-accent/30'}`}>
				<td className="px-3 py-1.5 text-primary font-medium">{backlink.pageAscore}</td>
				<td className="px-3 py-1.5 overflow-hidden">
					<a href={backlink.sourceUrl} target="_blank" rel="noopener noreferrer" className="truncate block text-primary hover:underline" title={backlink.sourceUrl}>
						{backlink.sourceTitle || backlink.sourceUrl}
					</a>
				</td>
				<td className="px-3 py-1.5">
					<span
						className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
							backlink.status !== 'pending' ? 'cursor-pointer hover:opacity-80' : 'cursor-default'
						} ${STATUS_COLORS[backlink.status]}`}
						title={(backlink.status === 'error' || backlink.status === 'not_publishable') && backlink.analysisLog?.length ? backlink.analysisLog.map(l => typeof l === 'string' ? l : JSON.stringify(l)).join('\n') : undefined}
						onClick={() => { if (backlink.status !== 'pending') onToggleExpand() }}
					>
						{BACKLINK_STATUS_LABELS[backlink.status] ?? backlink.status}
					</span>
				</td>
				<td className="px-3 py-1.5 text-right">
					<Button variant="ghost" size="sm" className="text-xs h-6 px-2" disabled={isDisabled} onClick={onAnalyze}>
						{isAnalyzing ? (
							<svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
								<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
								<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
							</svg>
						) : '分析'}
					</Button>
				</td>
			</tr>
			{isExpanded && backlink.status !== 'pending' && backlink.analysisLog?.length > 0 && (
				<tr className="border-b border-border/40">
					<td colSpan={4} className="px-4 py-2">
						<div className={`text-xs rounded px-3 py-1.5 border-l-2 ${
							backlink.status === 'publishable' ? 'bg-green-500/5 border-green-400 text-green-300'
								: backlink.status === 'error' ? 'bg-red-500/5 border-red-400 text-red-300'
									: backlink.status === 'skipped' ? 'bg-yellow-500/5 border-yellow-400/70 text-yellow-300/80'
										: 'bg-red-500/5 border-red-400/70 text-red-300/80'
						}`}>
							{backlink.analysisLog.map((log, i) => (
								<div key={i}>{typeof log === 'string' ? log : JSON.stringify(log)}</div>
							))}
						</div>
					</td>
				</tr>
			)}
		</Fragment>
	)
}
```

- [ ] **Step 3: 创建 BacklinkTable.tsx**

```tsx
import { useState, useEffect, useRef } from 'react'
import type { BacklinkRecord, BacklinkStatus } from '@/lib/types'
import { Button } from './ui/Button'
import { ActivityLog } from './ActivityLog'
import { BacklinkRow } from './BacklinkRow'
import type { LogEntry } from '@/agent/types'

type Tab = 'all' | 'done' | 'failed' | 'log'

const DONE_STATUSES: BacklinkStatus[] = ['publishable', 'not_publishable', 'skipped']

interface BacklinkTableProps {
	backlinks: BacklinkRecord[]
	analyzingId: string | null
	isRunning: boolean
	onAnalyzeOne: (backlink: BacklinkRecord) => void
	logs: LogEntry[]
	onClearLogs: () => void
}

export function BacklinkTable({ backlinks, analyzingId, isRunning, onAnalyzeOne, logs, onClearLogs }: BacklinkTableProps) {
	const [tab, setTab] = useState<Tab>('all')
	const [expandedId, setExpandedId] = useState<string | null>(null)
	const lastAnalyzedRef = useRef<string | null>(null)

	useEffect(() => {
		if (isRunning) setTab('log')
	}, [isRunning])

	useEffect(() => {
		if (analyzingId) {
			lastAnalyzedRef.current = analyzingId
		} else if (lastAnalyzedRef.current) {
			if (!isRunning) setExpandedId(lastAnalyzedRef.current)
			lastAnalyzedRef.current = null
		}
	}, [analyzingId, isRunning])

	const filteredBacklinks = [...backlinks
		.filter(b => {
			if (tab === 'all' || tab === 'log') return true
			if (tab === 'done') return DONE_STATUSES.includes(b.status)
			return b.status === 'error'
		})
	].sort((a, b) => b.pageAscore - a.pageAscore)

	const tabs: { id: Tab; label: string; count: number }[] = [
		{ id: 'all', label: '全部', count: backlinks.length },
		{ id: 'done', label: '已完成', count: backlinks.filter(b => DONE_STATUSES.includes(b.status)).length },
		{ id: 'failed', label: '失败', count: backlinks.filter(b => b.status === 'error').length },
	]

	return (
		<>
			<div className="shrink-0 border-t border-border/60">
				<div className="flex items-center gap-0 border-b px-4">
					{tabs.map((tabItem) => (
						<button key={tabItem.id} type="button" onClick={() => setTab(tabItem.id)}
							className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
								tab === tabItem.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
							}`}
						>
							{tabItem.label}
							<span className="ml-1 text-[10px] text-muted-foreground">{tabItem.count}</span>
						</button>
					))}
					<Button variant={tab === 'log' ? 'default' : 'ghost'} size="xs" onClick={() => setTab('log')} className="ml-auto">
						{'活动日志'}
					</Button>
				</div>
			</div>

			{tab === 'log' ? (
				<ActivityLog logs={logs} onClear={onClearLogs} className="flex-1" />
			) : (
				<div className="flex-1 overflow-y-auto">
					{filteredBacklinks.length === 0 ? (
						<div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
							{'暂无外链数据。请导入 Semrush 导出的 CSV 文件。'}
						</div>
					) : (
						<table className="w-full text-xs table-fixed">
							<thead className="sticky top-0 bg-background">
								<tr className="border-b border-border/60 text-muted-foreground">
									<th className="text-left px-3 py-1.5 font-normal w-10">{'AS'}</th>
									<th className="text-left px-3 py-1.5 font-normal">{'来源'}</th>
									<th className="text-left px-3 py-1.5 font-normal w-20">Status</th>
									<th className="text-right px-3 py-1.5 font-normal w-16">{'操作'}</th>
								</tr>
							</thead>
							<tbody>
								{filteredBacklinks.map(b => (
									<BacklinkRow
										key={b.id}
										backlink={b}
										isAnalyzing={analyzingId === b.id}
										isDisabled={analyzingId !== null || isRunning}
										isExpanded={expandedId === b.id}
										onToggleExpand={() => setExpandedId(prev => prev === b.id ? null : b.id)}
										onAnalyze={() => onAnalyzeOne(b)}
									/>
								))}
							</tbody>
						</table>
					)}
				</div>
			)}
		</>
	)
}
```

- [ ] **Step 4: 简化 BacklinkAnalysis.tsx 为容器组件**

```tsx
import type { BacklinkRecord } from '@/lib/types'
import type { LogEntry } from '@/agent/types'
import { BacklinkToolbar } from './BacklinkToolbar'
import { BacklinkTable } from './BacklinkTable'

interface BacklinkAnalysisProps {
	backlinks: BacklinkRecord[]
	analyzingId: string | null
	isRunning: boolean
	onImportCsv: (csvText: string) => Promise<{ imported: number; skipped: number }>
	onReload: () => void
	onStartAnalysis: (count: number) => void
	onAnalyzeOne: (backlink: BacklinkRecord) => void
	onAddUrl: (url: string) => Promise<{ success: boolean; error?: string }>
	onStop: () => void
	logs: LogEntry[]
	onClearLogs: () => void
}

export function BacklinkAnalysis({
	backlinks,
	analyzingId,
	isRunning,
	onImportCsv,
	onReload,
	onStartAnalysis,
	onAnalyzeOne,
	onAddUrl,
	onStop,
	logs,
	onClearLogs,
}: BacklinkAnalysisProps) {
	const stats = {
		total: backlinks.length,
		analyzed: backlinks.filter(b => b.status !== 'pending').length,
		publishable: backlinks.filter(b => b.status === 'publishable').length,
	}

	return (
		<div className="flex flex-col h-full">
			<BacklinkToolbar
				isRunning={isRunning}
				stats={stats}
				onImportCsv={onImportCsv}
				onReload={onReload}
				onStartAnalysis={onStartAnalysis}
				onAddUrl={onAddUrl}
				onStop={onStop}
			/>
			<BacklinkTable
				backlinks={backlinks}
				analyzingId={analyzingId}
				isRunning={isRunning}
				onAnalyzeOne={onAnalyzeOne}
				logs={logs}
				onClearLogs={onClearLogs}
			/>
		</div>
	)
}
```

- [ ] **Step 5: 运行构建验证**

Run: `cd extension && npm run build`
Expected: 编译成功

- [ ] **Step 6: 提交**

```bash
cd extension
git add src/components/BacklinkToolbar.tsx src/components/BacklinkRow.tsx src/components/BacklinkTable.tsx src/components/BacklinkAnalysis.tsx
git commit -m "refactor(ui): 拆分 BacklinkAnalysis 为 BacklinkToolbar + BacklinkTable + BacklinkRow 子组件"
```

---

### Task 13: 提取 useFloatFill.ts 从 App.tsx

**Files:**
- Create: `extension/src/hooks/useFloatFill.ts`
- Modify: `extension/src/entrypoints/sidepanel/App.tsx`

- [ ] **Step 1: 创建 useFloatFill.ts**

从 `App.tsx` 第 43-236 行提取浮动按钮填写协调逻辑。注意：文件中已有 `import { useState } from 'react'`，需合并为：

```typescript
import { useRef, useState, useEffect, useCallback } from 'react'
import type { SiteData } from '@/lib/types'
import { filterSubmittable, matchCurrentPage } from '@/lib/sites'

interface UseFloatFillOptions {
	activeProduct: { id: string } | null | undefined
	sites: SiteData[]
	startSubmission: (site: SiteData) => Promise<{ filled: number; failed: number; notes: string }>
	markSubmitted: (siteName: string, productId: string) => Promise<void>
	markFailed: (siteName: string, productId: string, error: string) => Promise<void>
	resetSubmission: (siteName: string) => Promise<void>
	reset: () => void
	setCurrentEngineSite: (site: SiteData | null) => void
}

export function useFloatFill({
	activeProduct,
	sites,
	startSubmission,
	markSubmitted,
	markFailed,
	resetSubmission,
	reset,
	setCurrentEngineSite,
}: UseFloatFillOptions) {
	const floatFillRunningRef = useRef(false)
	const [pendingUnmatchedUrl, setPendingUnmatchedUrl] = useState<string | null>(null)

	const runFloatFill = useCallback(async () => {
		if (floatFillRunningRef.current) return
		floatFillRunningRef.current = true
		chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'reset' }).catch(() => {})
		try {
			if (!activeProduct) {
				chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'no-product' }).catch(() => {})
				return
			}
			const res = await chrome.storage.session.get('floatFillTabId')
			const tabId = res.floatFillTabId as number | undefined
			if (!tabId) return
			try {
				const tab = await chrome.tabs.get(tabId)
				const tabUrl = tab.url ?? ''
				const submittable = filterSubmittable(sites)
				const matched = matchCurrentPage(submittable, tabUrl)
				if (matched) {
					chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'progress' }).catch(() => {})
					reset()
					setCurrentEngineSite(matched)
					try {
						const r = await startSubmission(matched)
						if (r.failed === 0 && r.filled > 0) {
							markSubmitted(matched.name, activeProduct.id)
						}
						setTimeout(() => { setCurrentEngineSite(null); reset() }, 3000)
					} catch (err) {
						markFailed(matched.name, activeProduct.id, err instanceof Error ? err.message : String(err))
						setTimeout(() => { setCurrentEngineSite(null); reset() }, 3000)
					}
				} else {
					chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'reset' }).catch(() => {})
					setPendingUnmatchedUrl(tabUrl)
				}
			} catch (err) {
				chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'error' }).catch(() => {})
			}
		} finally {
			floatFillRunningRef.current = false
		}
	}, [activeProduct, sites, startSubmission, markSubmitted, reset, markFailed])

	useEffect(() => {
		if (!activeProduct || sites.length === 0) return
		chrome.storage.session.get('floatFillPending').then((res) => {
			if (res.floatFillPending) {
				chrome.storage.session.remove('floatFillPending').catch(() => {})
				runFloatFill()
			}
		})
	}, [activeProduct, sites.length, runFloatFill])

	useEffect(() => {
		const handler = (message: any) => {
			if (message.type === 'FLOAT_FILL' && message.action === 'start') {
				runFloatFill()
				return
			}
			if (message.type === 'STATUS_UPDATE') {
				if (!activeProduct) return
				const { status, tabUrl } = message.payload ?? {}
				if (!status || !tabUrl) return
				const submittable = filterSubmittable(sites)
				const matched = matchCurrentPage(submittable, tabUrl)
				if (!matched) return
				if (status === 'not_started') resetSubmission(matched.name)
				else if (status === 'submitted') markSubmitted(matched.name, activeProduct.id)
				else if (status === 'failed') markFailed(matched.name, activeProduct.id)
			}
		}
		chrome.runtime.onMessage.addListener(handler)
		return () => chrome.runtime.onMessage.removeListener(handler)
	}, [runFloatFill, activeProduct, sites, markSubmitted, markFailed, resetSubmission])

	const confirmUnmatched = useCallback(async () => {
		if (!pendingUnmatchedUrl || !activeProduct) return
		const url = new URL(pendingUnmatchedUrl)
		const virtualSite: SiteData = {
			name: url.hostname,
			submit_url: pendingUnmatchedUrl,
			category: 'directory_submit',
			dr: null,
		}
		setPendingUnmatchedUrl(null)
		chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'progress' }).catch(() => {})
		reset()
		setCurrentEngineSite(virtualSite)
		try {
			const r = await startSubmission(virtualSite)
			if (r.failed === 0 && r.filled > 0) markSubmitted(virtualSite.name, activeProduct.id)
			setTimeout(() => { setCurrentEngineSite(null); reset() }, 3000)
		} catch (err) {
			markFailed(virtualSite.name, activeProduct.id, err instanceof Error ? err.message : String(err))
			setTimeout(() => { setCurrentEngineSite(null); reset() }, 3000)
		}
	}, [pendingUnmatchedUrl, activeProduct, startSubmission, markSubmitted, reset, markFailed])

	const cancelUnmatched = useCallback(() => {
		setPendingUnmatchedUrl(null)
		chrome.runtime.sendMessage({ type: 'FLOAT_FILL', action: 'no-match' }).catch(() => {})
	}, [])

	return {
		pendingUnmatchedUrl,
		confirmUnmatched,
		cancelUnmatched,
	}
}
```

- [ ] **Step 2: 简化 App.tsx**

在 `App.tsx` 中：
- 添加 `import { useFloatFill } from '@/hooks/useFloatFill'`
- 移除 `runFloatFill`、`floatFillRunningRef`、`pendingUnmatchedUrl`、`setPendingUnmatchedUrl` 以及相关的 `useEffect` 和 `useCallback`
- 使用 `useFloatFill` hook：

```typescript
const { pendingUnmatchedUrl, confirmUnmatched, cancelUnmatched } = useFloatFill({
    activeProduct,
    sites,
    startSubmission,
    markSubmitted,
    markFailed,
    resetSubmission,
    reset,
    setCurrentEngineSite,
})
```

- 替换对话框中的 `handleConfirmUnmatched` → `confirmUnmatched`、`handleCancelUnmatched` → `cancelUnmatched`

- [ ] **Step 3: 运行构建验证**

Run: `cd extension && npm run build`
Expected: 编译成功

- [ ] **Step 4: 提交**

```bash
cd extension
git add src/hooks/useFloatFill.ts src/entrypoints/sidepanel/App.tsx
git commit -m "refactor(ui): 提取浮动按钮填写协调逻辑到 useFloatFill hook，简化 App.tsx"
```

---

## 最终验证

### Task 14: 全量构建与测试验证

- [ ] **Step 1: 运行完整构建**

Run: `cd extension && npm run build`
Expected: 编译成功，无错误

- [ ] **Step 2: 运行全部测试**

Run: `cd extension && npx vitest run`
Expected: `5 passed, 1 failed`（FormFillEngine.test.ts 预存失败与本次重构无关）

- [ ] **Step 3: 验证 import 路径兼容性**

确认以下文件不需要修改 import 路径：
- `extension/src/entrypoints/content.ts` — 仍使用 `from '@/agent/FormAnalyzer'`
- `extension/src/agent/FormFillEngine.ts` — 仍使用 `from './FormAnalyzer'`
- `extension/src/agent/prompts/blog-comment-prompt.ts` — 仍使用 `from '../FormAnalyzer'`
- `extension/src/agent/prompts/directory-submit-prompt.ts` — 仍使用 `from '../FormAnalyzer'`
- `extension/src/__tests__/FormAnalyzer.test.ts` — 仍使用 `import('@/agent/FormAnalyzer')`

Run: `cd extension && grep -r "from.*useBacklinkAgent" src/` 
Expected: 无结果（确认旧 hook 已完全移除）
