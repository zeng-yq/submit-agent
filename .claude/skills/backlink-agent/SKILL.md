---
name: backlink-agent
description: 外链分析与入库 Agent。通过 CDP 操控浏览器，完成外链候选导入、可发布性判断和站点入库。触发场景：用户要求分析外链、导入 Semrush 数据、批量检查页面可发布性、管理外链候选站点。
metadata:
  version: "1.0.0"
---

# Backlink Agent — 外链分析与入库指令手册

## 1. 前置条件

每次执行任务前，必须先确认环境就绪。按以下步骤检查：

### 1.1 运行环境检查脚本

```bash
node "${SKILL_DIR}/scripts/check-deps.mjs"
```

该脚本会依次检查：
- **Node.js** — 要求 22+（使用原生 WebSocket，无需额外依赖）
- **Chrome 远程调试** — 自动探测 DevToolsActivePort 文件或常见端口（9222/9229/9333）
- **CDP Proxy** — 自动启动 `cdp-proxy.mjs` 并等待连接就绪（端口 3457）

### 1.2 未通过时的引导

| 检查项 | 未通过时的处理 |
|--------|---------------|
| Node.js 版本过低 | 提示用户升级到 Node.js 22+ |
| Chrome 未开启远程调试 | 引导用户：打开 `chrome://inspect/#remote-debugging`，勾选 "Allow remote debugging"，或用命令行参数 `--remote-debugging-port=9222` 启动 Chrome |
| CDP Proxy 连接超时 | 检查 Chrome 是否有授权弹窗，提示用户点击「允许」；查看日志 `$(getconf DARWIN_USER_TEMP_DIR)/cdp-proxy.log`（macOS）或 `/tmp/cdp-proxy.log`（Linux） |

### 1.3 通过后提示

环境检查通过后，向用户展示以下温馨提示：

> 环境就绪。CDP Proxy 运行在 `http://localhost:3457`。
> 所有浏览器操作将在后台 tab 中执行，不会干扰你当前的工作。
> 数据文件位于 `${SKILL_DIR}/data/` 目录。

---

## 2. 数据文件

所有数据以 JSON 格式存储在 `${SKILL_DIR}/data/` 目录下。

操作数据前必须先读取格式规范了解各字段的含义和结构：
`${SKILL_DIR}/references/data-formats.md`

---

## 3. CDP Proxy API

CDP Proxy 运行在 `http://localhost:3457`，提供 HTTP 端点操控浏览器。
完整 API 文档（15 个端点的 curl 示例和返回值说明）：
`${SKILL_DIR}/references/cdp-proxy-api.md`

### 常用端点速查

| 端点 | 用途 |
|------|------|
| GET /health | 健康检查 |
| GET /targets | 列出所有 Tab |
| GET /new?url= | 创建后台 Tab |
| GET /close?target= | 关闭 Tab |
| GET /navigate?target=&url= | 导航 |
| POST /eval?target= | 执行 JS |
| GET /page-text?target= | 获取页面文本 |
| POST /setFiles?target= | 文件上传 |
| POST /click?target= | 点击元素 |
| POST /clickAt?target= | 真实鼠标点击 |
| GET /scroll?target=&y=&direction= | 滚动页面 |
| GET /screenshot?target=&file= | 截图 |

---

## 4. 核心流程

### 4.1 环境检查

每次任务开始时执行：

1. 运行 `node "${SKILL_DIR}/scripts/check-deps.mjs"` 检查依赖
2. 确认 CDP Proxy 连接：`curl -s http://localhost:3457/health`
3. 如果 `connected` 不为 `true`，等待重试或提示用户

环境就绪后，进入产品确认环节。

### 4.2 产品确认

外链建设必须关联一个产品。流程如下：

**步骤 1：读取产品列表**

使用 Read 工具读取 `${SKILL_DIR}/data/products.json`。

**步骤 2：处理空列表**

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

**步骤 3：多产品选择**

如果产品列表中有多个产品，展示列表让用户选择当前要操作的产品。记录选中的产品 ID 为本次任务的「活跃产品」。

**步骤 4：确认活跃产品**

在后续所有操作中，始终使用确认的活跃产品。如果用户中途切换产品，需重新确认。

### 4.3 外链导入

将外链候选数据导入 `backlinks.json`。支持两种导入方式：

#### 方式 A：Semrush CSV 导入（推荐）

用户提供 Semrush 导出的 CSV 文件路径。

**步骤：**

1. 运行 CSV 导入脚本：

