# backlink-agent 架构升级实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 backlink-agent skill 从程序化手册升级为"原则+参考"的决策框架架构，对标 web-access 的设计理念。

**Architecture:** 将 SKILL.md 从 702 行的操作手册重构为 ~250 行的决策框架，详细步骤拆分到 4 个独立的 workflow 参考文件。新增站点经验系统（单 JSON 文件）和并行提交策略。CDP 代理保持独立但 API 风格对齐 web-access。

**Tech Stack:** Node.js 22+, Chrome DevTools Protocol, Claude Code Skill

---

### Task 1: 创建站点经验数据文件

**Files:**
- Create: `.claude/skills/backlink-agent/data/site-experience.json`

- [ ] **Step 1: 创建空的站点经验文件**

创建 `data/site-experience.json`，内容为空 JSON 对象：

```json
{}
```

- [ ] **Step 2: 验证文件格式**

运行：
```bash
node -e "console.log('valid:', typeof JSON.parse(require('fs').readFileSync('.claude/skills/backlink-agent/data/site-experience.json', 'utf8')))"
```
预期输出：`valid: object`

- [ ] **Step 3: 提交**

```bash
git add .claude/skills/backlink-agent/data/site-experience.json
git commit -m "feat(backlink-agent): 添加站点经验数据文件"
```

---

### Task 2: 创建 workflow-import.md

**Files:**
- Create: `.claude/skills/backlink-agent/references/workflow-import.md`

- [ ] **Step 1: 创建导入流程参考文件**

从现有 SKILL.md 第 4.2 节（产品确认）和第 4.3 节（外链导入）提取内容，写入独立参考文件。

文件内容：

```markdown
# 导入流程参考

> 文件路径：`${CLAUDE_SKILL_DIR}/references/workflow-import.md`

---

## 1. 产品确认

外链建设必须关联一个产品。流程如下：

### 步骤 1：读取产品列表

使用 Read 工具读取 `${CLAUDE_SKILL_DIR}/data/products.json`。

### 步骤 2：处理空列表

如果文件为空数组 `[]`，提示用户创建产品：

> 未找到产品资料。请提供以下信息来创建产品：
>
> - **name** — 产品名称
> - **url** — 产品官网
> - **tagline** — 一句话简介
> - **shortDesc** — 简短描述（100字以内）
> - **longDesc** — 详细描述（300字以内）
> - **categories** — 分类标签（如 SaaS、Productivity）
> - **anchorTexts** — 外链锚文本列表（3-5个）
> - **logoUrl** — Logo 图片地址
> - **socialLinks** — 社交媒体链接
> - **founderName** — 创始人姓名
> - **founderEmail** — 创始人邮箱

用户信息收集完毕后，生成产品记录并写入 `products.json`。

也可以通过产品资料生成脚本自动提取：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/product-generator.mjs" <product-url>
```

脚本输出 JSON 包含 title、metaDescription、ogTitle、ogDescription、headings、bodyText。
Claude 基于提取结果生成产品记录（name、tagline、shortDesc、longDesc、categories、anchorTexts），写入 `products.json`。

### 步骤 3：多产品选择

如果产品列表中有多个产品，展示列表让用户选择当前要操作的产品。记录选中的产品 ID 为本次任务的「活跃产品」。

### 步骤 4：确认活跃产品

在后续所有操作中，始终使用确认的活跃产品。如果用户中途切换产品，需重新确认。

---

## 2. 外链导入

将外链候选数据导入 `backlinks.json`。支持两种导入方式：

### 方式 A：Semrush CSV 导入（推荐）

用户提供 Semrush 导出的 CSV 文件路径。

**步骤：**

1. 运行 CSV 导入脚本：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/import-csv.mjs" <csv-file-path> "${CLAUDE_SKILL_DIR}/data/backlinks.json"
```

2. 脚本输出 JSON，包含 `imported`（新增数量）、`skipped`（重复跳过数量）、`records`（新记录数组）
3. 读取脚本输出的 JSON
4. 读取现有 `${CLAUDE_SKILL_DIR}/data/backlinks.json`
5. 将新记录合并到现有数组末尾
6. 使用 Write 工具写回 `backlinks.json`

**字段映射（脚本自动处理）：**

| Semrush 字段 | 系统字段 | 说明 |
|-------------|---------|------|
| Source url | sourceUrl | 来源页面 URL |
| Source title | sourceTitle | 来源页面标题 |
| Page ascore | pageAscore | 页面权威度评分（数字） |

**去重规则：**
- 脚本自动按 `sourceUrl` 去重（对比 `backlinks.json` 已有记录）
- 重复记录计入 `skipped` 数量，不写入输出

### 方式 B：手动 URL 列表

用户提供一个或多个 URL，每行一个。

**步骤：**

1. 逐行解析 URL
2. 对每个 URL 生成记录：
   - `sourceUrl` = 原始 URL
   - `sourceTitle` = 空
   - `pageAscore` = 0
   - `id` = `bl-` + 时间戳 + `-` + 4 位随机十六进制
   - `domain` = `new URL(sourceUrl).hostname`
   - `status` = `pending`
   - `analysis` = `null`
   - `addedAt` = 当前 ISO 时间
3. 按 `sourceUrl` 去重
4. 合并到 `backlinks.json` 并写回
```

