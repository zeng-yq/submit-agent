# Backlink Agent Skill 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 submit-agent 插件的外链分析与入库功能改写为 Claude Code Skill，通过 CDP Proxy 操控浏览器完成外链候选导入、可发布性分析和站点入库。

**Architecture:** 单文件 SKILL.md 作为 Claude Code 的指令入口，Fork web-access 的 cdp-proxy.mjs 作为浏览器操控层（端口 3457），数据存储在本地 JSON 文件中。Claude Code 通过 curl 调用 cdp-proxy 的 HTTP API 来打开页面、执行 JS 检测脚本、截图，自身完成综合判断。

**Tech Stack:** Node.js 22+（CDP Proxy）、Chrome DevTools Protocol、Claude Code Skill（SKILL.md + Bash curl）

---

## 文件清单

| 文件 | 职责 | 操作 |
|------|------|------|
| `~/.claude/skills/backlink-agent/SKILL.md` | 核心指令：流程、知识库、约束 | 创建 |
| `~/.claude/skills/backlink-agent/scripts/cdp-proxy.mjs` | CDP 浏览器操控代理（HTTP API） | 从 web-access fork 并修改 |
| `~/.claude/skills/backlink-agent/scripts/check-deps.mjs` | 环境检查脚本 | 从 web-access fork 并修改 |
| `~/.claude/skills/backlink-agent/data/products.json` | 产品资料 | 创建（空数组） |
| `~/.claude/skills/backlink-agent/data/backlinks.json` | 外链候选 | 创建（空数组） |
| `~/.claude/skills/backlink-agent/data/sites.json` | 站点库 | 创建（空数组） |
| `~/.claude/skills/backlink-agent/data/submissions.json` | 提交记录（预留） | 创建（空数组） |

---

### Task 1: 创建 Skill 目录结构和数据文件

**Files:**
- Create: `~/.claude/skills/backlink-agent/data/products.json`
- Create: `~/.claude/skills/backlink-agent/data/backlinks.json`
- Create: `~/.claude/skills/backlink-agent/data/sites.json`
- Create: `~/.claude/skills/backlink-agent/data/submissions.json`

- [ ] **Step 1: 创建目录结构**

```bash
mkdir -p ~/.claude/skills/backlink-agent/{scripts,data,references}
```

- [ ] **Step 2: 创建空数据文件**

products.json:
```json
[]
```

backlinks.json:
```json
[]
```

sites.json:
```json
[]
```

submissions.json:
```json
[]
```

- [ ] **Step 3: 验证目录结构**

```bash
find ~/.claude/skills/backlink-agent -type f | sort
```

Expected: 4 个 JSON 文件

- [ ] **Step 4: Commit**

```bash
cd ~/.claude/skills/backlink-agent && git init
git add -A && git commit -m "chore: 初始化 backlink-agent skill 目录结构和空数据文件"
```

---

### Task 2: Fork 并适配 cdp-proxy.mjs

**Files:**
- Create: `~/.claude/skills/backlink-agent/scripts/cdp-proxy.mjs`（基于 `~/.claude/skills/web-access/scripts/cdp-proxy.mjs`）

- [ ] **Step 1: 复制 cdp-proxy.mjs**

```bash
cp ~/.claude/skills/web-access/scripts/cdp-proxy.mjs ~/.claude/skills/backlink-agent/scripts/cdp-proxy.mjs
```

- [ ] **Step 2: 修改默认端口为 3457**

在 cdp-proxy.mjs 第 13 行，将：
```javascript
const PORT = parseInt(process.env.CDP_PROXY_PORT || '3456');
```
改为：
```javascript
const PORT = parseInt(process.env.CDP_PROXY_PORT || '3457');
```

- [ ] **Step 3: 新增 /page-text 端点**

在 `/info` 端点处理块（约第 520 行 `else if (pathname === '/info')` 之后、`else { res.statusCode = 404;` 之前），添加：

```javascript
// GET /page-text?target=xxx - 获取页面纯文本
else if (pathname === '/page-text') {
  const sid = await ensureSession(q.target);
  const resp = await sendCDP('Runtime.evaluate', {
    expression: 'document.body.innerText',
    returnByValue: true,
  }, sid);
  const text = resp.result?.result?.value || '';
  res.end(JSON.stringify({ text, length: text.length }));
}
```

- [ ] **Step 4: 更新 404 端点列表**

在 404 响应的 endpoints 对象中添加 `/page-text` 的说明：

