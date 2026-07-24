# SP-3b 设计：dom-utils 拆分 + 蜜罐常量化 + 字段构建去重

- **日期**：2026-07-24
- **状态**：待评审
- **分支**：`dev`
- **系列**：自动提交外链代码分层重构；SP-3 拆为 SP-3a（已完成）+ SP-3b（本 spec）

---

## 0. 上下文

5 层架构重构进行中。**SP-1（消息契约 L3）、SP-2（executeFormFill 拆分+DI）、SP-3a（SiteType 策略+fuzzy 下沉）已完成**。SP-3 原含 4 块独立重构，已拆为 SP-3a（策略+fuzzy）与本 SP-3b（dom-utils 拆分 + 字段去重，围绕 DOM/表单层）。

| 序号 | 子项目 | 层 | 状态 |
|---|---|---|---|
| SP-1 | 消息契约层 | L3 | ✅ 完成 |
| SP-2 | executeFormFill 拆分 + DI | L2/L4 | ✅ 完成 |
| SP-3a | SiteType 策略 + fuzzy 下沉 | L4 | ✅ 完成 |
| **SP-3b** | **dom-utils 拆分 + 字段去重（本 spec）** | **L4/L5** | **进行中** |
| SP-4 | FloatButton 拆 UI/Store | L1/L2 | 待定 |
| SP-5 | 技术债清理 | — | 待定 |

---

## 1. 背景与目标

### 1.1 现状问题

**`dom-utils.ts`（388 行）三类职责混杂**：
- **writers**（L5 写）：`setInputValue`/`setTextareaValue`/`setSelectValue`/`setContentEditable`/`fillField`/`fillAndVerify`/`resetReactTracker`。
- **waiting**（L5 轮询）：`waitForRAF`/`hasFormFields`/`waitForFormFields`。
- **filters**（L4 字段判定）：`isFormField`/`honeypotScore`/`isHoneypotField`/`isVisible`/`isCaptchaElement` + 常量（`CAPTCHA_SELECTORS`/`HONEYPOT_NAME_PATTERNS`/`SKIP_INPUT_TYPES`）。

蜜罐评分全裸魔法数字（`honeypotScore` 里 `80/60/40/50/50/50/60/50`，`isHoneypotField` 阈值 `>= 50`），调参靠猜。

**form-analyzer 字段构建重复 ~40 行**：`form-analyzer/index.ts` 的 input/textarea/select 路径（69-117）与 contenteditable 路径（120-159）共享 `buildSelector → 唯一性 stamp（data-sa-field-N）→ 构造 rawField → inferFieldPurpose/inferEffectiveType → push` 模式，仅 type/label/placeholder/required/maxlength 来源不同。

### 1.2 目标

- G1：把 `dom-utils.ts` 拆为 `dom-writers.ts`（L5：writers + waiting）+ `field-filter.ts`（L4：filters + 常量），删除 `dom-utils.ts`，2 个 caller + 测试改直接 import。
- G2：蜜罐评分魔法数字命名化（`HONEYPOT_WEIGHTS` + `HONEYPOT_THRESHOLD`），值逐字保留。
- G3：form-analyzer 抽 `buildAndStampField` helper，消除两条路径 ~40 行重复。
- G4：行为等价——拆分/命名化/去重都是「搬运」现有逻辑，不改语义。

### 1.3 非目标

- **不改任何判定逻辑**：蜜罐评分值、可见性判定、isFormField 规则、captcha 选择器逐字保留。
- **不改 writers 实现**：setInputValue/fillAndVerify 等逻辑零改动（仅换文件）。
- **不动 prompts/、pipeline/、messaging/、FormFillEngine**（SP-1/2/3a 产物）。
- **不做 dom-utils 之外的 DOM 重构**（如 content.ts 的 iframe 桥梁）。

---

## 2. 目标设计

### 2.1 dom-utils 拆为 2 文件

**`src/agent/dom-writers.ts`**（L5 — 写 + 轮询）：
```
resetReactTracker（私有）、setInputValue、setTextareaValue、setSelectValue、
setContentEditable、fillField、fillAndVerify、waitForRAF、hasFormFields（私有）、waitForFormFields
```

**`src/agent/field-filter.ts`**（L4 — 字段判定）：
```
CAPTCHA_SELECTORS、isCaptchaElement（私有）
HONEYPOT_NAME_PATTERNS、HONEYPOT_WEIGHTS、HONEYPOT_THRESHOLD、honeypotScore、isHoneypotField
SKIP_INPUT_TYPES、isVisible、isFormField
```

**调用方更新**（仅 2 处 + 测试）：
- `form-analyzer/index.ts:1`：`import { isFormField } from '../dom-utils'` → `from '../field-filter'`
- `content.ts:5`：`import { isVisible, waitForFormFields, fillAndVerify } from '@/agent/dom-utils'` → 拆为 `import { isVisible } from '@/agent/field-filter'` + `import { waitForFormFields, fillAndVerify } from '@/agent/dom-writers'`
- `dom-utils.test.ts`（4 组动态 import）：`isHoneypotField`/`honeypotScore`/`isVisible` → `@/agent/field-filter`；`fillAndVerify` → `@/agent/dom-writers`。拆为 `dom-writers.test.ts` + `field-filter.test.ts`（按模块分文件，匹配分层）。

**删除 `dom-utils.ts`**。

