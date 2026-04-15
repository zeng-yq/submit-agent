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
node "${CLAUDE_SKILL_DIR}/scripts/check-deps.mjs"
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
> 数据文件位于 `${CLAUDE_SKILL_DIR}/data/` 目录。

---

## 2. 数据文件

所有数据以 JSON 格式存储在 `${CLAUDE_SKILL_DIR}/data/` 目录下。

操作数据前必须先读取格式规范了解各字段的含义和结构：
`${CLAUDE_SKILL_DIR}/references/data-formats.md`

---

## 3. CDP Proxy API

CDP Proxy 运行在 `http://localhost:3457`，提供 HTTP 端点操控浏览器。
完整 API 文档（15 个端点的 curl 示例和返回值说明）：
`${CLAUDE_SKILL_DIR}/references/cdp-proxy-api.md`

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

1. 运行 `node "${CLAUDE_SKILL_DIR}/scripts/check-deps.mjs"` 检查依赖
2. 确认 CDP Proxy 连接：`curl -s http://localhost:3457/health`
3. 如果 `connected` 不为 `true`，等待重试或提示用户

环境就绪后，进入产品确认环节。

### 4.2 产品确认

外链建设必须关联一个产品。流程如下：

**步骤 1：读取产品列表**

使用 Read 工具读取 `${CLAUDE_SKILL_DIR}/data/products.json`。

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

#### 方式 A：Semrush CSV 导入

用户提供 Semrush 导出的 CSV 文件路径或直接粘贴 CSV 内容。

**字段映射规则：**

| Semrush 字段 | 系统字段 | 说明 |
|-------------|---------|------|
| Source url | sourceUrl | 来源页面 URL |
| Source title | sourceTitle | 来源页面标题 |
| Page ascore | pageAscore | 页面权威度评分（数字） |

**处理步骤：**

1. 解析 CSV（使用逗号分隔，处理引号包裹的字段）
2. 逐行提取 sourceUrl、sourceTitle、pageAscore
3. 对每条记录生成唯一 ID：`bl-` + 当前时间戳（毫秒）+ `-` + 4位随机十六进制字符串
4. 提取域名：`new URL(sourceUrl).hostname`
5. 设置 status 为 `pending`
6. 设置 analysis 为 `null`
7. 写入 `backlinks.json`

#### 方式 B：手动 URL 列表

用户提供一个或多个 URL，每行一个。

**处理步骤：**

1. 逐行解析 URL
2. sourceUrl = 原始 URL
3. sourceTitle = 空（后续分析时自动获取）
4. pageAscore = 0（无评分数据）
5. 其余字段同方式 A

#### 去重规则

- **按 sourceUrl 去重**：如果 `backlinks.json` 中已存在相同 sourceUrl 的记录，跳过该条
- 导入完成后报告：新增 N 条，跳过 M 条（重复）

#### 写入时机

- 全部处理完毕后一次性写入 `backlinks.json`
- 写入前先读取现有数据，合并后写回

### 4.4 批量分析可发布性

对 `backlinks.json` 中所有 `status: "pending"` 的记录逐个分析。

#### 单条分析流程

对每条待分析记录执行以下步骤：

**步骤 1：打开页面**

```bash
# 创建新后台 tab 并加载页面
curl -s "http://localhost:3457/new?url=<sourceUrl>"
# 返回 {"targetId":"xxx"}，记录此 ID
```

**步骤 2：确认页面加载**

```bash
# 检查页面信息
curl -s "http://localhost:3457/info?target=<targetId>"
# 确认 readyState 为 "complete"
```

如果 readyState 不是 `complete`，等待最多 30 秒。超时则标记该条为 `error` 并跳过。

**步骤 3：执行评论表单检测**

```bash
# 使用评论表单检测脚本
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${CLAUDE_SKILL_DIR}/scripts/detect-comment-form.js")"
```

**步骤 4：执行反垃圾系统检测**

```bash
# 使用反垃圾系统检测脚本
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${CLAUDE_SKILL_DIR}/scripts/detect-antispam.js")"
```

**步骤 5：综合判定**

根据第 7 节的判定规则，结合评论表单检测结果和反垃圾系统检测结果，判定可发布性。

**步骤 6：写回数据**

将分析结果写入该条记录的 `analysis` 字段，更新 `status`。使用 Write 工具写回 `backlinks.json`。

**步骤 7：关闭 tab**

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

---

## 5. 评论表单检测脚本

脚本路径：`${CLAUDE_SKILL_DIR}/scripts/detect-comment-form.js`

通过 CDP Proxy 的 `/eval` 端点在目标页面执行，检测页面是否包含评论表单及相关信号。
返回 JSON 格式的检测结果，包含 hasTextarea、hasUrlField、hasAuthorField、hasEmailField、hasCommentForm、isWordPress、commentSystem 等字段。

使用方式：
```bash
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${CLAUDE_SKILL_DIR}/scripts/detect-comment-form.js")"
```

---

## 6. 反垃圾系统检测脚本

脚本路径：`${CLAUDE_SKILL_DIR}/scripts/detect-antispam.js`

通过 CDP Proxy 的 `/eval` 端点在目标页面执行，检测页面使用的反垃圾（anti-spam）系统。
返回 JSON 格式的检测结果，包含 detected 数组（每项有 name、bypassable、evidence）、hasBypassable、hasUnbypassable、count。

使用方式：
```bash
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${CLAUDE_SKILL_DIR}/scripts/detect-antispam.js")"
```

---

## 7. 可发布性判定规则

完整的判定优先级表、站点分类规则和 analysis 字段格式：
`${CLAUDE_SKILL_DIR}/references/publishability-rules.md`

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
| CDP Proxy 未启动 | 运行 `node "${CLAUDE_SKILL_DIR}/scripts/check-deps.mjs"`，脚本会自动启动 Proxy |
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
- `${CLAUDE_SKILL_DIR}/data/backlinks.json` — 分析结果已更新
- `${CLAUDE_SKILL_DIR}/data/sites.json` — 如有新站点入库，已写入