```javascript
'/page-text?target=': 'GET - 获取页面纯文本内容',
```

- [ ] **Step 5: 验证 proxy 启动**

```bash
node ~/.claude/skills/backlink-agent/scripts/cdp-proxy.mjs &
sleep 2
curl -s http://localhost:3457/health
kill %1
```

Expected: `{"status":"ok","connected":false,"sessions":0,"chromePort":null}` 或包含 `"connected":true`

- [ ] **Step 6: Commit**

```bash
git add scripts/cdp-proxy.mjs && git commit -m "feat: fork cdp-proxy 并适配端口 3457 + 新增 /page-text 端点"
```

---

### Task 3: Fork 并适配 check-deps.mjs

**Files:**
- Create: `~/.claude/skills/backlink-agent/scripts/check-deps.mjs`（基于 `~/.claude/skills/web-access/scripts/check-deps.mjs`）

- [ ] **Step 1: 读取 web-access 的 check-deps.mjs**

```bash
cat ~/.claude/skills/web-access/scripts/check-deps.mjs
```

理解其逻辑：检查 Node.js 版本、Chrome 调试端口、启动 cdp-proxy。

- [ ] **Step 2: 复制文件**

```bash
cp ~/.claude/skills/web-access/scripts/check-deps.mjs ~/.claude/skills/backlink-agent/scripts/check-deps.mjs
```

- [ ] **Step 3: 修改默认端口**

第 13 行，将：
```javascript
const PROXY_PORT = Number(process.env.CDP_PROXY_PORT || 3456);
```
改为：
```javascript
const PROXY_PORT = Number(process.env.CDP_PROXY_PORT || 3457);
```

- [ ] **Step 4: 移除 site-patterns 列表逻辑**

删除第 158-167 行的 site-patterns 列表输出代码（backlink-agent 不使用 site-patterns 目录）：

```javascript
// 删除以下代码块：
  // 列出已有站点经验
  const patternsDir = path.join(ROOT, 'references', 'site-patterns');
  try {
    const sites = fs.readdirSync(patternsDir)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace(/\.md$/, ''));
    if (sites.length) {
      console.log(`\nsite-patterns: ${sites.join(', ')}`);
    }
  } catch {}
```

- [ ] **Step 5: 验证脚本运行**

```bash
node ~/.claude/skills/backlink-agent/scripts/check-deps.mjs
```

Expected: 输出环境检查结果（Node.js 版本、Chrome 端口状态）

- [ ] **Step 6: Commit**

```bash
git add scripts/check-deps.mjs && git commit -m "feat: 添加环境检查脚本（适配端口 3457）"
```

---

### Task 4: 编写 SKILL.md — 前置条件、数据文件、CDP Proxy API

**Files:**
- Create: `~/.claude/skills/backlink-agent/SKILL.md`

- [ ] **Step 1: 创建 SKILL.md 骨架和前置条件**

```markdown
---
name: backlink-agent
description: 外链分析与入库 Agent。通过 CDP 操控浏览器，完成外链候选导入、可发布性判断和站点入库。触发场景：用户要求分析外链、导入 Semrush 数据、批量检查页面可发布性、管理外链候选站点。
metadata:
  version: "1.0.0"
---

# Backlink Agent

## 前置条件

在开始操作前，先检查环境：

\```bash
node "${CLAUDE_SKILL_DIR}/scripts/check-deps.mjs"
\```

未通过时引导用户完成设置：
- **Node.js 22+**：必需（CDP Proxy 使用原生 WebSocket）
- **Chrome remote-debugging**：在 Chrome 地址栏打开 `chrome://inspect/#remote-debugging`，勾选 "Allow remote debugging for this browser instance"，可能需要重启浏览器

检查通过后，在回复中向用户展示以下须知：

\```
温馨提示：本 Skill 会通过 CDP 操控你的 Chrome 浏览器访问外链候选页面。
请在操作前确保你的 Chrome 已登录必要的账号（如 Gmail）。
所有操作在后台 tab 中进行，不会影响你正在使用的页面。
\```

## 数据文件

所有数据存储在 JSON 文件中，使用 Read/Write 工具直接读写：

| 文件 | 路径 | 用途 |
|------|------|------|
| products.json | `{skill_dir}/data/products.json` | 产品资料列表 |
| backlinks.json | `{skill_dir}/data/backlinks.json` | 外链候选（待分析/已分析） |
| sites.json | `{skill_dir}/data/sites.json` | 站点库（已确认可发布） |
| submissions.json | `{skill_dir}/data/submissions.json` | 提交记录（预留，v2 使用） |

`{skill_dir}` = `${CLAUDE_SKILL_DIR}`

## CDP Proxy API

CDP Proxy 运行在 `http://localhost:3457`，所有操作通过 curl 调用：

