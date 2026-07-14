# 待审核评论检测增强 — 设计文档

- 日期：2026-07-14
- 范围：`extension/`（submit-agent 浏览器扩展）
- 状态：待评审

## 1. 背景与问题

对于 WordPress 原生评论型博客（示例：`https://historicmotorsportshow.com/post/...`），自动提交评论后，页面会整页跳转到带审核参数的 URL：

```
.../post/why-do-creators-prefer-nano-banana-for-editing/?unapproved=895&moderation-hash=66afa9a727b1bb2143ea7afdb9f58a33#comment-895
```

并显示「Your comment is awaiting moderation.」——评论**未实际发布**，处于待审核态。

**当前错误行为**：这种情况被判定为「提交成功」并入库（submissions 记录 `status='submitted'`，即外链库）。

**期望行为**：凡涉及审核的，一律视作**失败**；若该站点在 submissions 中已有 `submitted` 记录，需移出外链库。

## 2. 根因

问题分两层。

### 2.1 检测在「整页跳转」场景失效

`pending_moderation` 目前仅靠 Navigation API 的 `navigate` 事件捕获（`comment-submit.ts` `waitForSubmitOrNavigate`）。但 WP 原生评论提交是整页跳转：

- 表单 action 是 `/wp-comments-post.php`，`navigate` 事件的 `destination.url` 是表单 action，**不是**重定向后带 `?unapproved=&moderation-hash=` 的最终 URL。
- 真正的待审核标记（URL 参数 + `Your comment is awaiting moderation.` 文本）只存在于**跳转后的新页面**，而此时旧 content script 上下文已销毁。

因此 `pending_moderation` 对 WP 原生提交基本不会触发。

### 2.2 `navigating`/`pagehide` 在「成功」白名单内

检测失败后信号退回 `navigating`/`pagehide`（页面正卸载去跳转）。而这两者在 `FormFillEngine.ts:402` 与 `useFloatFill.ts:61` 的 `verified` 列表内 → 直接判定成功 → `markSubmitted` 入库。

`navigating`/`pagehide` 无法区分「已发布」与「待审核」——两者都是整页跳转。这是核心 bug。

> AJAX 待审核路径（`content.ts:439-441`）能工作，因为 AJAX 不卸载页面，可延迟 1500ms 再查 DOM；但原生跳转做不到。

## 3. 目标与非目标

**目标**

- WP 原生整页跳转的待审核评论 → 判定失败，不入库；已入库则移出。
- 检测信号覆盖 URL 参数（`unapproved`+`moderation-hash`）与 DOM 文本（多语种「待审核」/ `comment-awaiting-moderation` 元素）。
- 不引入新的浏览器权限。

**非目标**

- 不改动 `directory_submit` 流程。
- 不改动验证码检测、登录跳转检测、AJAX 提交复核（既有逻辑保留）。
- 不补 useFloatFill 完整 chrome mock 单测（既有 TODO，超出本改动范围）。

## 4. 关键决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| 待审核时对 submissions 记录的处理 | `markFailed`（覆盖 submitted → failed） | 移出外链库且保留可追溯失败记录 |
| 检测广度 | URL 参数 + DOM 文本 | 覆盖 WP 原生跳转 + 非 WP AJAX/其他 CMS |
| 整页跳转后的验证机制 | 引擎侧「跳转后验证」（方案 A） | 引擎持有 `tabId`；WP 的 URL 约定可区分「待审核」(`unapproved+moderation-hash`) 与「已发布」(仅 `#comment-N`)；content script 是检测唯一真相源 |
| 跳转后验证超时 | 保守判失败（`unverified`） | 宁可误失败也不假入库 |
| 超时语义 | 新增 `unverified` 而非复用 `timeout` | `timeout`=完全没提交信号；`unverified`=提交跳转了但无法确认发布状态 |

## 5. 架构与数据流

成功判定从「提交瞬间」推迟到「跳转后页面落定」。content script 是审核检测的唯一真相源；引擎负责等待跳转落定、发问、据回答下结论。