- [ ] **Step 2: 验证文件格式**

运行：
```bash
head -5 .claude/skills/backlink-agent/references/workflow-import.md
```
预期：文件以 `# 导入流程参考` 开头。

- [ ] **Step 3: 提交**

```bash
git add .claude/skills/backlink-agent/references/workflow-import.md
git commit -m "docs(backlink-agent): 拆分导入流程为独立参考文件"
```

---

### Task 3: 创建 workflow-analyze.md

**Files:**
- Create: `.claude/skills/backlink-agent/references/workflow-analyze.md`

- [ ] **Step 1: 创建分析流程参考文件**

从现有 SKILL.md 第 4.4 节（批量分析可发布性）和第 4.5 节（报告输出）提取内容。

文件内容：

```markdown
# 分析流程参考

> 文件路径：`${CLAUDE_SKILL_DIR}/references/workflow-analyze.md`

---

## 1. 单条分析流程

对 `backlinks.json` 中每条 `status: "pending"` 的记录执行以下步骤：

### 步骤 1：域名去重检查

读取 `${CLAUDE_SKILL_DIR}/data/sites.json`，如果该记录的 `domain` 已存在于站点库中，直接将 status 更新为 `skipped`，跳过后续步骤。

### 步骤 2：打开页面

```bash
curl -s "http://localhost:3457/new?url=<sourceUrl>"
# 返回 {"targetId":"xxx"}，记录此 ID
```

### 步骤 3：确认页面加载

```bash
curl -s "http://localhost:3457/info?target=<targetId>"
# 确认 ready 为 "complete"
```

如果 ready 不是 `complete`，等待最多 30 秒。超时则标记该条为 `error` 并跳过。

### 步骤 4：结构化检测

分别执行评论表单检测和反垃圾系统检测：

```bash
# 评论表单检测
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${CLAUDE_SKILL_DIR}/scripts/detect-comment-form.js")"

# 反垃圾系统检测
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${CLAUDE_SKILL_DIR}/scripts/detect-antispam.js")"
```

### 步骤 5：快速判定

基于步骤 4 的结构化检测结果，尝试快速判定：

- **直接判定为 `not_publishable`**：
  - 存在 `bypassable: false` 的反垃圾系统（CleanTalk、hCaptcha、Jetpack）
  - 存在 `bypassable: 'depends_on_config'` 的反垃圾系统（保守策略）
  - `commentSystem` 为 `none` 且 `hasTextarea` 为 `false` 且 `hasCommentForm` 为 `false`

- **直接判定为 `publishable`**：
  - `commentSystem` 为 `native` 且 `hasTextarea` 为 `true` 且 `hasUnbypassable` 为 `false`

如果快速判定结果明确，跳过步骤 6，直接进入步骤 7。

### 步骤 6：Claude 综合判定（仅对快速判定无法明确的情况）

当评论系统为 Disqus/Facebook/Commento 等第三方系统，或评论信号模糊时，需要 Claude 做语义分析：

1. 执行页面内容提取脚本：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/page-extractor.mjs" <targetId>
```

2. 将提取结果（title、textContent、commentSignals）与步骤 4 的检测结果一起交给 Claude 分析
3. Claude 根据 `publishability-rules.md` 中的规则，综合判断可发布性
4. 输出判定结果：`{ status, category, reason }`

**需要 Claude 判定的典型场景：**
- 评论系统为 `disqus` / `facebook` / `commento`（第三方系统，需判断是否可操作）
- 存在 `bypassable: 'depends_on_config'` 的反垃圾（需具体分析）
- `commentSystem` 为 `none` 但 `hasTextarea` 为 `true`（textarea 用途不明确）

### 步骤 7：写回数据

将分析结果写入该条记录的 `analysis` 字段（格式见 `references/publishability-rules.md` 7.3 节），更新 `status`。使用 Write 工具写回 `backlinks.json`。

如果判定为 `publishable`，同时创建站点记录写入 `sites.json`。

### 步骤 8：关闭 tab

```bash
curl -s "http://localhost:3457/close?target=<targetId>"
```

---