```bash
node "${SKILL_DIR}/scripts/import-csv.mjs" <csv-file-path> "${SKILL_DIR}/data/backlinks.json"
```

2. 脚本输出 JSON，包含 `imported`（新增数量）、`skipped`（重复跳过数量）、`records`（新记录数组）
3. 读取脚本输出的 JSON
4. 读取现有 `${SKILL_DIR}/data/backlinks.json`
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

#### 方式 B：手动 URL 列表

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

### 4.4 批量分析可发布性

对 `backlinks.json` 中所有 `status: "pending"` 的记录逐个分析。

#### 单条分析流程

对每条待分析记录执行以下步骤：

**步骤 1：域名去重检查**

读取 `${SKILL_DIR}/data/sites.json`，如果该记录的 `domain` 已存在于站点库中，直接将 status 更新为 `skipped`，跳过后续步骤。

**步骤 2：打开页面**

```bash
curl -s "http://localhost:3457/new?url=<sourceUrl>"
# 返回 {"targetId":"xxx"}，记录此 ID
```

**步骤 3：确认页面加载**

```bash
curl -s "http://localhost:3457/info?target=<targetId>"
# 确认 ready 为 "complete"
```

如果 ready 不是 `complete`，等待最多 30 秒。超时则标记该条为 `error` 并跳过。

**步骤 4：结构化检测**

分别执行评论表单检测和反垃圾系统检测：

```bash
# 评论表单检测
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${SKILL_DIR}/scripts/detect-comment-form.js")"

# 反垃圾系统检测
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${SKILL_DIR}/scripts/detect-antispam.js")"
```

**步骤 5：快速判定**

基于步骤 4 的结构化检测结果，尝试快速判定：

- **直接判定为 `not_publishable`**：
  - 存在 `bypassable: false` 的反垃圾系统（CleanTalk、hCaptcha、Jetpack）
  - 存在 `bypassable: 'depends_on_config'` 的反垃圾系统（保守策略）
  - `commentSystem` 为 `none` 且 `hasTextarea` 为 `false` 且 `hasCommentForm` 为 `false`

- **直接判定为 `publishable`**：
  - `commentSystem` 为 `native` 且 `hasTextarea` 为 `true` 且 `hasUnbypassable` 为 `false`

如果快速判定结果明确，跳过步骤 6，直接进入步骤 7。

**步骤 6：Claude 综合判定（仅对快速判定无法明确的情况）**

当评论系统为 Disqus/Facebook/Commento 等第三方系统，或评论信号模糊时，需要 Claude 做语义分析：

1. 执行页面内容提取脚本：

```bash
node "${SKILL_DIR}/scripts/page-extractor.mjs" <targetId>
```

2. 将提取结果（title、textContent、commentSignals）与步骤 4 的检测结果一起交给 Claude 分析
3. Claude 根据 `publishability-rules.md` 中的规则，综合判断可发布性
4. 输出判定结果：`{ status, category, reason }`

**需要 Claude 判定的典型场景：**
- 评论系统为 `disqus` / `facebook` / `commento`（第三方系统，需判断是否可操作）
- 存在 `bypassable: 'depends_on_config'` 的反垃圾（需具体分析）
- `commentSystem` 为 `none` 但 `hasTextarea` 为 `true`（textarea 用途不明确）

**步骤 7：写回数据**

将分析结果写入该条记录的 `analysis` 字段（格式见 `references/publishability-rules.md` 7.3 节），更新 `status`。使用 Write 工具写回 `backlinks.json`。

如果判定为 `publishable`，同时创建站点记录写入 `sites.json`。

**步骤 8：关闭 tab**

```bash
curl -s "http://localhost:3457/close?target=<targetId>"
```

#### 批量处理规则

- **逐条分析**：每次只打开一个 tab，分析完立即关闭再打开下一个
- **即时写回**：每条分析完成后立即更新 `backlinks.json`，防止中途丢失
- **进度报告**：每分析完 10 条，向用户报告进度（已完成/总数）
- **超时处理**：单条分析超过 30 秒标记为 `error` 并跳过，继续下一条
- **可恢复**：如果中途中断，下次启动时只会处理 `status: "pending"` 的记录

### 4.5 报告输出

批量分析完成后，生成并展示分析报告。

#### 4.5.1 总览

```
外链分析报告
============
总数：N
可发布：A（X%）
不可发布：B（Y%）
已跳过：C（Z%）
分析出错：D
```

#### 4.5.2 可发布站点列表

按 `pageAscore` 降序排列，展示：

