# 单站自动提交 + 验证 + 验证成功才入库（子系统 A）

- **日期**：2026-07-13
- **状态**：Draft（待 review）
- **范围**：submit-agent 浏览器扩展，子系统 A。子系统 B（批量无人值守）、子系统 C（识别/填写增强）另行立项。

---

## 1. 背景与动机

submit-agent 现在的博客评论流程是"人在回路填表"：浮动按钮 → sidepanel → 分析表单 → LLM 填值 → **填完即止**，提交由用户手动完成。`useFloatFill.ts:57` 在"填写成功（`failed===0 && filled>0`）"时就 `markSubmitted`——既没点击提交按钮，也没验证提交是否成功。submissions 表里的 `submitted` 状态并不反映真实提交结果。

参考 autoComment 插件成熟的"自动点击提交 + 提交验证"闭环（4 级降级点击 + `waitForSubmitOrNavigate` 拦截 fetch/XHR 验证），子系统 A 把这套能力引入 submit-agent，**保留** submit-agent 自身优势：LLM 填值、蜜罐检测、表单分类、wpDiscuz page-context 注入、Blogger postMessage。

## 2. 目标与非目标

### 成功标准

- 在 `blog_comment` 站点，浮动按钮触发后：LLM 填完 → 自动点击提交 → 弱验证 → **验证通过才 `markSubmitted`**；失败/未确认 → `markFailed`。
- `directory_submit` 站点行为不变（填完 done，人工提交）。
- submissions 表的 `submitted` 状态真实反映"提交验证通过"。
- 底层"submit + verify"做成独立模块，B 阶段批量调度可直接复用。

### 非目标（明确不做）

- 批量无人值守调度（子系统 B）。
- 多语种关键词 / CF7 / setValueRobust 等识别填写增强（子系统 C）。
- `directory_submit` 的自动提交。
- Blogger 跨域 iframe 的自动提交（需扩展 postMessage SUBMIT 协议，工作量大，留后续）。
- 强验证（成功提示文本检测 / 刷新复核）——A 只做弱验证。

## 3. 架构设计

### 3.1 流程

当前（blog_comment）：
```
analyze → LLM → fill → done
```
A 后（blog_comment）：
```
analyze → LLM → fill → submit(点击+验证) → done(带验证结果)
```
`directory_submit` 维持原流程。

### 3.2 新增模块：`extension/src/agent/comment-submit.ts`

从 autoComment 搬运，适配 submit-agent 的 TypeScript / selector 体系。三个职责单一的函数：

- **`resolveSubmitButton(fields, analysis)`** — 从已填字段所属 form 定位提交按钮。策略（按优先级）：
  1. WP 标准选择器：`#submit`、`#publish`、`button[type=submit]`、`button:not([type])`
  2. wpDiscuz：`.wpd-submit-btn`、`.wpdiscuz-submit-btn`、`.wpd-button`
  3. 关键词匹配（多语种）：submit / post / comment / reply / 提交 / 评论 / 发表
  4. form 内唯一 button 兜底
  5. 独立提交按钮兜底（form 外但语义匹配）
- **`performClick(button)`** — 4 级降级点击：
  1. 合成事件链：`scrollIntoView({block:'center'})` → 双 `requestAnimationFrame` + 80ms 等坐标稳定 → `getBoundingClientRect()` 中心点作 `clientX/clientY` → `pointerdown`(20ms) → `mousedown`(40ms) → `mouseup`(20ms) → `pointerup`(20ms) → `click`
  2. `button.click()`
  3. `form.requestSubmit(submitter)`
  4. `form.submit()`（裸提交，无 submit 事件）

  **隔离世界说明**：content-script 合成事件对大多数站点有效（事件冒泡到 document，jQuery `on` 绑定能收到）。若目标站点需 page-context 触发（如 wpDiscuz jQuery handler），复用 `content.ts` 现有 `injectPageClick` 经验注入 `<script>`。