## 2. 批量处理规则

- **逐条分析**：每次只打开一个 tab，分析完立即关闭再打开下一个
- **即时写回**：每条分析完成后立即更新 `backlinks.json`，防止中途丢失
- **进度报告**：每分析完 10 条，向用户报告进度（已完成/总数）
- **超时处理**：单条分析超过 30 秒标记为 `error` 并跳过，继续下一条
- **可恢复**：如果中途中断，下次启动时只会处理 `status: "pending"` 的记录

---

## 3. 报告输出

批量分析完成后，生成并展示分析报告。

### 3.1 总览

```
外链分析报告
============
总数：N
可发布：A（X%）
不可发布：B（Y%）
已跳过：C（Z%）
分析出错：D
```

### 3.2 可发布站点列表

按 `pageAscore` 降序排列，展示：

| 排名 | 域名 | URL | 分类 | 评论系统 | 反垃圾系统 | AScore |
|------|------|-----|------|---------|-----------|--------|
| 1 | example.com | https://example.com/... | blog_comment | native | 无 | 85 |

### 3.3 反垃圾系统分布

```
反垃圾系统分布：
- 无反垃圾：45（60%）
- Akismet：15（20%）
- Anti-spam Bee：10（13%）
- hCaptcha：3（4%）
- CleanTalk：2（3%）
```

### 3.4 不可发布原因分布

```
不可发布原因：
- 无评论表单信号：25（62%）
- 不可绕过的反垃圾系统：10（25%）
- 页面无法访问：5（13%）
```

### 3.5 后续建议

根据分析结果给出可操作的建议：
- 将 `publishable` 的站点自动迁移到 `sites.json`（需用户确认）
- 按反垃圾系统类型分组，推荐处理优先级
- 标注可直接操作的站点（无反垃圾 + 原生评论表单）

---

## 4. 相关参考

- 可发布性判定规则：`${CLAUDE_SKILL_DIR}/references/publishability-rules.md`
- 数据格式规范：`${CLAUDE_SKILL_DIR}/references/data-formats.md`
```

- [ ] **Step 2: 验证文件格式**

运行：
```bash
head -5 .claude/skills/backlink-agent/references/workflow-analyze.md
```
预期：文件以 `# 分析流程参考` 开头。

- [ ] **Step 3: 提交**

```bash
git add .claude/skills/backlink-agent/references/workflow-analyze.md
git commit -m "docs(backlink-agent): 拆分分析流程为独立参考文件"
```

---

### Task 4: 创建 workflow-submit.md

**Files:**
- Create: `.claude/skills/backlink-agent/references/workflow-submit.md`

- [ ] **Step 1: 创建提交流程参考文件**

从现有 SKILL.md 第 4.6 节（表单提交）、第 4.7 节（提交记录管理）和第 5-6.6 节（注入脚本说明）提取内容。

文件内容：

```markdown
# 提交流程参考

> 文件路径：`${CLAUDE_SKILL_DIR}/references/workflow-submit.md`

---

## 1. 目录提交流程

1. 通过 `/new` 打开目标站点的 `submitUrl`
2. 等待页面加载完成（`/info` 确认 ready 为 complete）
3. 调用 `form-analyzer.js` 注入分析表单结构
4. 调用 `honeypot-detector.js` 注入检测蜜罐字段
5. Claude 分析字段 + 活跃产品信息，生成字段映射
6. 设置 `window.__FILL_DATA__`，调用 `form-filler.js` 注入填写
7. `/screenshot` 截图确认 → 展示给用户
8. 用户确认后通过 `/click` 点击提交按钮
9. 记录到 `data/submissions.json`
10. `/close` 关闭 tab

## 2. 博客评论流程

1. 通过 `/new` 打开目标页面
2. 调用 `comment-expander.js` 注入展开评论区域
3. 等待 ~1 秒让 DOM 更新
4. 调用 `form-analyzer.js` 注入分析评论表单
5. 调用 `page-extractor.mjs` 提取页面内容
6. Claude 阅读页面内容，生成相关评论（80-300 字符）
7. 决定链接放置策略（URL 字段 > name 字段 > 正文 HTML）
8. 设置 `window.__FILL_DATA__`，调用 `form-filler.js` 注入填写
9. `/screenshot` 截图确认 → 用户确认 → 提交
10. 记录到 `data/submissions.json`
11. `/close` 关闭 tab

**form-filler.js 调用方式（两步注入）：**

```bash
# 步骤 1: 设置填写数据
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "window.__FILL_DATA__ = { fields: { 'field_0': 'value1', 'field_1': 'value2' } }"

