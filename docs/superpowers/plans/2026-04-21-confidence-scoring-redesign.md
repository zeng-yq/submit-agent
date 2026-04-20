# 信心度计算重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构 `backlink-analyzer.ts` 中的信心度计算，从固定基础分+纯加分改为正负信号累加评分。

**Architecture:** 在现有字段检测逻辑基础上新增 authorFields 和 contactSignals 两组检测，替换第 91-99 行的信心度计算代码为基于正负信号累加的新算法。canComment 判定和 formType 推断保持不变。

**Tech Stack:** TypeScript, Vitest, JSDOM

---

## 文件变更

| 文件 | 操作 | 职责 |
|------|------|------|
| `extension/src/__tests__/backlink-analyzer.test.ts` | 新建 | 信心度计算单元测试 |
| `extension/src/lib/backlink-analyzer.ts` | 修改 | 新增字段检测 + 重构信心度计算 |

---

### Task 1: 编写信心度计算测试

**Files:**
- Create: `extension/src/__tests__/backlink-analyzer.test.ts`

- [ ] **Step 1: 创建测试文件，编写测试用例**

测试需要直接测试信心度计算逻辑。由于 `analyzeBacklink` 依赖 `chrome.runtime.sendMessage`，我们把信心度计算提取为独立的纯函数 `calculateConfidence`，然后测试它。

```typescript
import { describe, it, expect } from 'vitest';
import type { FormField, FormGroup, FormAnalysisResult } from '@/agent/FormAnalyzer';
import { calculateConfidence } from '@/lib/backlink-analyzer';

// Helper: 创建最小 FormField
function makeField(overrides: Partial<FormField> & { name: string }): FormField {
  return {
    canonical_id: `field_${Math.random()}`,
    name: overrides.name,
    id: overrides.id || overrides.name,
    type: overrides.type || 'text',
    label: overrides.label || '',
    placeholder: overrides.placeholder || '',
    required: false,
    maxlength: null,
    selector: `input[name="${overrides.name}"]`,
    tagName: overrides.tagName || 'input',
    ...overrides,
  };
}

// Helper: 创建最小 FormGroup
function makeForm(overrides: Partial<FormGroup>): FormGroup {
  return {
    form_index: 0,
    role: 'unknown',
    confidence: 'low',
    field_count: 1,
    filtered: false,
    ...overrides,
  };
}

describe('calculateConfidence', () => {
  it('无表单时信心度为 0.0', () => {
    const result = calculateConfidence({
      forms: [makeForm({ filtered: true })],
      fields: [],
      cmsType: 'unknown',
    });
    expect(result).toBe(0.0);
  });

  it('有未过滤表单但无关键字段时信心度为 0.2', () => {
    const result = calculateConfidence({
      forms: [makeForm({ filtered: false })],
      fields: [makeField({ name: 'foo' })],
      cmsType: 'unknown',
    });
    expect(result).toBe(0.2);
  });

  it('联系表单（action 含 /contact，有 textarea）信心度应低于 0.3', () => {
    const result = calculateConfidence({
      forms: [makeForm({ filtered: false, form_action: 'https://example.com/contact' })],
      fields: [
        makeField({ name: 'message', tagName: 'textarea' }),
        makeField({ name: 'email', type: 'email' }),
      ],
      cmsType: 'unknown',
    });
    expect(result).toBeLessThan(0.3);
  });

  it('联系表单仅有 message 无 comment 时信心度接近 0', () => {
    const result = calculateConfidence({
      forms: [makeForm({ filtered: false, form_action: 'https://example.com/contact' })],
      fields: [
        makeField({ name: 'message', tagName: 'textarea' }),
      ],
      cmsType: 'unknown',
    });
    // 0.2(form) + 0.15(textarea) - 0.2(contact) - 0.1(only message) = 0.05
    expect(result).toBeCloseTo(0.05, 2);
  });

  it('WordPress 完整评论页信心度应 >= 0.9', () => {
    const result = calculateConfidence({
      forms: [makeForm({ filtered: false, form_action: '/wp-comments-post.php' })],
      fields: [
        makeField({ name: 'comment', tagName: 'textarea' }),
        makeField({ name: 'url', type: 'text', label: 'Website' }),
        makeField({ name: 'email', type: 'email' }),
        makeField({ name: 'author', type: 'text', label: 'Name' }),
      ],
      cmsType: 'wordpress',
    });
    expect(result).toBeGreaterThanOrEqual(0.9);
  });

  it('简单博客评论（textarea + comment 字段）信心度约 0.55', () => {
    const result = calculateConfidence({
      forms: [makeForm({ filtered: false })],
      fields: [
        makeField({ name: 'comment', tagName: 'textarea' }),
      ],
      cmsType: 'unknown',
    });
    // 0.2(form) + 0.15(textarea) + 0.2(comment) = 0.55
    expect(result).toBeCloseTo(0.55, 2);
  });

  it('有 author 字段额外加 0.1', () => {
    const base = calculateConfidence({
      forms: [makeForm({ filtered: false })],
      fields: [
        makeField({ name: 'comment', tagName: 'textarea' }),
      ],
      cmsType: 'unknown',
    });
    const withAuthor = calculateConfidence({
      forms: [makeForm({ filtered: false })],
      fields: [
        makeField({ name: 'comment', tagName: 'textarea' }),
        makeField({ name: 'author' }),
      ],
      cmsType: 'unknown',
    });
    expect(withAuthor - base).toBeCloseTo(0.1, 2);
  });

  it('信心度不低于 0', () => {
    const result = calculateConfidence({
      forms: [makeForm({ filtered: false, form_action: '/contact' })],
      fields: [],
      cmsType: 'unknown',
    });
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('信心度不超过 1', () => {
    const result = calculateConfidence({
      forms: [makeForm({ filtered: false, form_action: '/wp-comments-post.php' })],
      fields: [
        makeField({ name: 'comment', tagName: 'textarea' }),
        makeField({ name: 'url', label: 'Website' }),
        makeField({ name: 'email', type: 'email' }),
        makeField({ name: 'author', label: 'Name' }),
      ],
      cmsType: 'wordpress',
    });
    expect(result).toBeLessThanOrEqual(1.0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd extension && npx vitest run src/__tests__/backlink-analyzer.test.ts`