\```bash
# 健康检查
curl -s http://localhost:3457/health

# 列出所有 tab
curl -s http://localhost:3457/targets

# 创建新后台 tab
curl -s "http://localhost:3457/new?url=https://example.com"

# 导航（自动等待加载）
curl -s "http://localhost:3457/navigate?target=ID&url=URL"

# 获取页面信息（title、url、readyState）
curl -s "http://localhost:3457/info?target=ID"

# 执行 JavaScript（POST body 为 JS 表达式）
curl -s -X POST "http://localhost:3457/eval?target=ID" -d 'document.title'

# 获取页面纯文本（快速分析页面语义，不需要截图时使用）
curl -s "http://localhost:3457/page-text?target=ID"

# 截图
curl -s "http://localhost:3457/screenshot?target=ID&file=/tmp/backlink-shot.png"

# 点击元素（POST body 为 CSS 选择器）
curl -s -X POST "http://localhost:3457/click?target=ID" -d 'button.submit'

# 真实鼠标点击（CDP 级别，能触发文件对话框）
curl -s -X POST "http://localhost:3457/clickAt?target=ID" -d 'button.upload'

# 滚动页面
curl -s "http://localhost:3457/scroll?target=ID&y=3000"

# 关闭 tab
curl -s "http://localhost:3457/close?target=ID"
\```
```

- [ ] **Step 2: 验证 SKILL.md 格式**

确认 YAML frontmatter 格式正确，Markdown 渲染无误。

- [ ] **Step 3: Commit**

```bash
git add SKILL.md && git commit -m "docs: 添加 SKILL.md 前置条件、数据文件和 CDP Proxy API 参考"
```

---

### Task 5: 编写 SKILL.md — 核心流程（环境检查 + 产品确认 + 外链导入）

**Files:**
- Modify: `~/.claude/skills/backlink-agent/SKILL.md`

- [ ] **Step 1: 在 SKILL.md 中添加核心流程章节**

在 CDP Proxy API 章节之后追加：

```markdown
## 核心流程

### 1. 环境检查

每次执行任务前必须完成：

1. 运行 `check-deps.mjs` 确认环境就绪
2. 执行 `curl -s http://localhost:3457/health` 确认 proxy 已连接
3. 如果 proxy 未启动或未连接，提示用户排查

### 2. 产品确认

1. 用 Read 工具读取 `data/products.json`
2. 如果文件为空（`[]`）或用户未指定产品，提示用户创建产品资料：

\```
当前没有产品资料。请提供以下信息创建一个新产品：
- 产品名称
- 产品 URL
- 一句话描述（tagline）
- 简短描述（50-100 字符）
- 详细描述
- 分类（如 SaaS、Developer Tools）
- 锚文本列表（用于外链）
- Logo URL（可选）
- 社交链接（可选）
- 创始人姓名和邮箱（可选）
\```

3. 用户提供的资料用 Write 工具写入 `data/products.json`
4. 如果有多个产品，用 AskUserQuestion 让用户选择当前活跃产品
5. 记录活跃产品信息，后续流程中所有操作都基于该产品

### 3. 外链导入

支持两种导入方式：

**方式 A：Semrush CSV 导入**

1. 用户提供 Semrush 导出的 CSV 文件路径
2. 用 Read 工具读取 CSV 文件
3. 解析 CSV，字段映射：
   - `Source url` → `sourceUrl`
   - `Source title` → `sourceTitle`
   - `Page ascore` → `pageAscore`（数值）
4. 从 `sourceUrl` 提取 `domain`（用 `new URL(sourceUrl).hostname`）
5. 为每条记录生成唯一 `id`（`bl-` + 时间戳 + 随机数）
6. 读取 `data/backlinks.json`，按 `sourceUrl` 去重，跳过已存在的记录
7. 新记录 status 设为 `pending`，`addedAt` 设为当前时间戳
8. 用 Write 工具写回 `data/backlinks.json`
9. 向用户报告导入数量和去重数量

**方式 B：手动 URL 列表**

1. 用户提供 URL 列表（粘贴或文件路径）
2. 逐个解析为 backlink 记录：
   - `sourceUrl`: 原始 URL
   - `sourceTitle`: 空字符串（稍后访问时获取）
   - `domain`: 从 URL 提取
   - `pageAscore`: null
   - `status`: `pending`
3. 去重逻辑同方式 A
4. 写回 `data/backlinks.json`
5. 向用户报告导入数量
```