# 步骤 2: 执行填写脚本
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${CLAUDE_SKILL_DIR}/scripts/form-filler.js")"
```

---

## 3. 站点经验查询与更新

提交前读取 `${CLAUDE_SKILL_DIR}/data/site-experience.json`，查找目标域名。

### 有经验

根据经验调整策略：
- `fillStrategy` 决定使用哪种填充方式（direct / execCommand / reactSetter）
- `effectivePatterns` 指导具体操作顺序
- `knownTraps` 提醒需要避免的陷阱

### 无经验

正常流程完成后，将发现的操作经验写入 `site-experience.json`：

```json
{
  "domain.com": {
    "domain": "domain.com",
    "aliases": [],
    "updated": "2026-04-16",
    "submitType": "directory",
    "formFramework": "native",
    "antispam": "none",
    "fillStrategy": "direct",
    "postSubmitBehavior": "redirect",
    "effectivePatterns": ["有效策略描述"],
    "knownTraps": ["陷阱描述"]
  }
}
```

字段说明：
- `domain` — 站点域名（JSON key）
- `aliases` — 域名别名或简称
- `updated` — 最后更新日期
- `submitType` — `"directory"` | `"blog-comment"`
- `formFramework` — 表单技术栈 (native/react/vue/wordpress)
- `antispam` — 反垃圾系统 (none/akismet/hcaptcha/etc)
- `fillStrategy` — 填充策略 (direct/execCommand/reactSetter)
- `postSubmitBehavior` — 提交后行为 (redirect/success-message/moderation-notice/silent)
- `effectivePatterns` — 已验证有效的操作策略数组
- `knownTraps` — 已知的陷阱和注意事项数组

### 经验过时

策略失败时更新对应条目，更新 `updated` 日期。

---

## 4. 提交记录管理

查看和统计提交历史。

- 所有提交记录存储在 `data/submissions.json`
- 按状态筛选：`submitted` / `failed` / `skipped`
- 按产品筛选：`productId`
- 统计总提交数、成功率、失败原因分布

---

## 5. 注入脚本参考

### detect-comment-form.js

检测页面是否包含评论表单及相关信号。
返回 JSON：hasTextarea、hasUrlField、hasAuthorField、hasEmailField、hasCommentForm、isWordPress、commentSystem 等。

```bash
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${CLAUDE_SKILL_DIR}/scripts/detect-comment-form.js")"
```

### detect-antispam.js

检测页面使用的反垃圾系统。
返回 JSON：detected 数组（name、bypassable、evidence）、hasBypassable、hasUnbypassable、count。

```bash
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${CLAUDE_SKILL_DIR}/scripts/detect-antispam.js")"
```

### form-analyzer.js

扫描所有表单元素，返回结构化字段描述。
返回值：fields（字段数组）、forms（表单分组）、page_info（页面信息）。

```bash
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${CLAUDE_SKILL_DIR}/scripts/form-analyzer.js")"
```

### honeypot-detector.js

检测蜜罐表单字段，7 维评分系统。
返回值：`{ total, suspicious, honeypots, all }`

```bash
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${CLAUDE_SKILL_DIR}/scripts/honeypot-detector.js")"
```

### form-filler.js

逐字段填写表单，兼容 React/Vue 受控组件。
使用两步注入（先设置 `window.__FILL_DATA__`，再执行脚本）。
返回值：`{ success, total, results: [{ canonical_id, status, filled, verified }] }`

### comment-expander.js

展开懒加载的评论表单区域（支持 wpDiscuz、WordPress 默认评论）。
CDP 页面上下文可直接访问 jQuery。
返回值：`{ found, triggerSelector, clicked, unhid, hint }`

```bash
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${CLAUDE_SKILL_DIR}/scripts/comment-expander.js")"
```

### page-extractor.mjs

通过 CDP Proxy 提取页面正文文本和评论信号。
输出 JSON：title、textContent（截断 8000 字符）、commentSignals、url。

```bash
node "${CLAUDE_SKILL_DIR}/scripts/page-extractor.mjs" <targetId>
```

---

## 6. 相关参考

- 数据格式规范：`${CLAUDE_SKILL_DIR}/references/data-formats.md`
- CDP Proxy API：`${CLAUDE_SKILL_DIR}/references/cdp-proxy-api.md`
```

- [ ] **Step 2: 验证文件格式**

运行：
```bash
head -5 .claude/skills/backlink-agent/references/workflow-submit.md
```
预期：文件以 `# 提交流程参考` 开头。

- [ ] **Step 3: 提交**

```bash
git add .claude/skills/backlink-agent/references/workflow-submit.md
git commit -m "docs(backlink-agent): 拆分提交流程为独立参考文件"
```

---

### Task 5: 创建 workflow-sync.md

