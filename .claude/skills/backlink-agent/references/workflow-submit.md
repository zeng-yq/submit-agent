# 提交流程参考

> 文件路径：`${SKILL_DIR}/references/workflow-submit.md`

---

## 1. 目录提交流程

1. 通过 `/new` 打开目标站点的 `submitUrl`
2. 等待页面加载完成（`/info` 确认 ready 为 complete）
3. 调用 `form-analyzer.js` 注入分析表单结构
4. 调用 `honeypot-detector.js` 注入检测蜜罐字段
5. Claude 分析字段 + 活跃产品信息，生成字段映射
6. 设置 `window.__FILL_DATA__`，调用 `form-filler.js` 注入填写
7. 用户确认后通过 `/click` 点击提交按钮
8. 将结果写入数据库（subagent 自行写入）
9. `/close` 关闭 tab

## 2. 博客评论流程

1. 通过 `/new` 打开目标页面
2. 调用 `comment-expander.js` 注入展开评论区域
3. 等待 ~1 秒让 DOM 更新
4. 调用 `form-analyzer.js` 注入分析评论表单
5. 调用 `page-extractor.mjs` 提取页面内容
6. Claude 阅读页面内容，生成相关评论（80-300 字符）
7. 决定链接放置策略（URL 字段 > name 字段 > 正文 HTML）
8. 设置 `window.__FILL_DATA__`，调用 `form-filler.js` 注入填写
9. 用户确认后提交
10. 将结果写入数据库（subagent 自行写入）
11. `/close` 关闭 tab

**form-filler.js 调用方式（两步注入）：**

```bash
# 步骤 1: 设置填写数据
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "window.__FILL_DATA__ = { fields: { 'field_0': 'value1', 'field_1': 'value2' } }"

# 步骤 2: 执行填写脚本
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${SKILL_DIR}/scripts/injection/form-filler.js")"
```

---

## 3. 站点经验查询与更新

提交前查询目标域名的站点经验：

```bash
node "${SKILL_DIR}/scripts/data/db-ops.mjs experience <domain>
```

### 有经验

根据经验调整策略：
- `fillStrategy` 决定使用哪种填充方式（direct / execCommand / reactSetter）
- `effectivePatterns` 指导具体操作顺序
- `knownTraps` 提醒需要避免的陷阱

### 无经验

正常流程完成后，将发现的操作经验写入数据库：

```bash
node "${SKILL_DIR}/scripts/data/db-ops.mjs upsert-experience <domain> '<experienceJSON>'
```

经验 JSON 格式：

```json
{
  "aliases": [],
  "submitType": "directory",
  "formFramework": "native",
  "antispam": "none",
  "fillStrategy": "direct",
  "postSubmitBehavior": "redirect",
  "effectivePatterns": ["有效策略描述"],
  "knownTraps": ["陷阱描述"]
}
```

字段说明：
- `aliases` — 域名别名或简称
- `submitType` — `"directory"` | `"blog-comment"`
- `formFramework` — 表单技术栈 (native/react/vue/wordpress)
- `antispam` — 反垃圾系统 (none/akismet/hcaptcha/etc)
- `fillStrategy` — 填充策略 (direct/execCommand/reactSetter)
- `postSubmitBehavior` — 提交后行为 (redirect/success-message/moderation-notice/silent)
- `effectivePatterns` — 已验证有效的操作策略数组
- `knownTraps` — 已知的陷阱和注意事项数组

### 经验过时

策略失败时更新对应条目：

```bash
node "${SKILL_DIR}/scripts/data/db-ops.mjs upsert-experience <domain> '<updatedExperienceJSON>'
```

---

## 4. 提交记录写入

提交完成后，subagent **自行写入**结果到数据库，不由主 agent 代写。

### 写入命令

使用 `add-submission` 命令一次性写入提交记录和站点经验：

```bash
node "${SKILL_DIR}/scripts/data/db-ops.mjs add-submission '<submissionJSON>' '<experienceJSON>'
```

### 记录格式

提交记录 JSON：

```json
{
  "id": "sub-{timestamp}-{random4hex}",
  "siteName": "domain.com",
  "siteUrl": "https://domain.com/submit",
  "productId": "prod-001",
  "status": "submitted | failed | skipped",
  "submittedAt": "2025-01-01T00:00:00Z",
  "result": "提交成功，等待审核",
  "fields": { "name": "产品名", "email": "founder@example.com" }
}
```

### 返回给主 agent

写入完成后，subagent 只返回一行摘要：

```
{domain} | 成功/失败 | 一句话说明
```

主 agent 不需要完整的过程细节，只用于调度和进度追踪。

---

## 5. 提交记录查询

查看和统计提交历史：

```bash
# 获取指定产品的提交记录
node "${SKILL_DIR}/scripts/data/db-ops.mjs submissions <productId>"

# 数据库统计概览（含提交记录按状态分组）
node "${SKILL_DIR}/scripts/data/db-ops.mjs stats"
```

- 按状态筛选：`submitted` / `failed` / `skipped`
- 按产品筛选：`productId`
- 统计总提交数、成功率、失败原因分布

---

## 6. 注入脚本参考

### detect-comment-form.js

检测页面是否包含评论表单及相关信号。
返回 JSON：hasTextarea、hasUrlField、hasAuthorField、hasEmailField、hasCommentForm、isWordPress、commentSystem 等。

```bash
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${SKILL_DIR}/scripts/detect-comment-form.js")"
```

### detect-antispam.js

检测页面使用的反垃圾系统。
返回 JSON：detected 数组（name、bypassable、evidence）、hasBypassable、hasUnbypassable、count。