- [ ] **Step 2: 验证流程描述完整性**

确认两种导入方式的字段映射、去重逻辑、状态设置都明确。

- [ ] **Step 3: Commit**

```bash
git add SKILL.md && git commit -m "docs: 添加核心流程 — 环境检查、产品确认、外链导入"
```

---

### Task 6: 编写 SKILL.md — 批量分析流程

**Files:**
- Modify: `~/.claude/skills/backlink-agent/SKILL.md`

- [ ] **Step 1: 在 SKILL.md 中添加批量分析章节**

在外链导入章节之后追加：

```markdown
### 4. 批量分析可发布性

从 `data/backlinks.json` 中取 `status: "pending"` 的记录，逐个分析。

**分析流程（对每个 pending 记录）：**

1. **打开页面**：用 `/new` 创建后台 tab，URL 为 `sourceUrl`

\```bash
RESPONSE=$(curl -s "http://localhost:3457/new?url=${SOURCE_URL}")
TARGET_ID=$(echo $RESPONSE | grep -o '"targetId":"[^"]*"' | cut -d'"' -f4)
\```

2. **等待加载**：用 `/info` 检查 `readyState` 是否为 `complete`

\```bash
curl -s "http://localhost:3457/info?target=${TARGET_ID}"
\```

如果超时（>30s）或返回错误，标记该记录为 `error`，关闭 tab，跳到下一个。

3. **检测评论表单信号**：用 `/eval` 执行检测脚本

\```bash
curl -s -X POST "http://localhost:3457/eval?target=${TARGET_ID}" -d '检测脚本见下方'
\```

4. **检测反垃圾系统**：用 `/eval` 执行反垃圾检测脚本

\```bash
curl -s -X POST "http://localhost:3457/eval?target=${TARGET_ID}" -d '反垃圾检测脚本见下方'
\```

5. **综合判断**：根据检测结果判定可发布性（见判定规则）

6. **写回数据**：
   - `publishable`：更新 backlinks.json 中该记录的 status，同时追加到 sites.json
   - `not_publishable`：更新 status，在 analysisNotes 中记录原因
   - `skipped`：域名在 sites.json 中已存在
   - `error`：页面无法访问

7. **关闭 tab**：

\```bash
curl -s "http://localhost:3457/close?target=${TARGET_ID}"
\```

8. **向用户报告进度**（每分析 10 条报告一次）

**注意事项：**
- 分析完成后更新 backlinks.json 和 sites.json（用 Read + Write 工具）
- 每分析完一条就立即写回数据，不要攒在内存中（防止中途失败丢失进度）
- 如果某条分析失败（CDP 断连等），标记为 error，继续下一条
- 所有 pending 记录处理完后，进入报告输出阶段
```

- [ ] **Step 2: Commit**

```bash
git add SKILL.md && git commit -m "docs: 添加批量分析可发布性流程"
```

---

### Task 7: 编写 SKILL.md — 检测脚本和判定规则

**Files:**
- Modify: `~/.claude/skills/backlink-agent/SKILL.md`

- [ ] **Step 1: 在 SKILL.md 中添加检测脚本和判定规则**

在批量分析章节之后追加：