**Files:**
- Create: `.claude/skills/backlink-agent/references/workflow-sync.md`

- [ ] **Step 1: 创建同步流程参考文件**

从现有 SKILL.md 第 4.8 节提取内容。

文件内容：

```markdown
# 同步流程参考

> 文件路径：`${CLAUDE_SKILL_DIR}/references/workflow-sync.md`

---

## 1. Google Sheets 同步

将本地 JSON 数据与 Google Sheet 双向同步。

### 前置条件

1. 配置 `data/sync-config.json` 中的服务账号密钥和 Sheet URL
2. 将 Sheet 分享给服务账号的邮箱地址

### 上传（本地 → Sheet）

```bash
node "${CLAUDE_SKILL_DIR}/scripts/sheets-sync.mjs" upload \
  --config "${CLAUDE_SKILL_DIR}/data/sync-config.json" \
  --data "${CLAUDE_SKILL_DIR}/data"
```

上传前自动备份现有 Sheet 数据，失败时自动回滚。

### 下载（Sheet → 本地）

```bash
node "${CLAUDE_SKILL_DIR}/scripts/sheets-sync.mjs" download \
  --config "${CLAUDE_SKILL_DIR}/data/sync-config.json" \
  --data "${CLAUDE_SKILL_DIR}/data"
```

### 同步的 4 个 Tab

products / submissions / sites / backlinks

---

## 2. 相关参考

- 数据格式规范：`${CLAUDE_SKILL_DIR}/references/data-formats.md`
```

- [ ] **Step 2: 验证文件格式**

运行：
```bash
head -5 .claude/skills/backlink-agent/references/workflow-sync.md
```
预期：文件以 `# 同步流程参考` 开头。

- [ ] **Step 3: 提交**

```bash
git add .claude/skills/backlink-agent/references/workflow-sync.md
git commit -m "docs(backlink-agent): 拆分同步流程为独立参考文件"
```

---

### Task 6: 重写 SKILL.md

**Files:**
- Modify: `.claude/skills/backlink-agent/SKILL.md` (完整重写)

- [ ] **Step 1: 重写 SKILL.md 为决策框架**

用 Write 工具完全重写 SKILL.md。新内容：

```markdown
---
name: backlink-agent
description: 外链分析与入库 Agent。通过 CDP 操控浏览器，完成外链候选导入、可发布性判断和站点入库。触发场景：用户要求分析外链、导入 Semrush 数据、批量检查页面可发布性、管理外链候选站点。
metadata:
  version: "2.0.0"
---

# Backlink Agent — 外链建设决策框架

## 前置检查

每次执行任务前，先确认环境就绪：

```bash
node "${SKILL_DIR}/scripts/check-deps.mjs"
```

脚本会依次检查 Node.js 22+、Chrome 远程调试端口、CDP Proxy（端口 3457）。

### 未通过时的引导

| 检查项 | 处理方式 |
|--------|---------|
| Node.js 版本过低 | 提示升级到 22+ |
| Chrome 未开启远程调试 | 引导打开 `chrome://inspect/#remote-debugging`，勾选 "Allow remote debugging" |
| CDP Proxy 连接超时 | 检查 Chrome 授权弹窗；查看日志 `$(getconf DARWIN_USER_TEMP_DIR)/cdp-proxy.log`（macOS）或 `/tmp/cdp-proxy.log`（Linux） |

### 通过后提示

> 环境就绪。CDP Proxy 运行在 `http://localhost:3457`。
> 所有浏览器操作将在后台 tab 中执行，不会干扰你当前的工作。
> 数据文件位于 `${SKILL_DIR}/data/` 目录。

---

## 核心理念

**带着目标进入，边看边判断，遇到阻碍就解决。**

### 外链工作的 4 阶段框架

**① 定义目标** — 明确要提交什么产品、什么类型的站点、达到什么效果。这是后续所有判断的锚点。

**② 选择策略** — 根据站点类型、已有经验（`data/site-experience.json`）、工具能力选择最可能成功的方式。先读站点经验，有经验则据此调整；无经验则走通用流程。

**③ 验证调整** — 每一步的结果都是证据。表单分析结果与预期不符？调整填充策略。提交后页面报错？分析错误原因并重试或回退。不在同一个失败的方法上反复尝试。

**④ 确认完成** — 对照原始目标检查：提交是否成功？记录是否写入？截图是否保存？

### 最小侵入原则

- 所有操作在后台 tab 中执行（`/new` with `background: true`）
- 不操作用户已有的 tab
- 完成后关闭自己创建的 tab
- CDP Proxy 持续运行，不主动停止

---

## 工具选择决策矩阵

根据场景选择最合适的工具，不要默认只用一种：