```
1. 填写完成 → 引擎 sendToTab(submit) → content.ts performClick
2. waitForSubmitOrNavigate 返回信号
   （ajax / navigating / pagehide / login_required / pending_moderation[快速路径]）
3. content.ts 旧上下文判断：
   - login_required / pending_moderation → 直接返回失败信号
   - ajax → 保留，并立即 isModerationContent(document) 复核（AJAX 不卸载页面，已有逻辑）
4. 引擎收到 verifyResult：
   - 若是 navigating / pagehide（整页跳转）→ 进入【跳转后验证】
   - 其它（ajax/cleared/...）→ 沿用既有成功/失败判定
5.【跳转后验证】（新增，引擎侧）：
   a. 轮询 chrome.tabs.get(tabId).url，等重定向落定
      （≤6s，每 500ms；连续两次相同 或 出现 #comment/unapproved 即停）
   b. sendToTab 新消息 FLOAT_FILL action:'verify-moderation' 给新页面 content script
      （带重试，等新脚本就绪，复用现有 sendToTab 超时机制）
   c. content.ts 新增 handler：返回 { ok:true, moderation: detectModeration() }
6. 引擎据回复下结论：
   - moderation=true → 改写 verifyResult='pending_moderation' → markFailed
   - moderation=false → 维持 navigating/pagehide（确认已发布）→ markSubmitted
   - 超时无回复 → 改写 verifyResult='unverified' → markFailed（保守）
7. useFloatFill 按 verifyResult 是否 ∈ VERIFIED_SUCCESS 决定 markSubmitted / markFailed
```

**关键不变量**

- `navigating`/`pagehide` 仍是「成功」语义，但**仅在跳转后验证通过时才成立**——验证失败会被引擎改写成 `pending_moderation` 或 `unverified`，从而落到 markFailed。
- 检测函数 `isModerationUrl` / `isModerationContent` 只在 content script 侧定义，引擎不重复实现。
- 整页跳转走「跳转后 URL+DOM 验证」；AJAX 走「提交后 DOM 复核」（既有）；两条路径都收敛到 `pending_moderation → markFailed`。

## 6. 组件改动（逐文件）

### 6.1 `extension/src/agent/types.ts`

- `VerifyResult` 新增 `'unverified'`。
- 新增导出常量 `VERIFIED_SUCCESS: readonly VerifyResult[] = ['ajax', 'cleared', 'navigating', 'pagehide']`，替换 `FormFillEngine.ts:402` 与 `useFloatFill.ts:61` 两处重复的成功白名单。

### 6.2 `extension/src/agent/comment-submit.ts`

- `isModerationUrl` / `isModerationContent` 已存在且已 export，复用。
- 新增组合 helper `detectModeration(): boolean`（= `isModerationUrl(location.href) || isModerationContent(document)`），供 content.ts 两个 handler 共用。

### 6.3 `extension/src/entrypoints/content.ts`

- 新增 `case 'verify-moderation'`：返回 `{ ok: true, moderation: detectModeration() }`。这是新页面 content script 对引擎「这页是不是待审核」的权威回答。
- 现有 `submit` handler 保留：AJAX 路径的 `isModerationContent` 复核（`content.ts:439`）继续有效；Navigation API 快速路径（`pending_moderation`）作为早期信号保留但不依赖。

### 6.4 `extension/src/agent/FormFillEngine.ts`

- 抽取 `verifyAfterNavigation(tabId, deps)` 为 DI 纯函数，返回 `'confirmed' | 'moderation' | 'unverified'`。`deps` 注入 `getTabUrl`、`sendVerify`、`sleep`（便于单测），默认值对接真实 `chrome.tabs.get` 与 `sendToTab`。
  - 轮询 `getTabUrl` 等 URL 落定（≤ `settleTimeoutMs=6000`，每 `pollMs=500`；连续两次相同 或 出现 `#comment`/`unapproved` 即停）。
  - `sendVerify(tabId)`（带 2 次重试等新脚本就绪，复用现有 sendToTab 超时机制）。
- 在拿到 `submitResponse.verifyResult` 后（`L398-402` 附近）：若 ∈ `{navigating, pagehide}`，调用 `verifyAfterNavigation(tabId)`，据返回改写 `verifyResult`：`confirmed`→维持；`moderation`→`'pending_moderation'`；`unverified`→`'unverified'`。
- 成功判定改用 `VERIFIED_SUCCESS.includes(verifyResult)`。

### 6.5 `extension/src/hooks/useFloatFill.ts`

- `L61` 的写死数组换成 `VERIFIED_SUCCESS.includes(...)`。逻辑不变（引擎已把 moderation/unverified 改写成非成功值），口径统一。
- markFailed 分支已带 `submitError + verifyResult`，无需改。

## 7. 边界与错误处理