```markdown
## 评论表单检测脚本

通过 `/eval` 在目标页面执行以下 JavaScript：

\```javascript
(() => {
  const signals = {
    hasTextarea: false,
    textareaNames: [],
    hasUrlField: false,
    hasAuthorField: false,
    hasEmailField: false,
    hasCommentForm: false,
    formActions: [],
    isWordPress: false,
    commentSystem: null,
  };

  const textareas = document.querySelectorAll('textarea');
  textareas.forEach(t => {
    if (t.name.match(/comment|message|content|text|body/i)) {
      signals.hasTextarea = true;
      signals.textareaNames.push(t.name);
    }
  });

  const urlInputs = document.querySelectorAll('input[type="url"], input[name*="url"], input[name*="website"], input[name*="homepage"]');
  signals.hasUrlField = urlInputs.length > 0;

  const authorInputs = document.querySelectorAll('input[name*="author"], input[name*="name"], input[name*="nick"]');
  signals.hasAuthorField = authorInputs.length > 0;

  const emailInputs = document.querySelectorAll('input[type="email"], input[name*="email"], input[name*="mail"]');
  signals.hasEmailField = emailInputs.length > 0;

  const forms = document.querySelectorAll('form');
  forms.forEach(f => {
    const action = f.getAttribute('action') || '';
    if (action.match(/comment|respond|wp-comments/i)) {
      signals.hasCommentForm = true;
    }
    signals.formActions.push(action);
  });

  signals.isWordPress = !!(
    document.querySelector('meta[name="generator"][content*="WordPress"]') ||
    document.querySelector('link[href*="wp-content"]') ||
    document.body.classList.contains('wordpress')
  );

  if (document.querySelector('#comment-form, .comment-form, #comments, #respond')) {
    signals.commentSystem = 'native';
  }
  if (document.querySelector('[id*="disqus"]')) signals.commentSystem = 'disqus';
  if (document.querySelector('.fb-comments')) signals.commentSystem = 'facebook';
  if (document.querySelector('#commento, .commento')) signals.commentSystem = 'commento';

  return signals;
})()
```

## 反垃圾系统检测脚本

通过 `/eval` 在目标页面执行以下 JavaScript：

\```javascript
(() => {
  const detected = [];
  const html = document.documentElement.outerHTML;

  if (html.match(/akismet/i) || document.querySelector('input[name*="akismet"]')) {
    detected.push({ system: 'akismet', bypassable: true });
  }
  if (html.match(/antispam.?bee/i) || document.querySelector('input[name^="ab_"]')) {
    detected.push({ system: 'antispam_bee', bypassable: true });
  }
  if (html.match(/wpantispam/i)) {
    detected.push({ system: 'wpantispam', bypassable: 'depends_on_config' });
  }
  if (html.match(/ct_checkjs|cleantalk/i)) {
    detected.push({ system: 'cleantalk', bypassable: false });
  }
  if (html.match(/hcaptcha\.com|h-captcha/i)) {
    detected.push({ system: 'hcaptcha', bypassable: false });
  }
  if (html.match(/jetpack.?comment|highlander/i) || document.querySelector('iframe[src*="jetpack"]')) {
    detected.push({ system: 'jetpack', bypassable: false });
  }

  return detected;
})()
```

## 可发布性判定规则

根据检测信号和反垃圾系统结果，按以下规则判定：

| 条件 | 判定 | 说明 |
|------|------|------|
| 有不可绕过的反垃圾系统（cleantalk / hcaptcha / jetpack） | `not_publishable` | analysisNotes 记录具体系统名 |
| 无任何评论表单信号（无 textarea、无 comment form、无 URL 字段） | `not_publishable` | analysisNotes 记录"未检测到评论表单" |
| 有评论表单信号 | `publishable` | antiSpamDetected 记录检测到的系统 |
| 域名在 sites.json 中已存在 | `skipped` | analysisNotes 记录"域名已入库" |
| 页面无法访问 / 超时 | `error` | analysisNotes 记录具体错误 |

**publishable 入库时的站点分类规则：**

| 信号特征 | 分类 |
|----------|------|
| WordPress + 评论表单 | `blog_comment` |
| 有评论表单 + 非论坛 | `blog_comment` |
| 有 profile/homepage 字段 + 注册入口 | `profile` |
| 有 submit/product 入口 | `directory` |
| phpBB / Discuz / 其他论坛特征 | `forum` |
| 无法确定 | `blog_comment`（默认） |
```

- [ ] **Step 2: Commit**

```bash
git add SKILL.md && git commit -m "docs: 添加检测脚本和可发布性判定规则"
```

---

### Task 8: 编写 SKILL.md — 报告输出、铁律和错误处理

**Files:**
- Modify: `~/.claude/skills/backlink-agent/SKILL.md`

- [ ] **Step 1: 在 SKILL.md 中添加报告输出、铁律和错误处理**

在判定规则章节之后追加：

```markdown
### 5. 报告输出

所有 pending 记录分析完成后，输出以下报告：

