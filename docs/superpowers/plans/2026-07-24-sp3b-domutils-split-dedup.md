# SP-3b dom-utils 拆分 + 蜜罐常量化 + 字段去重 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `dom-utils.ts`（388 行）拆为 `dom-writers.ts`（L5）+ `field-filter.ts`（L4）并删除原文件，蜜罐评分魔法数字命名化，form-analyzer 抽 `buildAndStampField` 消除字段构建重复。

**Architecture:** 函数从 dom-utils.ts 原样搬到两个新模块（writers+waiting→dom-writers，filters+常量→field-filter），两段式（先 barrel 保 green，再直连删 barrel）。蜜罐数字提为 `HONEYPOT_WEIGHTS`/`HONEYPOT_THRESHOLD` 命名常量（值逐字）。form-analyzer 两路径公共逻辑提为 helper。均为「搬运」，行为等价。

**Tech Stack:** TypeScript（strict, strictNullChecks）、WXT、Vitest + jsdom。别名 `@/*` → `src/*`。

## Global Constraints

- 测试命令：`pnpm test`（基线 **346 测试 / 25 文件全绿**，SP-3a 后）。每个任务结束必须全绿。
- 类型检查：`pnpm exec tsc --noEmit`（基线约 26 错）净零新增错误。
- **行为等价（硬约束）**：拆分/命名化/去重都是搬运。writers/filters/判定逻辑/蜜罐评分值/字段构建顺序逐字保留。
- **不改任何判定逻辑**：蜜罐评分值（80/60/40/50/50/50/60/50）、阈值 50、可见性规则、isFormField 规则、captcha 选择器逐字保留。
- **不动**：prompts/、pipeline/、messaging/、FormFillEngine、content.ts 的 iframe 桥梁。
- 提交规范：中文 conventional commit（如 `refactor(dom): ...`）。

---

## File Structure

| 文件 | 职责 | 任务 |
|---|---|---|
| `src/agent/dom-writers.ts` | L5 writers（setInputValue 等 + fillAndVerify）+ waiting（waitForFormFields 等） | T1 |
| `src/agent/field-filter.ts` | L4 filters（isFormField/honeypot/isVisible/captcha）+ 常量 + 蜜罐权重 | T1, T3 |
| `src/agent/dom-utils.ts` | T1 改为 barrel；T2 删除 | T1, T2 |
| `src/__tests__/dom-utils.test.ts` | T2 拆为 dom-writers.test.ts + field-filter.test.ts 后删除 | T2 |
| `src/__tests__/dom-writers.test.ts` | fillAndVerify/waitForFormFields/setInputValue/setTextareaValue 测试 | T2 |
| `src/__tests__/field-filter.test.ts` | isHoneypotField/honeypotScore/isVisible 测试 | T2 |
| `src/agent/form-analyzer/index.ts` | 抽 buildAndStampField helper，消除两路径重复 | T4 |
| `src/entrypoints/content.ts:5`、`src/agent/form-analyzer/index.ts:1` | import 改直连新模块 | T2 |

---

## Task 1: 拆 dom-writers.ts + field-filter.ts，dom-utils.ts 改 barrel

**Files:**
- Create: `src/agent/dom-writers.ts`
- Create: `src/agent/field-filter.ts`
- Modify: `src/agent/dom-utils.ts`（改为 barrel）

**Interfaces:**
- Produces: `dom-writers.ts` 导出 setInputValue/setTextareaValue/setSelectValue/setContentEditable/fillField/fillAndVerify/waitForRAF/waitForFormFields；`field-filter.ts` 导出 honeypotScore/isHoneypotField/isVisible/isFormField。dom-utils.ts barrel re-export 两者（caller/test 暂不变）。

- [ ] **Step 1: 建 `dom-writers.ts`（从 dom-utils.ts 搬运 writers + waiting，逐字）**

从 `src/agent/dom-utils.ts` 把以下函数**逐字**（含注释、JSDoc、实现）搬到新建 `src/agent/dom-writers.ts`：
- `resetReactTracker`（私有，:6-23）
- `setInputValue`（:25-46）、`setTextareaValue`（:48-68）、`setSelectValue`（:70-75）、`setContentEditable`（:77-89）、`fillField`（:91-104）、`fillAndVerify`（:106-148）
- `waitForRAF`（:150-153）、`hasFormFields`（私有，:155-158）、`waitForFormFields`（:160-192）

