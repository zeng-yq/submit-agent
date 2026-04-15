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

### 2.1 文件清单

| 文件 | 路径 | 用途 |
|------|------|------|
| 产品资料 | `${CLAUDE_SKILL_DIR}/data/products.json` | 存储要推广的产品信息（名称、描述、锚文本等） |
| 外链候选 | `${CLAUDE_SKILL_DIR}/data/backlinks.json` | 外链候选站点列表，每条包含来源 URL、分析状态、检测结果 |
| 站点库 | `${CLAUDE_SKILL_DIR}/data/sites.json` | 已确认可发布的站点，作为外链建设的最终目标库 |
| 提交记录 | `${CLAUDE_SKILL_DIR}/data/submissions.json` | 提交历史记录（预留字段，暂未使用） |

### 2.2 数据格式

**products.json** — 产品资料列表：
```json
[
  {
    "id": "prod-001",
    "name": "产品名称",
    "url": "https://example.com",
    "tagline": "一句话简介",
    "shortDesc": "简短描述（100字以内）",
    "longDesc": "详细描述（300字以内）",
    "categories": ["SaaS", "Productivity"],
    "anchorTexts": ["产品名", "产品名 review", "best 产品名 alternative"],
    "logoUrl": "https://example.com/logo.png",
    "socialLinks": { "twitter": "...", "linkedin": "..." },
    "founderName": "创始人姓名",
    "founderEmail": "founder@example.com"
  }
]
```

**backlinks.json** — 外链候选列表：
```json
[
  {
    "id": "bl-1714000000-abc123",
    "sourceUrl": "https://example.com/page",
    "sourceTitle": "页面标题",
    "domain": "example.com",
    "pageAscore": 45,
    "status": "pending",
    "analysis": null,
    "addedAt": "2025-01-01T00:00:00Z"
  }
]
```

状态值：`pending`（待分析） | `publishable`（可发布） | `not_publishable`（不可发布） | `skipped`（已跳过） | `error`（分析出错）

**sites.json** — 站点库：
```json
[
  {
    "id": "site-001",
    "domain": "example.com",
    "url": "https://example.com/guest-post",
    "category": "blog_comment",
    "commentSystem": "native",
    "antispam": [],
    "relAttribute": "dofollow",
    "productId": "prod-001",
    "addedAt": "2025-01-01T00:00:00Z"
  }
]
```

**submissions.json** — 提交记录（预留）：
```json
[]
```

---

## 3. CDP Proxy API

CDP Proxy 运行在 `http://localhost:3457`，提供以下 HTTP 端点操控浏览器。
所有需要操作浏览器的端点都会自动连接 Chrome 并管理 session。

### 3.1 健康检查

**GET /health**

检查 Proxy 是否就绪、是否已连接 Chrome。

```bash
curl -s http://localhost:3457/health
# {"status":"ok","connected":true,"sessions":2,"chromePort":9222}
```

### 3.2 列出所有 Tab

**GET /targets**

列出 Chrome 中所有页面 tab。

```bash
curl -s http://localhost:3457/targets
# [{"targetId":"ABC123","type":"page","title":"Google","url":"https://google.com"}]
```

### 3.3 创建新后台 Tab

**GET /new?url=**

创建新的后台 tab（不切换焦点），自动等待页面加载完成。

```bash
curl -s "http://localhost:3457/new?url=https://example.com"
# {"targetId":"DEF456"}
```

- 参数 `url` 可选，默认 `about:blank`
- 返回的 `targetId` 用于后续所有操作

### 3.4 关闭 Tab

**GET /close?target=**

关闭指定 tab。

```bash
curl -s "http://localhost:3457/close?target=DEF456"
# {"success":true}
```

### 3.5 导航

**GET /navigate?target=&url=**

在指定 tab 中导航到新 URL，自动等待页面加载完成。

```bash
curl -s "http://localhost:3457/navigate?target=DEF456&url=https://example.com/contact"
# {"frameId":"...","loaderId":"..."}
```

### 3.6 后退

**GET /back?target=**

在指定 tab 中执行浏览器后退操作，自动等待加载。

```bash
curl -s "http://localhost:3457/back?target=DEF456"
# {"ok":true}
```

### 3.7 获取页面信息

**GET /info?target=**

获取页面标题、URL 和加载状态。

```bash
curl -s "http://localhost:3457/info?target=DEF456"
# {"title":"Example","url":"https://example.com","ready":"complete"}
```

### 3.8 执行 JavaScript

**POST /eval?target=**

在页面中执行 JavaScript 表达式，body 为要执行的代码。

```bash
curl -s -X POST "http://localhost:3457/eval?target=DEF456" -d 'document.querySelectorAll("a").length'
# {"value":42}
```