\```
## 外链分析报告

### 总览
- 总候选数：N
- 可发布：N（X%）
- 不可发布：N（X%）
- 跳过（已入库）：N
- 错误：N

### 可发布站点（按 pageAscore 降序）
| # | 域名 | URL | 分类 | 反垃圾系统 | Page AScore |
|---|------|-----|------|-----------|-------------|
| 1 | example.com | https://... | blog_comment | akismet | 65 |

### 反垃圾系统分布
- akismet: N 个站点（可绕过）
- antispam_bee: N 个站点（可绕过）
- cleantalk: N 个站点（不可绕过）
- hcaptcha: N 个站点（不可绕过）

### 不可发布原因分布
- 未检测到评论表单: N
- 不可绕过的反垃圾系统: N
- 页面无法访问: N
\```

## 铁律

以下规则在所有操作中必须遵守，违反任何一条即视为失败：

1. **禁止设限** — 需要填 20 个字段？全填。需要注册 + 验证？全部完成。唯一合法跳过：真付费墙 / 站已死 / Cloudflare 硬封
2. **前端不行先逆向** — 按钮无反应、Modal 不弹 → 第一反应找后端 API，不是标跳过
3. **候选筛选查 spam + traffic** — DR（Domain Rating）是假指标，真实流量才是真
4. **去重按域名不按模板 ID** — 同一域名可能有多条记录
5. **查邮件必须开新标签页** — 绝不 navigate 离开有表单的页面
6. **rel 属性每次实测** — 提交后 JS 验证 `a.rel`，不信任 DB 标记
7. **先读知识库再操作** — 平台经验优先于猜测（v4 知识库功能上线后生效）
8. **切站必须确认产品** — 操作前确认当前活跃产品信息
9. **catch-all 邮箱失败立刻切 Gmail** — 很多站静默拒绝自定义域名邮箱
10. **验证码协作先填完所有字段** — 只剩验证码才叫用户

## 错误处理

| 场景 | 处理方式 |
|------|---------|
| cdp-proxy 未启动 | 运行 `node "${CLAUDE_SKILL_DIR}/scripts/check-deps.mjs"` 自动启动 |
| Chrome 未开启远程调试 | 提示用户在 `chrome://inspect/#remote-debugging` 开启并重启浏览器 |
| 页面导航超时（>30s） | 标记 error，关闭 tab，跳过继续下一条 |
| CDP WebSocket 断连 | 自动重连一次（proxy 内置），仍失败则暂停并提示用户 |
| JSON 文件损坏 | 提示用户，不自动修复 |
| 批量分析中途失败 | 已分析的记录已写回文件，重新运行时只处理 pending 记录 |

## 任务结束

分析完成后：
- 关闭所有本次创建的后台 tab（用 `/close`）
- 不关闭用户原有的 tab
- CDP Proxy 持续运行，不主动停止
```

- [ ] **Step 2: 验证 SKILL.md 完整性**

通读整个 SKILL.md，确认：
- 前置条件 → 数据文件 → CDP API → 核心流程（5 步）→ 检测脚本 → 判定规则 → 报告 → 铁律 → 错误处理
- 所有章节之间的引用一致（如端口号 3457、文件路径）

- [ ] **Step 3: Commit**

```bash
git add SKILL.md && git commit -m "docs: 添加报告输出、铁律和错误处理，完成 SKILL.md v1"
```

---

### Task 9: 端到端验证

**Files:**
- Read: `~/.claude/skills/backlink-agent/SKILL.md`

- [ ] **Step 1: 启动 CDP Proxy**

```bash
node ~/.claude/skills/backlink-agent/scripts/cdp-proxy.mjs &
```

- [ ] **Step 2: 验证健康检查**

```bash
curl -s http://localhost:3457/health
```

Expected: 包含 `"status":"ok"`

- [ ] **Step 3: 验证 /page-text 端点**

```bash
# 先创建一个 tab
RESPONSE=$(curl -s "http://localhost:3457/new?url=https://example.com")
TARGET_ID=$(echo $RESPONSE | grep -o '"targetId":"[^"]*"' | cut -d'"' -f4)
# 获取页面文本
curl -s "http://localhost:3457/page-text?target=${TARGET_ID}"
# 关闭 tab
curl -s "http://localhost:3457/close?target=${TARGET_ID}"
```

Expected: 返回包含页面文本内容的 JSON

- [ ] **Step 4: 验证数据文件可读写**

确认 Read/Write 工具能正常读写 data/ 下的 JSON 文件。

- [ ] **Step 5: 验证 SKILL.md 可被 Claude Code 识别**

在 Claude Code 中执行 `/backlink-agent` 或让 Claude Code 读取 SKILL.md，确认 skill 被正确加载。

- [ ] **Step 6: 清理后台进程**

```bash
kill %1 2>/dev/null || true
```

- [ ] **Step 7: 最终 Commit**

```bash
git add -A && git commit -m "chore: 端到端验证通过"
```