文件顶部加模块注释：
```ts
/**
 * DOM writers + waiting utilities (L5 infrastructure).
 * 搬运自原 dom-utils.ts（SP-3b 拆分）。
 */
```
导出保留原样（`export` 的仍是 `export`，私有的仍私有）。无 import 需要（这些函数不依赖 dom-utils 的其它函数）。

- [ ] **Step 2: 建 `field-filter.ts`（从 dom-utils.ts 搬运 filters + 常量，逐字）**

从 `src/agent/dom-utils.ts` 把以下**逐字**搬到新建 `src/agent/field-filter.ts`：
- `CAPTCHA_SELECTORS`（:194-207）、`isCaptchaElement`（私有，:209-218）
- `HONEYPOT_NAME_PATTERNS`（:220-235）、`honeypotScore`（:237-283）、`isHoneypotField`（:285-288）
- `SKIP_INPUT_TYPES`（:290-298）、`isVisible`（:300-349）、`isFormField`（:351-388）

文件顶部加模块注释：
```ts
/**
 * Field filter / judgment predicates (L4 domain).
 * 搬运自原 dom-utils.ts（SP-3b 拆分）。
 */
```
导出保留原样。注意：`isFormField` 调 `isCaptchaElement`/`isHoneypotField`/`isVisible`，`isHoneypotField` 调 `honeypotScore`——全部在新文件内，无跨文件依赖。

- [ ] **Step 3: `dom-utils.ts` 改为 barrel**

把 `src/agent/dom-utils.ts` **整个内容**替换为：

```ts
/**
 * dom-utils — barrel re-export during SP-3b migration.
 * 实现已拆到 dom-writers.ts（L5）+ field-filter.ts（L4）。
 * 本 barrel 仅为迁移过渡，Task 2 会更新 caller/test 直接 import 后删除本文件。
 */
export * from './dom-writers'
export * from './field-filter'
```

- [ ] **Step 4: tsc + 全量测试（caller/test 未变，靠 barrel 继续工作）**

Run: `pnpm exec tsc --noEmit` → 净零新增。
Run: `pnpm test` → 346 全绿（dom-utils.test.ts 经 barrel 仍 import 到所有函数；content.ts/form-analyzer 经 barrel 仍 import 到 isFormField/isVisible/waitForFormFields/fillAndVerify）。

> 核查：dom-writers.ts 与 field-filter.ts 之间无交叉 import（各自自洽）。

- [ ] **Step 5: 提交**

```bash
git add src/agent/dom-writers.ts src/agent/field-filter.ts src/agent/dom-utils.ts
git commit -m "refactor(dom): 拆 dom-writers.ts + field-filter.ts，dom-utils.ts 改 barrel 过渡"
```

---

## Task 2: caller/test 直连新模块，删 dom-utils.ts（barrel）

**Files:**
- Modify: `src/agent/form-analyzer/index.ts:1`
- Modify: `src/entrypoints/content.ts:5`
- Create: `src/__tests__/dom-writers.test.ts`
- Create: `src/__tests__/field-filter.test.ts`
- Delete: `src/__tests__/dom-utils.test.ts`
- Delete: `src/agent/dom-utils.ts`

**Interfaces:**
- Consumes: dom-writers.ts、field-filter.ts（T1）。

- [ ] **Step 1: 更新 caller import**

`src/agent/form-analyzer/index.ts:1`：`import { isFormField } from '../dom-utils';` → `import { isFormField } from '../field-filter';`

`src/entrypoints/content.ts:5`：`import { isVisible, waitForFormFields, fillAndVerify } from '@/agent/dom-utils'` → 拆为两行：
```ts
import { isVisible } from '@/agent/field-filter'
import { waitForFormFields, fillAndVerify } from '@/agent/dom-writers'
```

- [ ] **Step 2: 拆 dom-utils.test.ts → field-filter.test.ts + dom-writers.test.ts**

把 `src/__tests__/dom-utils.test.ts`（299 行，7 个 describe）按导入目标拆成两文件，**测试用例逐字保留**，仅改 dynamic import 路径与类型标注路径：