| 场景 | 工具 | 说明 |
|------|------|------|
| 需要页面上下文交互 | **CDP /eval** | 表单检测、DOM 查询、元素操控 |
| 需要提取页面正文供分析 | **page-extractor.mjs** | 提取纯文本 + 评论信号 |
| 需要兼容 React/Vue 填表 | **form-filler.js** | 原生 setter + _valueTracker + execCommand |
| 需要辅助信息（产品页面、元数据） | **curl / Jina** | 快速获取，无需 CDP |
| 需要同步到 Google Sheets | **sheets-sync.mjs** | 上传/下载，自动备份回滚 |

CDP Proxy API 速查（完整文档见 `references/cdp-proxy-api.md`）：

| 端点 | 用途 |
|------|------|
| GET /health | 健康检查 |
| GET /targets | 列出所有 Tab |
| GET /new?url= | 创建后台 Tab（自动等待加载） |
| GET /close?target= | 关闭 Tab |
| GET /navigate?target=&url= | 导航（自动等待加载） |
| GET /back?target= | 后退 |
| GET /info?target= | 页面标题/URL/状态 |
| POST /eval?target= | 执行 JS |
| GET /page-text?target= | 获取页面纯文本 |
| POST /setFiles?target= | 文件上传 |
| POST /click?target= | JS 点击（el.click()） |
| POST /clickAt?target= | CDP 真实鼠标点击 |
| GET /scroll?target=&y=&direction= | 滚动（含懒加载等待） |
| GET /screenshot?target=&file= | 截图 |

---

## 外链工作流概览

```
IMPORT ──→ ANALYZE ──→ SUBMIT ──→ SYNC
```

**IMPORT** — 导入外链候选数据到 `backlinks.json`
→ 详见 `references/workflow-import.md`

**ANALYZE** — 批量分析可发布性，判断每个候选是否可操作
→ 详见 `references/workflow-analyze.md`

**SUBMIT** — 对可发布站点执行表单填写和提交
→ 详见 `references/workflow-submit.md`

**SYNC** — 将本地数据同步到 Google Sheets
→ 详见 `references/workflow-sync.md`

每个阶段按需读取对应的参考文件，不需要提前全部加载。

---

## 站点经验系统

提交阶段的效率加速器。仅用于表单提交过程，分析阶段不使用。

**提交前**：读取 `${SKILL_DIR}/data/site-experience.json`，查找目标域名的操作经验。

**有经验**：根据 `fillStrategy` 选择填充方式，按 `effectivePatterns` 操作，避开 `knownTraps`。

**无经验**：正常提交流程，完成后将发现的操作经验写入该文件。

**经验过时**：策略失败时更新对应条目。

经验是提示，不是保证——站点可能更新，遇到失效时立即回退通用模式并更新经验。

---

## 并行提交策略

当有 **3+ 个可提交站点**时，启动并行提交模式。

### 规则

- **最多 3 个并行 agent**（避免 Chrome 资源耗尽）
- 每个 agent 各自创建独立标签页（`/new`），通过 `targetId` 识别
- 标签页是天然隔离的，不存在竞态条件
- 分析阶段**不并行**（需要 Claude 深度判断）

### 子 Agent prompt 模板

```
在 {domain} 提交产品 {productName}。

站点信息：{从 sites.json 提取的站点数据}
产品信息：{从 products.json 提取的产品数据}
站点经验：{从 site-experience.json 提取的经验，如有}

要求：
- 必须加载 backlink-agent skill 并遵循指引
- 提交完成后截图确认
- 将结果汇报给主 agent
```

### 结果收集

每个子 agent 完成后**汇报结果给主 agent**，由主 agent 统一写入 `submissions.json`。

---

## 行为准则

以下是外链建设过程中必须遵守的准则：

### 禁止设限

唯一合法的跳过理由：真付费墙、站已死（域名过期/404/无响应）、CF 硬封。其他"看起来难"都不是跳过理由。

### 前端不行先逆向

正常表单提交失败时：先查页面源码找隐藏 API → 检查网络请求分析提交逻辑 → 尝试直接调用后端 API。

### 去重按域名

同一域名下的不同页面视为同一个站点。去重以域名为单位。

### 查邮件必须开新标签页

查找联系邮箱时：必须用 `/new` 创建新 tab，在新 tab 中搜索，查找完毕后 `/close`。禁止在分析页面中跳转。

### rel 属性每次实测

外链的 `rel` 属性必须实际发布后检查，不依赖页面声明或他人报告。

### 先读知识库再操作

执行任何操作前，先读取相关数据文件（products.json、backlinks.json、sites.json），了解当前状态。

### 切站必须确认产品

切换到不同目标站点时，必须确认当前活跃产品。