- 支持 `awaitPromise: true`，可执行异步表达式
- 返回 `{ value: ... }` 或 `{ error: "..." }`

### 3.9 获取页面纯文本

**GET /page-text?target=**

提取页面 body 的纯文本内容。

```bash
curl -s "http://localhost:3457/page-text?target=DEF456"
# {"text":"页面文本内容...","length":1234}
```

### 3.10 文件上传

**POST /setFiles?target=**

直接给 file input 设置本地文件路径，绕过文件对话框。body 为 JSON。

```bash
curl -s -X POST "http://localhost:3457/setFiles?target=DEF456" \
  -d '{"selector":"input[type=file]","files":["/path/to/image.png"]}'
# {"success":true,"files":1}
```

- 用于需要上传图片或附件的场景（如产品 Logo、截图）
- 直接通过 CDP `DOM.setFileInputFiles` 设置文件，无需用户手动选择

### 3.11 点击元素

**POST /click?target=**

通过 JS 点击页面元素，body 为 CSS 选择器。

```bash
curl -s -X POST "http://localhost:3457/click?target=DEF456" -d '#submit-button'
# {"clicked":true,"tag":"BUTTON","text":"Submit"}
```

### 3.12 真实鼠标点击

**POST /clickAt?target=**

通过 CDP 模拟真实鼠标事件点击元素（可绕过反自动化检测），body 为 CSS 选择器。

```bash
curl -s -X POST "http://localhost:3457/clickAt?target=DEF456" -d 'button.cta'
# {"clicked":true,"x":350,"y":280,"tag":"BUTTON","text":"Get Started"}
```

- 先通过 JS 定位元素坐标，再通过 CDP `Input.dispatchMouseEvent` 发送真实鼠标事件
- 适用于需要用户手势才能触发的场景（如文件对话框）

### 3.13 滚动页面

**GET /scroll?target=&y=&direction=**

滚动页面，支持方向控制。

```bash
# 向下滚动 3000px
curl -s "http://localhost:3457/scroll?target=DEF456&y=3000&direction=down"
# {"value":"scrolled down 3000px"}

# 滚动到页面顶部
curl -s "http://localhost:3457/scroll?target=DEF456&direction=top"
# {"value":"scrolled to top"}

# 滚动到页面底部
curl -s "http://localhost:3457/scroll?target=DEF456&direction=bottom"
# {"value":"scrolled to bottom"}

# 向上滚动
curl -s "http://localhost:3457/scroll?target=DEF456&y=1000&direction=up"
# {"value":"scrolled up 1000px"}
```

- `y`：滚动像素数，默认 3000
- `direction`：`down`（默认）| `up` | `top` | `bottom`
- 滚动后自动等待 800ms（触发懒加载）

### 3.14 截图

**GET /screenshot?target=&file=&format=**

截取页面截图。

```bash
# 保存到文件
curl -s "http://localhost:3457/screenshot?target=DEF456&file=/tmp/screenshot.png"
# {"saved":"/tmp/screenshot.png"}

# 直接返回图片二进制
curl -s -o screenshot.png "http://localhost:3457/screenshot?target=DEF456"
```

- `file`：保存路径，省略则直接返回图片数据
- `format`：`png`（默认）| `jpeg`，jpeg 默认 quality 80

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
# 使用第 5 节的评论表单检测脚本
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" -d '<评论表单检测脚本>'
```

**步骤 4：执行反垃圾系统检测**

```bash
# 使用第 6 节的反垃圾系统检测脚本
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" -d '<反垃圾系统检测脚本>'
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

以下 JavaScript IIFE 通过 CDP Proxy 的 `/eval` 端点在目标页面执行，检测页面是否包含评论表单及相关信号。