**新建 `src/__tests__/field-filter.test.ts`**（搬 isHoneypotField / honeypotScore / isVisible 三个 describe，对应原文件 :6-174）：
- 顶部 import 不变（`vitest`、`JSDOM`）。
- 三个 describe 块内的 `typeof import('@/agent/dom-utils').X` 与 `await import('@/agent/dom-utils')` 全部改为 `@/agent/field-filter`。
- 用例体逐字保留。

**新建 `src/__tests__/dom-writers.test.ts`**（搬 fillAndVerify / waitForFormFields / setInputValue / setTextareaValue 四个 describe，对应原文件 :176-299）：
- 同上，dynamic import 路径改为 `@/agent/dom-writers`。
- 用例体逐字保留。

**删除 `src/__tests__/dom-utils.test.ts`**。

- [ ] **Step 3: 删除 `src/agent/dom-utils.ts`**

barrel 已无用（caller/test 都直连了），删除整个文件。

- [ ] **Step 4: grep + tsc + 全量测试**

Run: `grep -rn "@/agent/dom-utils\|'../dom-utils'\|'./dom-utils'" extension/src` → **无输出**（dom-utils 引用归零）。
Run: `pnpm exec tsc --noEmit` → 净零新增。
Run: `pnpm test` → 346 全绿（拆成的 field-filter.test + dom-writers.test 用例数 = 原 dom-utils.test）。

- [ ] **Step 5: 提交**

```bash
git add src/agent/form-analyzer/index.ts src/entrypoints/content.ts src/__tests__/dom-writers.test.ts src/__tests__/field-filter.test.ts
git rm src/__tests__/dom-utils.test.ts src/agent/dom-utils.ts
git commit -m "refactor(dom): caller/test 直连 dom-writers/field-filter，删除 dom-utils.ts"
```

---

## Task 3: field-filter.ts 蜜罐评分常量化

**Files:**
- Modify: `src/agent/field-filter.ts`（HONEYPOT_WEIGHTS + HONEYPOT_THRESHOLD，honeypotScore/isHoneypotField 用常量）

**Interfaces:**
- Produces: `HONEYPOT_WEIGHTS`、`HONEYPOT_THRESHOLD`（field-filter.ts 内常量，值逐字）。

- [ ] **Step 1: 加命名常量**

在 `src/agent/field-filter.ts` 的 `HONEYPOT_NAME_PATTERNS` 之后加：

```ts
/** 蜜罐各信号的评分权重（值搬运自原 honeypotScore，逐字保留） */
const HONEYPOT_WEIGHTS = {
  ariaHidden: 80,        // aria-hidden="true"
  namePattern: 60,       // name/id/class 命中 honeypot 模式
  nonAlnumLabel: 40,     // aria-label/title 仅非字母数字
  negativeTabindex: 50,  // tabindex<0 且无 label 信号
  autocompleteOff: 50,   // autocomplete=off 且无 label 且非标准 name
  hiddenParent: 50,      // 祖先 display:none/visibility:hidden
  fontSizeZero: 60,      // font-size:0
  zeroMaxDimension: 50,  // max-height/max-width:0
} as const

/** 蜜罐判定阈值（>= 此值判为 honeypot） */
const HONEYPOT_THRESHOLD = 50
```

- [ ] **Step 2: honeypotScore 用常量**

把 `honeypotScore` 内的裸数字改为常量引用（**值不变**）：
- `score += 80`（aria-hidden）→ `score += HONEYPOT_WEIGHTS.ariaHidden`
- `score += 60`（name/id/class pattern）→ `score += HONEYPOT_WEIGHTS.namePattern`
- `score += 40`（non-alnum label）→ `score += HONEYPOT_WEIGHTS.nonAlnumLabel`
- `score += 50`（tabindex<0）→ `score += HONEYPOT_WEIGHTS.negativeTabindex`
- `score += 50`（autocomplete=off）→ `score += HONEYPOT_WEIGHTS.autocompleteOff`
- `score += 50`（hidden parent）→ `score += HONEYPOT_WEIGHTS.hiddenParent`
- `score += 60`（font-size:0）→ `score += HONEYPOT_WEIGHTS.fontSizeZero`
- `score += 50`（max-height/width:0）→ `score += HONEYPOT_WEIGHTS.zeroMaxDimension`

> 注意 hiddenParent 与 fontSizeZero 的先后：现状 honeypotScore 先判 hidden parent（+50）再判 font-size:0（+60）再判 max-dimension（+50）。按现状顺序逐条替换，不调序。