### 邮箱失败立刻切换

自定义域名邮箱注册/提交失败时，立即切换到 Gmail 重试。

### 验证码协作先填完所有字段

遇到验证码时：先自动填写所有其他字段，最后再处理验证码。

---

## 错误处理

| 场景 | 处理方式 |
|------|---------|
| CDP Proxy 未启动 | 运行 `check-deps.mjs`，自动启动 Proxy |
| Chrome 未开启远程调试 | 提示用户启用远程调试 |
| 页面加载超时（>30s） | 标记 `error`，跳过继续 |
| CDP 连接断开 | Proxy 内置重连，持续失败则暂停提示 |
| JSON 文件损坏 | 提示用户，不自行覆盖 |
| 批量分析中途失败 | 已分析已写回，未分析的保持 `pending` |
| `/eval` 返回 JS 错误 | 检查 CSP 阻止，降级检测；标记 `error` 继续 |

---

## 任务结束

1. 关闭本次任务中创建的所有后台 tab（通过记录的 targetId 逐一 `/close`）
2. 不关闭用户原有的 tab
3. CDP Proxy 保持运行
4. 确认数据文件已正确写入

---

## References 索引

| 文件 | 何时加载 |
|------|---------|
| `references/cdp-proxy-api.md` | 需要 CDP API 详细参考时 |
| `references/data-formats.md` | 操作数据文件前，了解字段格式 |
| `references/publishability-rules.md` | 分析阶段，判断可发布性 |
| `references/workflow-import.md` | 进入导入阶段时 |
| `references/workflow-analyze.md` | 进入分析阶段时 |
| `references/workflow-submit.md` | 进入提交阶段时 |
| `references/workflow-sync.md` | 进入同步阶段时 |
```

- [ ] **Step 2: 验证 SKILL.md 行数**

运行：
```bash
wc -l .claude/skills/backlink-agent/SKILL.md
```
预期：~250 行（允许 ±30 行偏差）。

- [ ] **Step 3: 验证关键章节存在**

运行：
```bash
grep -c "## " .claude/skills/backlink-agent/SKILL.md
```
预期：输出 10-14 个二级标题。

运行：
```bash
grep "workflow-" .claude/skills/backlink-agent/SKILL.md
```
预期：包含 4 个 workflow 引用。

- [ ] **Step 4: 提交**

```bash
git add .claude/skills/backlink-agent/SKILL.md
git commit -m "refactor(backlink-agent): 重构 SKILL.md 为决策框架架构

从 702 行操作手册重构为 ~250 行决策框架：
- 核心内容拆分到 4 个 workflow 参考文件
- 新增站点经验系统和并行提交策略
- 采用目标驱动的 4 阶段框架"
```

---

### Task 7: 对齐 CDP Proxy API

**Files:**
- Modify: `.claude/skills/backlink-agent/scripts/cdp-proxy.mjs` (第 540-558 行，404 handler)

通过对比两个代理（backlink-agent 3457 vs web-access 3456），它们的代码已经完全一致，除了：
1. 端口号（3457 vs 3456）— 保持不变
2. backlink-agent 有额外的 `/page-text` 端点 — 保持不变
3. 404 handler 的端点列表略有不同 — 需要统一

- [ ] **Step 1: 更新 404 handler 的端点列表**

在 `.claude/skills/backlink-agent/scripts/cdp-proxy.mjs` 中，找到 404 handler（约第 540 行），将端点列表更新为完整版本：

将现有的 404 handler：
```javascript
      res.statusCode = 404;
      res.end(JSON.stringify({
        error: '未知端点',
        endpoints: {
          '/health': 'GET - 健康检查',
          '/targets': 'GET - 列出所有页面 tab',
          '/new?url=': 'GET - 创建新后台 tab（自动等待加载）',
          '/close?target=': 'GET - 关闭 tab',
          '/navigate?target=&url=': 'GET - 导航（自动等待加载）',
          '/back?target=': 'GET - 后退',
          '/info?target=': 'GET - 页面标题/URL/状态',
          '/page-text?target=': 'GET - 获取页面纯文本内容',
          '/eval?target=': 'POST body=JS表达式 - 执行 JS',
          '/click?target=': 'POST body=CSS选择器 - 点击元素',
          '/scroll?target=&y=&direction=': 'GET - 滚动页面',
          '/screenshot?target=&file=': 'GET - 截图',
        },
      }));