```javascript
(() => {
  // --- 基础检测 ---
  const textareas = document.querySelectorAll('textarea');
  const hasTextarea = textareas.length > 0;
  const textareaNames = Array.from(textareas).map(t => (t.name || t.id || t.placeholder || '').toLowerCase());

  // URL 字段检测
  const urlInputs = document.querySelectorAll('input[type="url"], input[name*="url" i], input[name*="website" i], input[name*="link" i]');
  const hasUrlField = urlInputs.length > 0;

  // 作者字段检测
  const authorInputs = document.querySelectorAll('input[name*="author" i], input[name*="name" i], input[name*="user" i], input[name*="nick" i]');
  const hasAuthorField = authorInputs.length > 0;

  // 邮箱字段检测
  const emailInputs = document.querySelectorAll('input[type="email"], input[name*="email" i], input[name*="mail" i]');
  const hasEmailField = emailInputs.length > 0;

  // --- 表单检测 ---
  const forms = document.querySelectorAll('form');
  const formActions = Array.from(forms).map(f => (f.action || f.id || '').toLowerCase());

  // 查找包含 textarea 或 comment 相关的表单
  const commentForms = Array.from(forms).filter(form => {
    const html = form.innerHTML.toLowerCase();
    return html.includes('comment') || form.querySelector('textarea') !== null;
  });
  const hasCommentForm = commentForms.length > 0;

  // --- WordPress 检测 ---
  const wpMeta = document.querySelector('meta[name="generator"][content*="WordPress"]');
  const wpBody = document.body.className.includes('wordpress') || document.body.id === 'wordpress';
  const wpContent = document.querySelector('.wp-comments') || document.querySelector('#comments') || document.querySelector('.comment-respond');
  const isWordPress = !!(wpMeta || wpBody || wpContent);

  // --- 评论系统检测 ---
  let commentSystem = 'none';

  // Disqus
  if (document.querySelector('#disqus_thread') || document.querySelector('.disqus-thread') ||
      document.querySelector('[data-disqus-identifier]') || document.querySelector('script[src*="disqus"]')) {
    commentSystem = 'disqus';
  }
  // Facebook Comments
  else if (document.querySelector('.fb-comments') || document.querySelector('[class*="fb-comments"]') ||
           document.querySelector('script[src*="facebook"]')) {
    commentSystem = 'facebook';
  }
  // Commento
  else if (document.querySelector('#commento') || document.querySelector('.commento') ||
           document.querySelector('script[src*="commento"]')) {
    commentSystem = 'commento';
  }
  // 原生评论
  else if (hasCommentForm || hasTextarea) {
    commentSystem = 'native';
  }

  return {
    hasTextarea,
    textareaNames: textareaNames.slice(0, 10),
    hasUrlField,
    hasAuthorField,
    hasEmailField,
    hasCommentForm,
    formActions: formActions.slice(0, 10),
    isWordPress,
    commentSystem
  };
})()
```

### 使用方式

```bash
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d '(() => { ... })()' \
  | jq .
```

将脚本内容作为 POST body 发送，返回 JSON 格式的检测结果。

---

## 6. 反垃圾系统检测脚本

以下 JavaScript IIFE 检测页面使用的反垃圾（anti-spam）系统。

```javascript
(() => {
  const detected = [];

  // --- Akismet ---
  // WordPress 默认反垃圾，检查加载的脚本和隐藏字段
  const akismetScript = document.querySelector('script[src*="akismet"]');
  const akismetInput = document.querySelector('input[name*="akismet" i]');
  const akismetComment = document.querySelector('#akismet_comment_nonce') ||
                         document.querySelector('input[name="akismet_comment_nonce"]');
  if (akismetScript || akismetInput || akismetComment) {
    detected.push({
      name: 'akismet',
      bypassable: true,
      evidence: akismetScript ? 'script' : (akismetInput ? 'input' : 'nonce_field')
    });
  }

  // --- Anti-spam Bee ---
  // WordPress 插件，生成隐藏的 honeypot 字段
  const asbInput = document.querySelector('input[name*="antispam_bee" i]') ||
                   document.querySelector('.antispam-group') ||
                   document.querySelector('input[data-is-spam]');
  const asbScript = document.querySelector('script[src*="antispam"]') &&
                    !document.querySelector('script[src*="akismet"]');
  if (asbInput || asbScript) {
    detected.push({
      name: 'antispam_bee',
      bypassable: true,
      evidence: asbInput ? 'honeypot_field' : 'script'
    });
  }

  // --- WP Anti-Spam (原 Growmap Anti-Spambot) ---
  // 在评论表单中添加必填的隐藏 checkbox
  const wpasCheckbox = document.querySelector('input[name="mg-gasp-checkbox" i]') ||
                       document.querySelector('input[id*="gasp" i]') ||
                       document.querySelector('.gasp-checkbox');
  const wpasScript = document.querySelector('script[src*="gasp"]') ||
                     Array.from(document.querySelectorAll('script')).some(s => s.textContent.includes('gasp'));
  if (wpasCheckbox) {
    detected.push({
      name: 'wpantispam',
      bypassable: 'depends_on_config',
      evidence: 'checkbox_field',
      note: '需要确认该 checkbox 是否可被 JS 自动勾选'
    });
  }

  // --- CleanTalk ---
  // 云端反垃圾服务，使用 JS 指纹采集
  const cleantalkScript = document.querySelector('script[src*="cleantalk"]') ||
                          document.querySelector('script[src*="ct_bot_detector"]') ||
                          document.querySelector('input[name*="ct_checkjs" i]');
  const cleantalkHidden = document.querySelector('#cleantalk_hidden_field') ||
                          document.querySelector('input[name="ct_checkjs"]');
  if (cleantalkScript || cleantalkHidden) {
    detected.push({
      name: 'cleantalk',
      bypassable: false,
      evidence: cleantalkScript ? 'script' : 'hidden_field',
      note: '依赖浏览器指纹，难以绕过'
    });
  }

  // --- hCaptcha ---
  // 验证码服务
  const hcaptchaFrame = document.querySelector('iframe[src*="hcaptcha"]') ||
                        document.querySelector('.h-captcha') ||
                        document.querySelector('[data-hcaptcha-widget-id]');
  const hcaptchaScript = document.querySelector('script[src*="hcaptcha"]');
  if (hcaptchaFrame || hcaptchaScript) {
    detected.push({
      name: 'hcaptcha',
      bypassable: false,
      evidence: hcaptchaFrame ? 'iframe' : 'script',
      note: '需要人工解决验证码或使用第三方服务'
    });
  }

  // --- Jetpack Protect / Jetpack Comment Form ---
  // Jetpack 的反垃圾模块
  const jetpackComment = document.querySelector('.jetpack-comment-form') ||
                         document.querySelector('input[name*="jetpack" i]') ||
                         document.querySelector('script[src*="jetpack"]');
  const jetpackProtect = document.querySelector('.jp-jetpack-contact-form') ||
                         document.querySelector('[data-jetpack-protect]');
  if (jetpackComment || jetpackProtect) {
    detected.push({
      name: 'jetpack',
      bypassable: false,
      evidence: jetpackComment ? 'comment_form' : 'protect',
      note: 'Jetpack 反垃圾依赖后端 token，无法前端绕过'
    });
  }

  return {
    detected,
    hasBypassable: detected.some(d => d.bypassable === true),
    hasUnbypassable: detected.some(d => d.bypassable === false),
    count: detected.length
  };
})()
```