Expected: FAIL — `calculateConfidence` 不存在

---

### Task 2: 实现 calculateConfidence 纯函数

**Files:**
- Modify: `extension/src/lib/backlink-analyzer.ts`

- [ ] **Step 1: 在 backlink-analyzer.ts 中添加 calculateConfidence 函数**

在文件末尾（`analyzeBacklink` 函数之后）添加：

```typescript
interface ConfidenceInput {
  forms: FormGroup[]
  fields: FormField[]
  cmsType: string
}

export function calculateConfidence(input: ConfidenceInput): number {
  const { forms, fields, cmsType } = input
  const unfilteredForms = forms.filter(f => !f.filtered)

  // Field detection
  const commentFields = fields.filter(f => {
    const p = (f.inferred_purpose || f.label || f.name || '').toLowerCase()
    return p.includes('comment') || p.includes('message') || p.includes('reply')
  })
  const urlFields = fields.filter(f => {
    const p = (f.inferred_purpose || f.label || f.name || '').toLowerCase()
    return p.includes('url') || p.includes('website') || p.includes('site')
  })
  const textareaFields = fields.filter(f =>
    f.tagName === 'textarea' || f.effective_type === 'textarea'
  )
  const emailFields = fields.filter(f => {
    const t = (f.type || f.effective_type || '').toLowerCase()
    const p = (f.inferred_purpose || f.label || f.name || '').toLowerCase()
    return t === 'email' || p.includes('email')
  })
  const authorFields = fields.filter(f => {
    const p = (f.inferred_purpose || f.label || f.name || '').toLowerCase()
    return p.includes('author') || p.includes('nickname') || (p === 'name')
  })

  // Contact signals
  const formActions = unfilteredForms.map(f => (f.form_action || '').toLowerCase()).join(' ')
  const hasContactSignal = /\/(contact|support|help)/.test(formActions)

  // Only-message penalty
  const onlyMessageNoComment = textareaFields.length > 0
    && commentFields.length === 0
    && urlFields.length === 0

  // Scoring
  let confidence = 0
  if (unfilteredForms.length > 0) confidence += 0.2
  if (textareaFields.length > 0) confidence += 0.15
  if (commentFields.length > 0) confidence += 0.2
  if (urlFields.length > 0) confidence += 0.2
  if (emailFields.length > 0) confidence += 0.05
  if (authorFields.length > 0) confidence += 0.1
  if (cmsType !== 'unknown') confidence += 0.15
  if (hasContactSignal) confidence -= 0.2
  if (onlyMessageNoComment) confidence -= 0.1

  return Math.max(0, Math.min(1, confidence))
}
```