| 排名 | 域名 | URL | 分类 | 评论系统 | 反垃圾系统 | AScore |
|------|------|-----|------|---------|-----------|--------|
| 1 | example.com | https://example.com/... | blog_comment | native | 无 | 85 |

#### 4.5.3 反垃圾系统分布

```
反垃圾系统分布：
- 无反垃圾：45（60%）
- Akismet：15（20%）
- Anti-spam Bee：10（13%）
- hCaptcha：3（4%）
- CleanTalk：2（3%）
```

#### 4.5.4 不可发布原因分布

```
不可发布原因：
- 无评论表单信号：25（62%）
- 不可绕过的反垃圾系统：10（25%）
- 页面无法访问：5（13%）
```

#### 4.5.5 后续建议

根据分析结果给出可操作的建议：
- 将 `publishable` 的站点自动迁移到 `sites.json`（需用户确认）
- 按反垃圾系统类型分组，推荐处理优先级
- 标注可直接操作的站点（无反垃圾 + 原生评论表单）

### 4.6 表单提交

对已确认可发布的站点执行实际的表单填写和提交。

#### 目录提交流程

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

#### 博客评论流程

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

**form-filler.js 调用方式：**

由于 form-filler.js 需要接收参数，使用两步注入：

```bash
# 步骤 1: 设置填写数据
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "window.__FILL_DATA__ = { fields: { 'field_0': 'value1', 'field_1': 'value2' } }"

# 步骤 2: 执行填写脚本
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${SKILL_DIR}/scripts/form-filler.js")"
```

### 4.7 提交记录管理

查看和统计提交历史。

- 所有提交记录存储在 `data/submissions.json`
- 按状态筛选：`submitted` / `failed` / `skipped`
- 按产品筛选：`productId`
- 统计总提交数、成功率、失败原因分布

### 4.8 Google Sheets 同步

将本地 JSON 数据与 Google Sheet 双向同步。

**前置条件：**
1. 配置 `data/sync-config.json` 中的服务账号密钥和 Sheet URL
2. 将 Sheet 分享给服务账号的邮箱地址

**上传（本地 → Sheet）：**

```bash
node "${SKILL_DIR}/scripts/sheets-sync.mjs" upload \
  --config "${SKILL_DIR}/data/sync-config.json" \
  --data "${SKILL_DIR}/data"
```

上传前自动备份现有 Sheet 数据，失败时自动回滚。

**下载（Sheet → 本地）：**

```bash
node "${SKILL_DIR}/scripts/sheets-sync.mjs" download \
  --config "${SKILL_DIR}/data/sync-config.json" \
  --data "${SKILL_DIR}/data"
```

**同步的 4 个 Tab：** products / submissions / sites / backlinks

### 4.9 产品资料生成

输入产品官网 URL，自动提取页面信息，由 Claude 生成完整产品资料。

```bash
node "${SKILL_DIR}/scripts/product-generator.mjs" <product-url>
```

脚本输出 JSON 包含 title、metaDescription、ogTitle、ogDescription、headings、bodyText。

Claude 基于提取结果生成产品记录（name、tagline、shortDesc、longDesc、categories、anchorTexts），写入 `products.json`。

---

## 5. 评论表单检测脚本

脚本路径：`${SKILL_DIR}/scripts/detect-comment-form.js`

通过 CDP Proxy 的 `/eval` 端点在目标页面执行，检测页面是否包含评论表单及相关信号。
返回 JSON 格式的检测结果，包含 hasTextarea、hasUrlField、hasAuthorField、hasEmailField、hasCommentForm、isWordPress、commentSystem 等字段。

使用方式：
```bash
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${SKILL_DIR}/scripts/detect-comment-form.js")"
```

---

## 6. 反垃圾系统检测脚本

脚本路径：`${SKILL_DIR}/scripts/detect-antispam.js`

通过 CDP Proxy 的 `/eval` 端点在目标页面执行，检测页面使用的反垃圾（anti-spam）系统。
返回 JSON 格式的检测结果，包含 detected 数组（每项有 name、bypassable、evidence）、hasBypassable、hasUnbypassable、count。

使用方式：
```bash
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${SKILL_DIR}/scripts/detect-antispam.js")"
```

---

## 6.1 页面内容提取脚本

脚本路径：`${SKILL_DIR}/scripts/page-extractor.mjs`

通过 CDP Proxy 在目标页面提取 HTML，转换为纯文本并检测评论信号。用于 Claude 综合判定时的语义分析输入。

**使用方式：**
```bash
node "${SKILL_DIR}/scripts/page-extractor.mjs" <targetId>
```