- [ ] **Step 3: isHoneypotField 用阈值常量**

`isHoneypotField`：`return honeypotScore(el) >= 50` → `return honeypotScore(el) >= HONEYPOT_THRESHOLD`。

- [ ] **Step 4: grep + tsc + 全量测试**

Run: `grep -n "score += [0-9]" extension/src/agent/field-filter.ts` → **无输出**（蜜罐数字全命名化）。
Run: `pnpm exec tsc --noEmit` → 净零新增。
Run: `pnpm test` → 346 全绿（honeypotScore/isHoneypotField 既有用例值不变）。

- [ ] **Step 5: 提交**

```bash
git add src/agent/field-filter.ts
git commit -m "refactor(dom): 蜜罐评分魔法数字命名化（HONEYPOT_WEIGHTS/HONEYPOT_THRESHOLD，值逐字）"
```

---

## Task 4: form-analyzer 抽 buildAndStampField，消除字段构建重复

**Files:**
- Modify: `src/agent/form-analyzer/index.ts`（抽 helper，两路径合并）

**Interfaces:**
- Produces: module-private `buildAndStampField(doc, el, fieldIndex, formIndex, partial)`。

- [ ] **Step 1: 加 buildAndStampField helper**

在 `src/agent/form-analyzer/index.ts` 的 `analyzeForms` 函数之前加 module-private helper：

```ts
/**
 * 构建字段选择器（必要时 stamp data-sa-field-N 保证唯一）+ 推断 purpose/effective_type，
 * 返回完整 FormField。统一 input/textarea/select 与 contenteditable 路径的公共逻辑。
 * 搬运自原 analyzeForms 两条路径的 buildSelector+stamp+infer 部分。
 */
function buildAndStampField(
  doc: Document,
  el: HTMLElement,
  fieldIndex: number,
  formIndex: number | undefined,
  partial: {
    name: string
    id: string
    type: string
    label: string
    placeholder: string
    required: boolean
    maxlength: number | null
    tagName: string
  },
): FormField {
  let selector = buildSelector(el)
  if (doc.querySelectorAll(selector).length > 1) {
    const attr = `data-sa-field-${fieldIndex}`
    el.setAttribute(attr, '')
    selector = `[${attr}]`
  }
  const raw = { ...partial, selector }
  return {
    canonical_id: `field_${fieldIndex}`,
    ...raw,
    inferred_purpose: inferFieldPurpose(raw),
    effective_type: inferEffectiveType(raw),
    form_index: formIndex,
  }
}
```

- [ ] **Step 2: input/textarea/select 路径改调 helper**

把 `analyzeForms` 内 input/textarea/select 路径（原 :69-117 的 `for (const el of candidates)` 循环体）改为构造 partial 后调 helper。替换该循环体为：

```ts
    for (const el of candidates) {
      if (!isFormField(el)) continue;

      const htmlEl = el as HTMLElement;
      const tag = el.tagName.toLowerCase();
      const type =
        tag === 'select'
          ? 'select'
          : ((el as HTMLInputElement).type?.toLowerCase() || tag);

      const label = findLabel(doc, htmlEl);
      const maxlength = (el as HTMLInputElement).maxLength || null;
      const effectiveMaxlength =
        maxlength !== null && maxlength >= 0 ? maxlength : null;

      const field = buildAndStampField(doc, htmlEl, fieldIndex, formElements.length > 0 ? rootIdx : undefined, {
        name: el.getAttribute('name') || '',
        id: el.id || '',
        type,
        label,
        placeholder: (el as HTMLInputElement).placeholder || '',
        required: (el as HTMLInputElement).required || false,
        maxlength: effectiveMaxlength,
        tagName: tag,
      });
      fields.push(field);
      fieldIndex++;
    }
```

> `formIndex` 实参 `formElements.length > 0 ? rootIdx : undefined` 与原现状一致。

- [ ] **Step 3: contenteditable 路径改调 helper**

把 contenteditable 路径（原 :120-159 的 `{ const editables = ... }` 块）替换为：