注意需要添加 import：在文件顶部已有 `import type { FormAnalysisResult } from '@/agent/FormAnalyzer'`，需要扩展为：

```typescript
import type { FormAnalysisResult, FormField, FormGroup } from '@/agent/FormAnalyzer'
```

- [ ] **Step 2: 运行测试确认通过**

Run: `cd extension && npx vitest run src/__tests__/backlink-analyzer.test.ts`
Expected: 全部 PASS

- [ ] **Step 3: 提交**

```bash
git add extension/src/__tests__/backlink-analyzer.test.ts extension/src/lib/backlink-analyzer.ts
git commit -m "feat(confidence): 添加 calculateConfidence 纯函数及测试"
```

---

### Task 3: 重构 analyzeBacklink 使用 calculateConfidence

**Files:**
- Modify: `extension/src/lib/backlink-analyzer.ts`

- [ ] **Step 1: 替换 analyzeBacklink 中的字段检测和信心度计算**

将 `analyzeBacklink` 函数中第 44-99 行的字段检测和信心度计算替换为调用 `calculateConfidence`。

删除第 44-60 行的字段检测代码（commentFields/urlFields/textareaFields/emailFields），以及第 91-99 行的信心度计算代码。

将第 91-99 行替换为：

```typescript
  const confidence = calculateConfidence({
    forms: analysis.forms,
    fields: analysis.fields,
    cmsType,
  })
```

注意：`canComment` 的判定仍然依赖 `commentFields` 和 `textareaFields`，所以需要保留这部分检测。但为了保持 DRY，可以在 `calculateConfidence` 中导出检测结果，或者直接保留 canComment 前的局部检测。最简方案是保留 canComment 判定前的字段检测（仅 commentFields 和 textareaFields 两项），其余字段检测全部移入 `calculateConfidence`。

最终 `analyzeBacklink` 中保留的字段检测（仅用于 canComment 判定）：

```typescript
  const commentFields = allFields.filter(f => {
    const p = (f.inferred_purpose || f.label || f.name || '').toLowerCase()
    return p.includes('comment') || p.includes('message') || p.includes('reply')
  })
  const textareaFields = allFields.filter(f =>
    f.tagName === 'textarea' || f.effective_type === 'textarea'
  )
```

删除原有的 urlFields 和 emailFields 检测（已移入 calculateConfidence）。

删除原有的信心度计算代码（第 91-99 行），替换为：

```typescript
  const confidence = calculateConfidence({
    forms: analysis.forms,
    fields: allFields,
    cmsType,
  })
```

- [ ] **Step 2: 更新日志中的字段检测信息**

将第 62-68 行的日志代码改为使用 calculateConfidence 内部不再暴露的检测结果。由于 commentFields 和 textareaFields 仍保留在 analyzeBacklink 中，日志可以继续使用这两个变量。移除 urlFields 和 textareaFields 在日志中的引用：

```typescript
  log('info', 'analyze', `表单分析完成 — 发现 ${unfilteredForms.length} 个表单, ${allFields.length} 个字段`, {
    forms: unfilteredForms.length,
    fields: allFields.length,
  })
```

- [ ] **Step 3: 运行全部测试确认无回归**

Run: `cd extension && npx vitest run`
Expected: 全部 PASS

- [ ] **Step 4: 运行 build 确认编译通过**

Run: `cd extension && npm run build`
Expected: 构建成功

- [ ] **Step 5: 提交**

```bash
git add extension/src/lib/backlink-analyzer.ts
git commit -m "refactor(confidence): analyzeBacklink 使用 calculateConfidence 替代内联计算"
```