**输出格式：**
```json
{
  "title": "页面标题",
  "textContent": "页面纯文本内容（截断到 8000 字符）",
  "commentSignals": {
    "found": true,
    "details": "textarea with comment context; URL/Website input field"
  },
  "url": "https://example.com/page"
}
```

**功能说明：**
- 通过 CDP Proxy `/eval` 端点获取 `document.documentElement.outerHTML`
- 去除 script/style/nav/footer 标签，提取纯文本
- 解码 HTML 实体（`&nbsp;`、`&amp;` 等）
- 文本截断到 8000 字符，超出部分标记 `[truncated]`
- 检测评论信号：textarea 上下文、comment form id/class、URL/Website input、comments section

---

## 6.2 CSV 导入脚本

脚本路径：`${SKILL_DIR}/scripts/import-csv.mjs`

解析 Semrush 导出的 CSV 文件，按 sourceUrl 去重，输出标准格式的 JSON 记录。

**使用方式：**
```bash
node "${SKILL_DIR}/scripts/import-csv.mjs" <csv-file-path> [backlinks-json-path]
```

- `csv-file-path`：Semrush 导出的 CSV 文件路径（必填）
- `backlinks-json-path`：现有 `backlinks.json` 路径，用于去重（选填）

**输出格式：**
```json
{
  "imported": 50,
  "skipped": 12,
  "records": [...]
}
```

**字段映射：**
| Semrush 字段 | 系统字段 |
|-------------|---------|
| Source url | sourceUrl |
| Source title | sourceTitle |
| Page ascore | pageAscore |

---

## 6.3 表单分析脚本

脚本路径：`${SKILL_DIR}/scripts/form-analyzer.js`

通过 CDP `/eval` 在目标页面执行，扫描所有表单元素，返回结构化字段描述。

使用方式：
```bash
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${SKILL_DIR}/scripts/form-analyzer.js")"
```

返回值包含三个部分：
- **fields** — 表单字段数组，每项含 canonical_id、name、id、type、label、placeholder、required、maxlength、inferred_purpose、effective_type、selector、tagName、form_index
- **forms** — 表单分组数组，每项含 form_index、role（search/login/newsletter/unknown）、confidence、filtered
- **page_info** — 页面信息（title、description、headings、content_preview）

## 6.4 蜜罐检测脚本

脚本路径：`${SKILL_DIR}/scripts/honeypot-detector.js`

检测页面中可疑的蜜罐表单字段，使用 7 维评分系统（aria-hidden、名称模式、空标签、负 tabindex、autocomplete off、隐藏父元素、零字体大小、零最大尺寸）。

返回值：`{ total, suspicious, honeypots, all }`

## 6.5 表单填写脚本

脚本路径：`${SKILL_DIR}/scripts/form-filler.js`

接收字段映射数据，逐字段填写表单。兼容 React/Vue 受控组件（原生 setter + `_valueTracker` 重置 + `execCommand` 回退）。

使用方式（两步注入）：
```bash
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "window.__FILL_DATA__ = { fields: { 'field_0': 'value' } }"
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${SKILL_DIR}/scripts/form-filler.js")"
```

返回值：`{ success, total, results: [{ canonical_id, status, filled, verified }] }`

## 6.6 评论展开脚本

脚本路径：`${SKILL_DIR}/scripts/comment-expander.js`

检测并展开懒加载的评论表单区域（支持 wpDiscuz、WordPress 默认评论等）。CDP 页面上下文直接访问 jQuery。

返回值：`{ found, triggerSelector, clicked, unhid, hint }`

## 6.7 Google Sheets 同步脚本

脚本路径：`${SKILL_DIR}/scripts/sheets-sync.mjs`

Google Sheets 双向同步。支持 4 个 Tab 的分块上传/下载，自动备份回滚。

使用方式见 4.8 节。

## 6.8 产品信息提取脚本

脚本路径：`${SKILL_DIR}/scripts/product-generator.mjs`

通过 CDP Proxy 打开产品页面，提取 meta 信息和正文内容。

使用方式见 4.9 节。

---

## 7. 可发布性判定规则

完整的判定优先级表、站点分类规则和 analysis 字段格式：
`${SKILL_DIR}/references/publishability-rules.md`

判定前必须先读取上述文件了解规则细节。

---

## 8. 铁律

以下是外链建设过程中必须遵守的 10 条铁律，任何情况不得违反：

### 铁律 1：禁止设限

唯一合法的跳过理由：
- **真付费墙**：页面内容需要付费才能访问
- **站已死**：域名过期、页面 404、服务器无响应
- **CF 硬封**：Cloudflare 验证页面，无法通过自动化绕过