```

替换为（添加 `/clickAt`、`/setFiles`）：
```javascript
      res.statusCode = 404;
      res.end(JSON.stringify({
        error: '未知端点',
        endpoints: {
          '/health': 'GET - 健康检查',
          '/targets': 'GET - 列出所有页面 tab',
          '/new?url=': 'GET - 创建新后台 tab（自动等待加载）',
          '/close?target=': 'GET - 关闭 tab',
          '/navigate?target=&url=': 'GET - 导航（自动等待加载）',
          '/back?target=': 'GET - 后退',
          '/info?target=': 'GET - 页面标题/URL/状态',
          '/page-text?target=': 'GET - 获取页面纯文本内容',
          '/eval?target=': 'POST body=JS表达式 - 执行 JS',
          '/click?target=': 'POST body=CSS选择器 - JS 点击',
          '/clickAt?target=': 'POST body=CSS选择器 - CDP 真实鼠标点击',
          '/setFiles?target=': 'POST body=JSON - 文件上传',
          '/scroll?target=&y=&direction=': 'GET - 滚动页面',
          '/screenshot?target=&file=': 'GET - 截图',
        },
      }));
```

- [ ] **Step 2: 验证语法正确**

运行：
```bash
node --check .claude/skills/backlink-agent/scripts/cdp-proxy.mjs
```
预期：无输出（语法正确）。

- [ ] **Step 3: 提交**

```bash
git add .claude/skills/backlink-agent/scripts/cdp-proxy.mjs
git commit -m "fix(backlink-agent): 补全 CDP proxy 404 handler 端点列表

添加缺失的 /clickAt 和 /setFiles 端点到 404 响应中"
```

---

### Task 8: 验证 CDP Proxy API 参考完整性

**Files:**
- Verify: `.claude/skills/backlink-agent/references/cdp-proxy-api.md`

当前文件已包含所有端点的文档（包括 `/clickAt`、`/setFiles`、`/page-text`），无需修改。此步骤仅做验证。

> 注意：文件中使用的 `${CLAUDE_SKILL_DIR}` 与 SKILL.md 中的 `${SKILL_DIR}` 不同，但这是已有约定（所有 references/ 文件统一使用 `${CLAUDE_SKILL_DIR}`），不在本次改造范围内。

- [ ] **Step 1: 验证端点文档完整性**

运行：
```bash
grep -c "^###" .claude/skills/backlink-agent/references/cdp-proxy-api.md
```

预期：14-15 个端点小节（覆盖 health、targets、new、close、navigate、back、info、eval、page-text、setFiles、click、clickAt、scroll、screenshot）。

如果缺少任何端点的文档，使用 Edit 工具补充。

- [ ] **Step 2: 无需提交（除非 Step 1 发现缺失并补充了内容）**

---

### Task 9: 最终验证

**Files:** 无新文件

- [ ] **Step 1: 验证所有新增文件存在**

运行：
```bash
ls -la .claude/skills/backlink-agent/data/site-experience.json \
       .claude/skills/backlink-agent/references/workflow-import.md \
       .claude/skills/backlink-agent/references/workflow-analyze.md \
       .claude/skills/backlink-agent/references/workflow-submit.md \
       .claude/skills/backlink-agent/references/workflow-sync.md
```
预期：5 个文件都存在。

- [ ] **Step 2: 验证 SKILL.md 关键内容**

运行：
```bash
grep -c "并行提交策略" .claude/skills/backlink-agent/SKILL.md && \
grep -c "站点经验系统" .claude/skills/backlink-agent/SKILL.md && \
grep -c "workflow-import" .claude/skills/backlink-agent/SKILL.md && \
grep -c "workflow-analyze" .claude/skills/backlink-agent/SKILL.md && \
grep -c "workflow-submit" .claude/skills/backlink-agent/SKILL.md && \
grep -c "workflow-sync" .claude/skills/backlink-agent/SKILL.md
```
预期：每行输出 1。

- [ ] **Step 3: 验证 CDP proxy 可启动**

运行：
```bash
node --check .claude/skills/backlink-agent/scripts/cdp-proxy.mjs && \
node --check .claude/skills/backlink-agent/scripts/check-deps.mjs && \
echo "all scripts pass syntax check"
```
预期：`all scripts pass syntax check`。

- [ ] **Step 4: 验证验收标准**

对照设计文档的验收标准逐项检查：

1. SKILL.md 行数约 250 行 ✓
2. 四个 workflow 参考文件存在且包含详细步骤 ✓
3. CDP 代理 API 端点列表完整 ✓
4. `data/site-experience.json` 存在且为空对象 ✓
5. SKILL.md 包含站点经验系统说明和并行提交指引 ✓
6. 无对 web-access 的依赖 ✓
7. 所有脚本语法检查通过 ✓

- [ ] **Step 5: 最终提交（如有遗漏的修改）**

```bash
git status
```

如果有未提交的文件，提交它们。如果全部已提交，跳过此步骤。