```ts
    // contenteditable elements (both in <form> and body-fallback contexts)
    {
      const editables = root.querySelectorAll('[contenteditable="true"]');
      for (const el of editables) {
        if (!isFormField(el)) continue;

        const htmlEl = el as HTMLElement;
        const label = findLabel(doc, htmlEl);
        const ariaLabel = el.getAttribute('aria-label') || '';

        const field = buildAndStampField(doc, htmlEl, fieldIndex, formElements.length > 0 ? rootIdx : undefined, {
          name: el.getAttribute('name') || '',
          id: el.id || '',
          type: 'contenteditable',
          label: label || ariaLabel,
          placeholder: '',
          required: false,
          maxlength: null,
          tagName: el.tagName.toLowerCase(),
        });
        fields.push(field);
        fieldIndex++;
      }
    }
```

- [ ] **Step 4: tsc + 全量测试**

Run: `pnpm exec tsc --noEmit` → 净零新增。
Run: `pnpm test` → 346 全绿（FormAnalyzer.test.ts 既有用例继续过——证明去重等价）。

> 核查：inferFieldPurpose/inferEffectiveType 的入参形状接受 `{...partial, selector}`（含 selector）。原现状两路径都把含 selector 的 rawField 传给它们，helper 的 `raw = {...partial, selector}` 等价。

- [ ] **Step 5: 提交**

```bash
git add src/agent/form-analyzer/index.ts
git commit -m "refactor(form-analyzer): 抽 buildAndStampField，消除 input/contenteditable 字段构建重复"
```

---

## Task 5: 回归 + 手动验证

**Files:**
- 无（核查性任务；若有 orphan 清理则改相关文件）

- [ ] **Step 1: 终态校验（对照 spec §6 验收）**

- Run: `grep -rn "dom-utils" extension/src` → 仅注释/历史，**无 import** ✅
- Run: `ls extension/src/agent/dom-utils.ts` → 不存在 ✅（已删）
- Run: `grep -n "score += [0-9]" extension/src/agent/field-filter.ts` → 无输出 ✅（蜜罐数字全命名化）
- Run: `pnpm exec tsc --noEmit` → 净零新增 ✅
- Run: `pnpm test` → 346 全绿 ✅
- 核查 form-analyzer/index.ts：两条字段构建路径都调 buildAndStampField，无重复的 buildSelector+stamp+infer+push ✅

- [ ] **Step 2: 手动验证（交付用户）**

`pnpm build` 加载扩展，真实站点验证：表单字段填写（input/textarea/select/contenteditable 都覆盖）、蜜罐字段被跳过、隐藏字段被跳过、目录站与博客评论站填写正常。Expected: 与 SP-3a 后一致（拆分/命名化/去重是搬运，行为等价）。

- [ ] **Step 3: 提交（若有 orphan 清理）**

> 若 Step 1 发现任何 orphan（如 form-analyzer/index.ts 现在是否还需直接 import buildSelector/findLabel——仍需要，partial 构造用 findLabel、helper 用 buildSelector，都在文件内），清理后提交。若无，跳过。

---

## Self-Review 笔记

**Spec 覆盖**：
- G1 dom-utils 拆分 + 删原文件 → T1(建2文件+barrel)+T2(直连+删) ✅
- G2 蜜罐常量化 → T3 ✅
- G3 字段去重 → T4 ✅
- G4 行为等价 → 各任务「搬运」+ 既有测试守门 ✅

**类型一致性**：`HONEYPOT_WEIGHTS` 8 字段（ariaHidden/namePattern/nonAlnumLabel/negativeTabindex/autocompleteOff/hiddenParent/fontSizeZero/zeroMaxDimension）+ `HONEYPOT_THRESHOLD` 在 T3 定义、T3 消费一致；`buildAndStampField(doc, el, fieldIndex, formIndex, partial)` 签名在 T4 定义、两路径消费一致；partial 形状（name/id/type/label/placeholder/required/maxlength/tagName）与原 rawField 一致。

**风险已处理**：
- 搬运逐字（T1 引用 dom-utils.ts 行号 + 函数清单）+ barrel 过渡保 green ✅
- 蜜罐值逐字（T3 列出每条 score += 的替换 + 顺序提醒）✅
- 去重等价（T4 helper 逻辑逐字搬运自两路径公共部分 + FormAnalyzer.test 守门）✅
- 删 dom-utils.ts 后 grep 验证零引用 ✅
- 两新模块无交叉 import（T1 核查）✅

**后续衔接**：dom-writers/field-filter 就位为 SP-4（FloatButton 拆）提供清晰的 L4/L5 边界；SP-5 清剩余技术债；P0 仍延后。