除此之外，任何"看起来难"、"内容太长"、"界面复杂"都不是跳过理由。

### 铁律 2：前端不行先逆向

当正常表单提交失败时：
1. 先查看页面源码，寻找隐藏的 API 端点
2. 检查网络请求，分析提交逻辑
3. 如果前端验证拦截，尝试直接调用后端 API

### 铁律 3：候选筛选查 spam + traffic

筛选外链候选时，优先查看：
- **Spam score**（垃圾评分）：低于 30% 才考虑
- **Organic traffic**（自然流量）：有一定流量说明是活跃站点
- **DR（Domain Rating）是假指标**：高 DR 不代表高质量，忽略 DR

### 铁律 4：去重按域名不按模板 ID

同一域名下的不同页面视为同一个站点。去重以域名为单位，不要因为模板不同就认为是新站点。

### 铁律 5：查邮件必须开新标签页

查找联系邮箱时：
- **必须**使用 `/new` 创建新 tab
- 在新 tab 中搜索
- 查找完毕后用 `/close` 关闭
- **禁止**在分析页面中跳转查找邮箱

### 铁律 6：rel 属性每次实测

外链的 `rel` 属性（dofollow/nofollow/ugc/sponsored）必须实际发布后检查，不要依赖页面声明或他人报告。

### 铁律 7：先读知识库再操作

执行任何操作前，先读取相关数据文件（products.json、backlinks.json、sites.json），了解当前状态，避免重复操作或遗漏。

### 铁律 8：切站必须确认产品

切换到不同的目标站点时，必须确认当前操作的活跃产品。如果用户未明确指定，主动询问。

### 铁律 9：catch-all 邮箱失败立刻切 Gmail

如果使用自定义域名邮箱注册/提交失败（catch-all 或被拒），立即切换到 Gmail 邮箱重试。不要在同一邮箱上反复尝试。

### 铁律 10：验证码协作先填完所有字段

遇到需要验证码的表单时：
1. 先自动填写所有其他字段
2. 最后再处理验证码（暂停等待用户手动输入或使用验证码服务）
3. 不要中途停下来让用户填其他字段

---

## 9. 错误处理

| 场景 | 处理方式 |
|------|---------|
| CDP Proxy 未启动 | 运行 `node "${SKILL_DIR}/scripts/check-deps.mjs"`，脚本会自动启动 Proxy |
| Chrome 未开启远程调试 | 提示用户打开 `chrome://inspect/#remote-debugging` 并启用远程调试 |
| Chrome 有授权弹窗 | 提示用户点击「允许」，等待连接 |
| 页面加载超时（>30s） | 标记该条记录 status 为 `error`，跳过继续下一条 |
| CDP 连接断开 | 自动重连（Proxy 内置重连逻辑），如持续失败则暂停任务并提示 |
| JSON 文件损坏（解析失败） | 提示用户数据文件损坏，建议从备份恢复；不要自行覆盖 |
| 批量分析中途失败 | 已分析的记录已即时写回，未分析的保持 `pending`，下次可继续 |
| `/eval` 返回 JS 错误 | 检查脚本是否被 CSP 阻止，尝试降级检测逻辑；标记 `error` 继续 |
| 截图保存失败 | 检查文件路径是否有写入权限，使用 `/tmp/` 作为回退路径 |
| 磁盘空间不足 | 提示用户清理空间，暂停文件写入操作 |

---

## 10. 任务结束

每次任务完成后，执行以下清理操作：

### 10.1 关闭后台 Tab

关闭本次任务中创建的所有后台 tab。通过记录的 `targetId` 列表逐一关闭：

```bash
curl -s "http://localhost:3457/close?target=<targetId>"
```

### 10.2 不干扰用户

- **不要关闭用户原有的 tab**（任务开始前的 tab 保持不变）
- 只关闭通过 `/new` 创建的 tab
- 如果不确定哪些 tab 是本次创建的，可通过对比任务前后的 `/targets` 结果来判断

### 10.3 CDP Proxy 保持运行

- CDP Proxy 进程保持运行，不主动关闭
- 用户可随时通过 `curl http://localhost:3457/health` 确认 Proxy 状态
- 下次任务启动时会自动复用已有 Proxy 实例

### 10.4 数据一致性确认

任务结束前，确认以下文件已正确写入：
- `${SKILL_DIR}/data/backlinks.json` — 分析结果已更新
- `${SKILL_DIR}/data/sites.json` — 如有新站点入库，已写入