### 2.2 蜜罐评分常量化

```ts
// field-filter.ts
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
const HONEYPOT_THRESHOLD = 50
```

`honeypotScore` 各 `score += N` 改为 `score += HONEYPOT_WEIGHTS.<signal>`；`isHoneypotField` 的 `>= 50` 改为 `>= HONEYPOT_THRESHOLD`。**值逐字保留，仅命名化**。

### 2.3 form-analyzer 字段构建去重

在 `form-analyzer/index.ts` 抽 module-private helper：

```ts
function buildAndStampField(
  doc: Document,
  el: HTMLElement,
  fieldIndex: number,
  formIndex: number | undefined,
  partial: {
    name: string; id: string; type: string; label: string;
    placeholder: string; required: boolean; maxlength: number | null; tagName: string
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

两条路径各自构造 `partial`（差异：input 路径 type 从 el.type、label 从 findLabel、placeholder/required/maxlength 从 el；contenteditable 路径 type='contenteditable'、label=findLabel||ariaLabel、placeholder=''、required=false、maxlength=null），然后调 `buildAndStampField(doc, htmlEl, fieldIndex, formIndex, partial)`，`fieldIndex++`。消除 buildSelector+stamp+infer+push 的重复。

---

## 3. 迁移计划（增量，每步测试绿，单 commit）

| 步 | 内容 | 风险 |
|---|---|---|
| 1 | 新建 `dom-writers.ts` + `field-filter.ts`（从 dom-utils.ts 搬运全部函数/常量，逐字）；`dom-utils.ts` 改为 barrel re-export 两者（caller/test 暂不变） | 低 |
| 2 | 更新 2 caller（form-analyzer/index.ts、content.ts）+ 拆 test（dom-writers.test.ts + field-filter.test.ts）直接 import 新模块；删除 `dom-utils.ts`（barrel 移除） | 低 |
| 3 | field-filter.ts 蜜罐评分常量化（HONEYPOT_WEIGHTS + HONEYPOT_THRESHOLD），值逐字保留 | 低 |
| 4 | form-analyzer/index.ts 抽 `buildAndStampField`，两条路径合并为 helper 调用 | 中 |
| 5 | 回归 + 清理 + 手动验证 | 低 |

> 步骤 1→2 两段式（先 barrel 保持 green，再直连 + 删 barrel）避免"搬一半 import 断裂"的中间态。

---

## 4. 测试策略

- **搬运等价**：步骤 1-2 后，既有 dom-utils 测试用例（拆到 dom-writers.test/field-filter.test，改 import 路径）继续过——证明 writers/filters 搬运等价。
- **蜜罐常量化**：步骤 3 后，honeypotScore/isHoneypotField 既有用例继续过（值不变）；可选补一例断言 HONEYPOT_WEIGHTS/HONEYPOT_THRESHOLD 的值（防回归）。
- **字段构建去重**：步骤 4 后，analyzeForms 既有测试（FormAnalyzer.test.ts）继续过——证明去重等价；可选补 buildAndStampField 直接单测。
- **既有 346 测试维持全绿**（行为等价硬约束）。

---

## 5. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 搬运 writers/filters 引入回归（如 fillAndVerify 的 execCommand、isVisible 的 getComputedStyle 分支） | 逐字搬运 + 既有 dom-utils 测试守门；步骤 1-2 单 commit 可回滚 |
| 蜜罐常量化值写错（80 写成 60 等） | 值逐字保留 + honeypotScore/isHoneypotField 既有用例守门 |
| buildAndStampField 抽取改变字段构建顺序/结果 | analyzeForms 既有测试（FormAnalyzer.test.ts）守门；helper 逻辑逐字搬运自两条路径的公共部分 |
| 删 dom-utils.ts 后有遗漏的 import | grep 确认零 `from '@/agent/dom-utils'` / `'../dom-utils'`；tsc 守门 |
| form-analyzer partial 构造差异未正确传入 helper | 两条路径的 type/label/placeholder/required/maxlength 来源逐字保留 |

---

## 6. 验收标准

- ✅ `pnpm exec tsc --noEmit` 净零新增错误（基线约 26 错）
- ✅ 全量 `pnpm test` 全绿（346 + 可能的新增常量/helper 单测；既有用例改路径后仍过）
- ✅ `dom-utils.ts` 已删除；`grep -rn "dom-utils" extension/src` 仅命中注释/历史（无 import）
- ✅ `dom-writers.ts`（writers + waiting）+ `field-filter.ts`（filters + 常量）各单一职责
- ✅ field-filter.ts 蜜罐数字全命名化（`grep -n "score += [0-9]" field-filter.ts` 无裸数字；`>= 50` 改 `>= HONEYPOT_THRESHOLD`）
- ✅ form-analyzer/index.ts 两条字段构建路径合并为 `buildAndStampField` helper 调用（input/textarea/select 与 contenteditable 不再重复 buildSelector+stamp+infer+push）
- ✅ 行为等价：真实站点填写/蜜罐过滤/可见性判定与 SP-3a 后一致

---

## 7. 未涵盖（后续）

- **SP-4**：FloatButton 拆 UI/Store（dom-writers/field-filter 已就位，FloatButton 的消息收发在 SP-1 已类型化）。
- **SP-5**：技术债清理（含各 SP 累积 Minor：test as any、循环依赖尾项等）。
- **P0（验证正确性）**：仍延后。