```bash
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${SKILL_DIR}/scripts/detect-antispam.js")"
```

### form-analyzer.js

扫描所有表单元素，返回结构化字段描述。
返回值：fields（字段数组）、forms（表单分组）、page_info（页面信息）。

```bash
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${SKILL_DIR}/scripts/injection/form-analyzer.js")"
```

### honeypot-detector.js

检测蜜罐表单字段，7 维评分系统。
返回值：`{ total, suspicious, honeypots, all }`

```bash
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${SKILL_DIR}/scripts/injection/honeypot-detector.js")"
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
  -d "$(cat "${SKILL_DIR}/scripts/injection/comment-expander.js")"
```

### page-extractor.mjs

通过 CDP Proxy 提取页面正文文本和评论信号。
输出 JSON：title、textContent（截断 8000 字符）、commentSignals、url。

```bash
node "${SKILL_DIR}/scripts/browser/page-extractor.mjs" <targetId>
```

---

## 7. 串行提交策略

每次由 **1 个 subagent** 处理 **1 个站点**，完成后由主 agent 调度下一个。主 agent 只做轻量调度，不承载业务数据。

### 设计原则

- **主 agent 是调度器**：只持有待提交域名列表和每个域名的简短状态，不读取/传递业务数据
- **Subagent 自给自足**：自行通过 `db-ops.mjs` 读取数据、操控浏览器、写入结果
- **返回最小摘要**：subagent 只向主 agent 返回一行结果，不回传完整过程

### 调度循环

```
主 Agent                          Subagent
  │                                  │
  │  1. 查询 backlinks 表            │
  │     筛选可提交条目                │
  │                                  │
  │── 派发: domain + productId ──→   │
  │                                  │  2. 自行查询 products 表
  │                                  │  3. 自行查询 site_experience 表
  │                                  │  4. 创建 tab，执行提交
  │                                  │  5. 自行写入 submissions 表
  │                                  │  6. 自行更新 site_experience 表
  │                                  │  7. 关闭 tab
  │←── 返回: 简短摘要 ──────────────│
  │                                  │
  │  8. 更新内部状态，                │
  │     派发下一个站点                │
  │                                  │
  │  ... 重复直到全部完成 ...         │
```

### Subagent prompt 模板

```
在 {domain} 提交产品 {productId}。

数据操作：
- 查询产品：node "${SKILL_DIR}/scripts/data/db-ops.mjs product <productId>
- 查询站点经验：node "${SKILL_DIR}/scripts/data/db-ops.mjs experience <domain>
- 查询站点详情：node "${SKILL_DIR}/scripts/data/db-ops.mjs site <domain>
- 写入提交记录和经验：node "${SKILL_DIR}/scripts/data/db-ops.mjs add-submission '<submissionJSON>' '<experienceJSON>'
- 更新站点经验：node "${SKILL_DIR}/scripts/data/db-ops.mjs upsert-experience <domain> '<experienceJSON>'

要求：
- 必须加载 backlink-agent skill 并遵循指引
- 完成后自行将结果写入数据库（使用 add-submission 命令）
- 如有新的站点经验，自行写入数据库（使用 upsert-experience 命令）
- 完成后自行关闭创建的 tab
- 返回简短摘要：域名 + 成功/失败 + 一句话说明

返回格式：
{domain} | 成功/失败 | 一句话说明
```

### 并行控制规则

- **严格串行**：每次只有 1 个 subagent 运行
- **失败不重试**：标记为 `failed` 的记录保持 failed，不自动重试
- **进度报告**：每完成 1 个站点后报告进度
- **上下文控制**：主 agent 上下文只增加一行摘要（约 50 tokens）每条记录

---

## 8. 站点经验系统

提交阶段的效率加速器。仅用于表单提交过程，分析阶段不使用。

### 使用流程

**提交前**：查询 `site_experience` 表，查找目标域名的操作经验。

```bash
node "${SKILL_DIR}/scripts/data/db-ops.mjs experience <domain>
```

**有经验**：根据 `fillStrategy` 选择填充方式，按 `effectivePatterns` 操作，避开 `knownTraps`。

**无经验**：正常提交流程，完成后将发现的操作经验写入数据库。

```bash
node "${SKILL_DIR}/scripts/data/db-ops.mjs upsert-experience <domain> '<experienceJSON>'
```

**经验过时**：策略失败时更新对应条目。

经验是提示，不是保证——站点可能更新，遇到失效时立即回退通用模式并更新经验。

### 经验 JSON 格式

```json
{
  "aliases": [],
  "submitType": "directory",
  "formFramework": "native",
  "antispam": "none",
  "fillStrategy": "direct",
  "postSubmitBehavior": "redirect",
  "effectivePatterns": ["有效策略描述"],
  "knownTraps": ["陷阱描述"]
}
```

字段说明：
- `aliases` — 域名别名或简称
- `submitType` — `"directory"` | `"blog-comment"`
- `formFramework` — 表单技术栈 (native/react/vue/wordpress)
- `antispam` — 反垃圾系统 (none/akismet/hcaptcha/etc)
- `fillStrategy` — 填充策略 (direct/execCommand/reactSetter)
- `postSubmitBehavior` — 提交后行为 (redirect/success-message/moderation-notice/silent)
- `effectivePatterns` — 已验证有效的操作策略数组
- `knownTraps` — 已知的陷阱和注意事项数组

---

## 9. 相关参考

- 数据格式规范：`${SKILL_DIR}/references/data-formats.md`
- CDP Proxy API：`${SKILL_DIR}/references/cdp-proxy-api.md`