- **`waitForSubmitOrNavigate(timeoutMs = 10000)`** — 返回 `'ajax' | 'navigating' | 'pagehide' | 'timeout'`。机制：
  - 重写 `window.fetch` + `XMLHttpRequest.prototype.open`，拦截评论提交请求（用 `isFormSubmitUrl` 排除静态资源 / analytics / wp-admin）
  - 监听 `document` 的 `submit`（捕获）+ `window` 的 `beforeunload` / `pagehide`
  - 任一信号触发即 resolve；超时 resolve `'timeout'`
  - 调用方在 `'timeout'` 时再等 3s 查评论框是否被清空，清空视为 AJAX 成功（`'cleared'`）
  - 验证结束后恢复原始 fetch/XHR（cleanup）

**模块依赖**：仅 DOM API + submit-agent 现有 `dom-utils`。无 sidepanel / React 耦合，确保 B 阶段可直接复用。

### 3.3 FormFillEngine 扩展

在 Step 4（fill 循环）之后，`if (siteType === 'blog_comment')` 新增 **Step 5 自动提交 + 验证**（合并为单次跨 context 调用，减少往返）：

- 发 `{ type: 'FLOAT_FILL', action: 'submit', payload: { fields: analysis.fields } }` 到 content
- content 内部顺序执行：`resolveSubmitButton` → `performClick` → `waitForSubmitOrNavigate`
- 返回 `{ ok: boolean, clicked: boolean, verifyResult: VerifyResult, error?: string }`

`FillResult`（`extension/src/agent/types.ts`）扩展：
```ts
type VerifyResult = 'ajax' | 'navigating' | 'pagehide' | 'timeout' | 'cleared' | 'not_attempted'

interface FillResult {
  filled: number
  skipped: number
  failed: number
  notes: string
  // 新增（blog_comment 自动提交场景）
  submitted?: boolean        // 是否完成了提交动作
  verifyResult?: VerifyResult
  submitError?: string       // 提交/验证失败原因
}
```

`directory_submit` 不走 Step 5，`FillResult` 新增字段为 `undefined`。

### 3.4 content.ts 消息路由扩展

现有 FLOAT_FILL action：`analyze / fill / annotate / scroll-to-first / done / error`。新增 `submit`，路由到 `comment-submit.ts`（一次调用完成点击 + 验证）。

## 4. 入库改造（核心）

**当前** `useFloatFill.ts:57`：
```ts
if (r.failed === 0 && r.filled > 0) markSubmitted(matched.name, activeProduct.id)
else if (r.filled === 0) markFailed(matched.name, activeProduct.id, '页面未发现可填写的表单字段')
```

**A 后**（区分 siteType）：
```ts
// blog_comment：以验证结果为准
if (siteType === 'blog_comment') {
  const verified = ['ajax','navigating','pagehide','cleared'].includes(r.verifyResult)
  if (verified) markSubmitted(...)
  else markFailed(..., r.submitError || `提交未确认(${r.verifyResult})`)
}
// directory_submit：维持原逻辑（不自动提交，填写成功即标记）
else {
  if (r.failed === 0 && r.filled > 0) markSubmitted(...)
  else if (r.filled === 0) markFailed(..., '页面未发现可填写的表单字段')
}
```

`confirmUnmatched`（未知站点）路径同理按 siteType 分支。`useFloatFill` 需要拿到 `siteType`——通过 `matched.category === 'blog_comment'` 推导（与 `useFormFillEngine.ts:85` 一致）。

**入库语义**：只改 submissions 表（`markSubmitted`/`markFailed` 触发条件）。backlinks 表不动。

**submissions 记录验证方式**：A 阶段在 `SubmissionRecord` 增加 `verifyResult?: string` 字段（schema-less，`DB_VERSION` 无需升级，沿用 db.ts v4 的 schema-less 模式），在 `markSubmitted`/`markFailed` 时写入，供日后区分弱验证入库的外链。

## 5. 错误处理与状态机