### 使用方式

```bash
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d '(() => { ... })()' \
  | jq .
```

---

## 7. 可发布性判定规则

### 7.1 判定优先级

按以下优先级依次判断，命中即停止：

| 优先级 | 条件 | 判定结果 | 说明 |
|--------|------|---------|------|
| 1 | 存在不可绕过的反垃圾系统（bypassable: false） | `not_publishable` | CleanTalk、hCaptcha、Jetpack 等 |
| 2 | 存在 `bypassable: 'depends_on_config'` 且无法确认可绕过 | `not_publishable` | 保守策略 |
| 3 | 评论系统为 `none` 且无任何评论表单信号 | `not_publishable` | 页面不支持评论 |
| 4 | 存在评论表单信号（textarea / commentForm / commentSystem != 'none'） | `publishable` | 可尝试发布评论 |
| 5 | 域名已在 `sites.json` 中存在 | `skipped` | 已入库，无需重复 |
| 6 | 页面无法访问（超时 / 404 / 500） | `error` | 网络或服务器问题 |

### 7.2 站点分类规则

对判定为 `publishable` 的站点进行分类：

| 优先级 | 特征 | 分类 | 说明 |
|--------|------|------|------|
| 1 | WordPress + 有评论表单 | `blog_comment` | 最常见的博客评论场景 |
| 2 | 有评论表单 + 非论坛 | `blog_comment` | 通用博客评论 |
| 3 | 有 profile/homepage 字段 + 有注册入口 | `profile` | 个人资料外链 |
| 4 | 有 submit/product/tool 入口 | `directory` | 目录提交类 |
| 5 | 检测到 phpBB / Discuz / XenForo | `forum` | 论坛签名/帖子外链 |
| 6 | 有 "write for us" / "contributor" / "guest post" 入口 | `guest_post` | 客座文章投稿 |
| 7 | 有 bio/about/link-in-bio 字段（如 linktree、about.me 类） | `short_link` | 个人简介/短链外链 |
| 8 | 无法确定 | `blog_comment` | 默认分类 |

### 7.3 analysis 字段格式

分析结果写入 `analysis` 字段，格式如下：

```json
{
  "commentForm": {
    "hasTextarea": true,
    "textareaNames": ["comment"],
    "hasUrlField": true,
    "hasAuthorField": true,
    "hasEmailField": true,
    "hasCommentForm": true,
    "isWordPress": true,
    "commentSystem": "native"
  },
  "antispam": {
    "detected": [
      { "name": "akismet", "bypassable": true, "evidence": "script" }
    ],
    "hasBypassable": true,
    "hasUnbypassable": false,
    "count": 1
  },
  "judgment": {
    "status": "publishable",
    "category": "blog_comment",
    "reason": "WordPress 站点，原生评论表单，Akismet 可绕过"
  },
  "analyzedAt": "2025-01-01T00:00:00Z"
}
```

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