| 场景 | 处理 |
|---|---|
| AJAX 提交待审核 | 既有 `content.ts:439` DOM 复核 → `pending_moderation` → markFailed（不变） |
| 原生整页跳转 + WP 待审核 | **新增**：跳转后 verify-moderation 返回 moderation=true → `pending_moderation` → markFailed |
| 原生整页跳转 + 已发布 | verify-moderation 返回 false（URL 仅 `#comment-N`，无待审核文本）→ 维持 navigating/pagehide → markSubmitted |
| 跳转后 URL 落定但 content script 无响应（错误页/被拦） | verify-moderation 超时 → `unverified` → markFailed（保守） |
| `pending_moderation`（Navigation API 快速路径命中） | 直接失败，跳过跳转后验证 |
| 已是 submitted 记录，复跑命中审核 | markFailed 覆盖为 failed（移出外链库），error='评论待审核，未发布' |
| 验证码 / 找不到按钮 / login_required | 既有逻辑不变（not_attempted / login_required → 失败） |
| directory_submit | 不走提交验证，逻辑不变 |

**轮询防抖**：URL 落定判定用「连续两次相同」避免重定向中途误判；`wp-comments-post.php` 302 跳转后 Chrome 的 `tab.url` 会指向最终文章页，能拿到 `unapproved`/`#comment`。

**不变量**：成功判定只信「跳转后页面状态」。任何无法确认为已发布的情况都不入库。

## 8. 测试计划（TDD）

遵循项目「依赖注入 + 测试驱动」约定（参考 `performClick` 注入 `waitFor` 的模式）。

### 8.1 `comment-submit.test.ts` — 新增 `detectModeration()` 用例

- URL 含 `unapproved`+`moderation-hash` → `true`
- DOM 含 `awaiting moderation` 文本 → `true`
- 普通页 → `false`

### 8.2 `verifyAfterNavigation()` DI 纯函数单测

注入 `getTabUrl`/`sendVerify`/`sleep`：

- URL 落定为 moderation 参数 + `sendVerify`→`moderation:true` → `'moderation'`
- URL 落定正常 + `sendVerify`→`moderation:false` → `'confirmed'`
- URL 落定但 `sendVerify` 超时无响应 → `'unverified'`
- URL 一直不稳（停在 `wp-comments-post.php`）超出窗口 → `'unverified'`

### 8.3 FormFillEngine 改写 verifyResult 的集成断言

- `submitResponse.verifyResult='navigating'` + 验证返回 `'moderation'` → 最终 `'pending_moderation'`
- 验证返回 `'confirmed'` → 维持 `'navigating'`
- 验证返回 `'unverified'` → `'unverified'`
- `verifyResult='ajax'` → **跳过**跳转后验证（AJAX 走 DOM 复核）

### 8.4 content.ts `verify-moderation` handler

handler 仅 1 行委托 `detectModeration()`，已被 8.1 覆盖；content.ts 为带副作用 entrypoint 不直接单测，靠透传保证。

### 8.5 useFloatFill 入库映射

`L60` 既有 TODO「入库映射逻辑待补单测（需 mock chrome）」。本次写死数组→`VERIFIED_SUCCESS` 常量属低风险替换；完整 chrome mock 单测超出本改动范围，标注为「手动验证矩阵覆盖 + 后续补单测」。

## 9. 手动验证矩阵（实现后）

| 站点类型 | 提交结果 | 期望 verifyResult | 期望入库状态 |
|---|---|---|---|
| WP 原生（historicmotorsportshow） | 跳转 `?unapproved=&moderation-hash=` | `pending_moderation` | failed（不入库） |
| WP 原生（已发布的站点） | 跳转 `#comment-N` 无审核参数 | `navigating` | submitted |
| WP AJAX 评论 | DOM 出现 `awaiting moderation` | `pending_moderation` | failed |
| 需登录站点 | 跳转登录页 | `login_required` | failed（不变） |
| 带验证码 | 检测到 widget | `not_attempted` | failed（不变） |

## 10. 风险与回滚

- **风险**：跳转后验证增加 ~3-6s 延迟才入库。可接受（自动提交本就异步）。
- **风险**：URL 落定判定在极端慢网络下可能误判 `unverified` → 误失败。窗口设 6s，可调；且 WP 场景 URL 决定性，误判概率低。
- **回滚**：改动集中在 types/content/FormFillEngine/useFloatFill 四处 + 新增 helper，git revert 单提交即可还原。