| 场景 | verifyResult | 入库 | sidepanel 显示 |
|---|---|---|---|
| 找不到提交按钮 | `not_attempted` | `markFailed("未找到提交按钮")` | 提示用户手动提交 |
| 4 级点击全失败 | `not_attempted` | `markFailed("提交按钮点击失败")` | 同上 |
| 验证 ajax / navigating / pagehide | 成功 | `markSubmitted` | "提交成功（弱验证）" |
| 验证 timeout 但评论框已清空 | `cleared` | `markSubmitted` | "提交成功（表单已清空）" |
| 验证 timeout 且表单未清空 | `timeout` | `markFailed("提交超时未确认")` | "提交未确认" |
| fill 阶段失败 | — | `markFailed`（沿用现有） | 沿用现有 |

**提交前安全网**（沿用 submit-agent 优势）：
- 蜜罐字段已由 form-analyzer 在 analyze 阶段过滤，不会进入 fieldsToFill。
- 提交前确认目标 form 不是被 form-classifier 过滤的（搜索 / 登录 / 订阅）。
- 验证码预检 guard（搬 autoComment `detectManualRequiredChallenge` 的轻量版）：A 阶段在 `performClick` **前**检测 reCAPTCHA / hCaptcha / Turnstile / `[data-sitekey]`，命中则返回 `not_attempted` + sidepanel 提示"遇到验证码，请手动提交"，不硬闯。

## 6. 边界与已知限制

1. **弱验证假阳性**：评论被反垃圾（Akismet 等）静默拒 / 进审核队列时，HTTP 请求已发出，仍记 `submitted`。A 接受此边界；强验证留后续。
2. **`directory_submit` 不碰**：保持人工提交。
3. **Blogger 跨域 iframe 不自动提交**：A 阶段 Blogger 站点填完不自动提交（postMessage 协议未扩展 SUBMIT），sidepanel 提示"请手动提交"。留后续。
4. **Disqus / Giscus / Utterances / Facebook**：这些跨域 iframe 评论系统，submit-agent 本就只能检测不能填，A 不涉及。
5. **wpDiscuz**：提交按钮选择器已含在 `resolveSubmitButton` 策略；若合成事件不触发 jQuery handler，复用 `injectPageClick` 注入 page-context。

## 7. 测试策略

### 单元测试（Vitest，沿用 `extension/src/` 现有测试模式）

- `resolveSubmitButton`：mock DOM（含 `button[type=submit]` / WP 选择器 / 关键词 / 唯一 button / 无 button），验证优先级匹配与兜底。
- `performClick`：mock event dispatch，验证 4 级降级顺序（前一级"失败"才走下一级）。
- `waitForSubmitOrNavigate`：mock `fetch` / `XHR.open` / `submit` / `beforeunload` / `pagehide`，验证各信号触发正确返回值 + cleanup 恢复原始实现。
- 入库映射：`verifyResult → markSubmitted/markFailed` 的分支逻辑（blog_comment vs directory_submit）。

### 手动验证（真实站点）

- WordPress 原生博客：填完自动提交，验证 `navigating`/`pagehide`，submissions 标 submitted。
- wpDiscuz 博客：填完自动提交，验证 `ajax`/`cleared`。
- 找不到提交按钮的站点：验证 `not_attempted` + `markFailed` + 提示手动。
- directory 站点：验证行为不变（不自动提交）。

## 8. 关键文件清单

| 改动类型 | 文件 |
|---|---|
| 新增 | `extension/src/agent/comment-submit.ts` |
| 新增测试 | `extension/src/agent/comment-submit.test.ts` |
| 扩展 Step 5 + FillResult | `extension/src/agent/FormFillEngine.ts` |
| FillResult / VerifyResult 类型 | `extension/src/agent/types.ts` |
| content 消息路由 `submit` | `extension/src/entrypoints/content.ts` |
| 入库触发条件改造 | `extension/src/hooks/useFloatFill.ts` |

## 9. 为子系统 B / C 铺路

- `comment-submit.ts` 独立、无 sidepanel 耦合，B 阶段批量调度可直接调用同一套 `submit` 消息。
- `FillResult.verifyResult` 字段供 B 批量结果统计（成功 / 失败 / 未确认计数）。
- C 阶段的识别/填写增强（多语种关键词、`setValueRobust`）会提升 A 的填写成功率，与 A 正交，可随时叠加。
