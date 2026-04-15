# Backlink Agent Skill 设计文档

## 概述

将 submit-agent 浏览器插件的外链分析与入库功能，改写为一个 Claude Code Skill。通过 CDP（Chrome DevTools Protocol）直接操控已打开的浏览器，由 Claude Code 自身完成页面分析、表单识别、反垃圾检测和可发布性判断。

## 背景

当前 submit-agent 是一个 Chrome Extension（Manifest V3），通过 content script 注入 DOM 来分析和填写表单，用外部 LLM API 做智能判断。实际使用中发现：

- Chrome Extension 的 content script 受限于页面上下文，部分操作（如跨域请求、前端逆向）难以实现
- 额外的 LLM API 调用增加了成本和复杂度
- 知识库（反垃圾对策、平台经验）硬编码在代码中，难以快速迭代

Skill 方案的优势：
- Claude Code 自身就是强大的页面分析器（能读截图、执行 JS、分析 DOM）
- CDP 直接操控浏览器，能力边界远超 content script
- 知识库以 Markdown 文件维护，迭代极快
- 无需外部 LLM API，零额外成本

## 技术选型

| 维度 | 选择 | 理由 |
|------|------|------|
| 执行环境 | Claude Code Skill | 原生集成，无需额外进程 |
| 浏览器操控 | CDP Proxy（Fork 自 web-access） | 已验证的架构，直接操控用户 Chrome |
| Proxy 端口 | localhost:3457 | 与 web-access（3456）独立，避免冲突 |
| 智能判断 | Claude Code 自身 | 无需外部 LLM API |
| 数据存储 | 本地 JSON 文件 | 简单直接，Claude Code 可直接读写 |
| 外链来源 | Semrush CSV + 手动 URL | 覆盖主要使用场景 |

## 第一版范围

仅覆盖**外链分析与入库**，不包括：
- 表单自动填写（后续版本）
- 产品管理 UI（用 JSON 文件手动编辑）
- Google Sheets 同步
- 浮动按钮

## 文件结构

```
~/.claude/skills/backlink-agent/
├── SKILL.md                          # 核心指令文件（~300-400 行）
├── scripts/
│   └── cdp-proxy.mjs                 # Fork 自 web-access/cdp-proxy.mjs
├── data/
│   ├── products.json                 # 产品资料
│   ├── backlinks.json                # 外链候选
│   ├── sites.json                    # 站点库
│   └── submissions.json              # 提交记录（预留）
└── references/                       # 站点经验（按需积累）
    └── .gitkeep
```

## 数据模型

### products.json

```json
[
  {
    "id": "prod-1",
    "name": "Product Name",
    "url": "https://example.com",
    "tagline": "One-line description",
    "shortDesc": "50-100 char description for directories",
    "longDesc": "Full description for detailed submissions",
    "categories": ["SaaS", "Developer Tools"],
    "anchorTexts": ["primary keyword", "secondary keyword"],
    "logoUrl": "https://...",
    "socialLinks": {
      "twitter": "https://twitter.com/...",
      "github": "https://github.com/..."
    },
    "founderName": "Jane Doe",
    "founderEmail": "jane@example.com"
  }
]
```

### backlinks.json

```json
[
  {
    "id": "bl-1",
    "sourceUrl": "https://example.com/blog/post-1",
    "sourceTitle": "Blog Post Title",
    "domain": "example.com",
    "pageAscore": 45,
    "status": "pending",
    "analysisNotes": "",
    "antiSpamDetected": [],
    "addedAt": 1700000000000
  }
]
```

status 枚举：`pending` | `publishable` | `not_publishable` | `skipped` | `error`

### sites.json

```json
[
  {
    "name": "example.com",
    "url": "https://example.com/blog/post-1",
    "category": "blog_comment",
    "domain": "example.com",
    "dr": null,
    "monthlyTraffic": null,
    "status": "active",
    "antiSpamDetected": [],
    "addedAt": 1700000000000,
    "notes": ""
  }
]
```

category 枚举：`blog_comment` | `directory` | `profile` | `forum` | `guest_post` | `short_link`

### submissions.json（预留）

```json
[
  {
    "id": "sub-1",
    "productId": "prod-1",
    "siteName": "example.com",
    "sourceUrl": "https://example.com/blog/post-1",
    "status": "not_started",
    "rel": null,
    "notes": "",
    "submittedAt": null
  }
]
```

## 核心执行流程

### 1. 环境检查

- curl localhost:3457/health 确认 cdp-proxy 已启动
- 确认 Chrome 已开启远程调试（读取 DevToolsActivePort）
- 如果 proxy 未启动，提示用户执行 `node scripts/cdp-proxy.mjs`

### 2. 产品确认

- 读取 data/products.json
- 如果为空或用户未指定，提示用户创建产品资料
- 如果有多个产品，让用户选择当前活跃产品
- 将活跃产品 ID 传入后续流程

### 3. 外链导入

**方式 A：Semrush CSV**
- 用户提供 CSV 文件路径
- Claude Code 读取并解析（字段映射：`Source url` → sourceUrl，`Source title` → sourceTitle，`Page ascore` → pageAscore）
- 从 sourceUrl 提取 domain
- 去重：按 sourceUrl 去重，跳过 backlinks.json 中已存在的记录
- 追加到 backlinks.json，status 设为 pending

**方式 B：手动 URL 列表**
- 用户提供 URL 列表（粘贴或文件）
- 逐个解析 domain，生成 backlinks.json 记录
- 去重逻辑同上

### 4. 批量分析可发布性

对 backlinks.json 中 status=pending 的记录逐个分析：

```
对每个 pending 记录：
  1. /navigate 打开源页面
  2. 等待页面加载完成（/info 检查 readyState）
  3. /eval 执行评论表单检测脚本（见下方）
  4. /eval 执行反垃圾系统检测脚本（见下方）
  5. Claude Code 综合分析：
     - DOM 信号（表单字段是否存在）
     - 反垃圾系统检测结果
     - 页面截图（可选）
     - 页面文本内容（可选）
  6. 判定结果：
     - publishable → 写入 backlinks.json + 追加到 sites.json
     - not_publishable → 写入 backlinks.json
     - skipped（域名已存在）→ 写入 backlinks.json
     - error（页面超时/无法访问）→ 写入 backlinks.json
```

### 5. 报告输出

- 总候选数、可发布数、不可发布数、跳过数、错误数
- 按域名分组的可发布站点列表
- 检测到的反垃圾系统分布
- 建议的优先提交顺序（按 pageAscore 降序）

## 评论表单检测脚本

通过 `/eval` 在目标页面执行的 JavaScript：

```javascript
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

  // 检测 textarea
  const textareas = document.querySelectorAll('textarea');
  textareas.forEach(t => {
    if (t.name.match(/comment|message|content|text|body/i)) {
      signals.hasTextarea = true;
      signals.textareaNames.push(t.name);
    }
  });

  // 检测 URL 字段
  const urlInputs = document.querySelectorAll('input[type="url"], input[name*="url"], input[name*="website"], input[name*="homepage"]');
  signals.hasUrlField = urlInputs.length > 0;

  // 检测 author 字段
  const authorInputs = document.querySelectorAll('input[name*="author"], input[name*="name"], input[name*="nick"]');
  signals.hasAuthorField = authorInputs.length > 0;

  // 检测 email 字段
  const emailInputs = document.querySelectorAll('input[type="email"], input[name*="email"], input[name*="mail"]');
  signals.hasEmailField = emailInputs.length > 0;

  // 检测评论表单
  const forms = document.querySelectorAll('form');
  forms.forEach(f => {
    const action = f.getAttribute('action') || '';
    if (action.match(/comment|respond|wp-comments/i)) {
      signals.hasCommentForm = true;
    }
    signals.formActions.push(action);
  });

  // 检测 WordPress
  signals.isWordPress = !!(
    document.querySelector('meta[name="generator"][content*="WordPress"]') ||
    document.querySelector('link[href*="wp-content"]') ||
    document.body.classList.contains('wordpress')
  );

  // 识别评论系统
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

```javascript
(() => {
  const detected = [];
  const html = document.documentElement.outerHTML;

  // Akismet
  if (html.match(/akismet/i) || document.querySelector('input[name*="akismet"]')) {
    detected.push({ system: 'akismet', bypassable: true });
  }

  // Antispam Bee
  if (html.match(/antispam.?bee/i) || document.querySelector('input[name^="ab_"]')) {
    detected.push({ system: 'antispam_bee', bypassable: true });
  }

  // WPantispam Protect
  if (html.match(/wpantispam/i)) {
    detected.push({ system: 'wpantispam', bypassable: 'depends_on_config' });
  }

  // CleanTalk
  if (html.match(/ct_checkjs|cleantalk/i)) {
    detected.push({ system: 'cleantalk', bypassable: false });
  }

  // hCaptcha
  if (html.match(/hcaptcha\.com|h-captcha/i)) {
    detected.push({ system: 'hcaptcha', bypassable: false });
  }

  // Jetpack Highlander
  if (html.match(/jetpack.?comment|highlander/i) || document.querySelector('iframe[src*="jetpack"]')) {
    detected.push({ system: 'jetpack', bypassable: false });
  }

  return detected;
})()
```

## 可发布性判定规则

```
如果有不可绕过的反垃圾系统（cleantalk / hcaptcha / jetpack）:
  → not_publishable

如果没有任何评论表单信号（无 textarea、无 comment form）:
  → not_publishable

如果有评论表单信号:
  → publishable（标记检测到的反垃圾系统，供后续提交参考）

如果域名在 sites.json 中已存在:
  → skipped（去重）

如果页面无法访问 / 超时:
  → error
```

## 铁律（从文章提炼）

1. **禁止设限** — 需要填 20 个字段？全填。唯一合法跳过：真付费墙 / 站已死 / CF 硬封
2. **前端不行先逆向** — 按钮无反应 → 第一反应找后端 API，不是标跳过
3. **候选筛选查 spam + traffic** — DR 是假指标，traffic 是真
4. **去重按域名不按模板 ID** — 同一域名可能有多条记录
5. **查邮件必须开新标签页** — 绝不 navigate 离开有表单的页面
6. **rel 属性每次实测** — 提交后 JS 验证，不信任 DB 标记
7. **先读知识库再操作** — 平台经验优先于猜测
8. **切站必须确认产品** — 确认当前活跃产品信息
9. **catch-all 邮箱失败立刻切 Gmail** — 很多站静默拒绝自定义域名邮箱
10. **验证码协作先填完所有字段** — 只剩验证码才叫人

## cdp-proxy.mjs 适配

从 web-access 的 cdp-proxy.mjs fork，改动：

1. **默认端口改为 3457**（与 web-access 的 3456 独立）
2. **保留所有现有端点**：/health, /targets, /new, /close, /navigate, /back, /info, /eval, /click, /clickAt, /setFiles, /scroll, /screenshot
3. **保留反风控机制**（端口探测拦截）
4. **新增 /page-text 端点**（可选）：返回页面纯文本内容，用于快速分析页面语义而不需要截图

新增端点规格：
```
GET /page-text?target=ID
→ 返回 document.body.innerText（纯文本，去除 HTML 标签）
```

## 错误处理

| 场景 | 处理方式 |
|------|---------|
| cdp-proxy 未启动 | 提示用户执行 `node scripts/cdp-proxy.mjs` |
| Chrome 未开启远程调试 | 提示用户在 chrome://inspect/#remote-debugging 开启 |
| 页面导航超时（>30s） | 标记 error，跳过，继续下一个 |
| CDP WebSocket 断连 | 重连一次，仍失败则暂停并提示用户 |
| JSON 文件损坏 | 提示用户，不自动修复 |

## 后续版本规划（不在第一版范围内）

- **v2**：表单自动填写（分析表单字段 → Claude Code 生成填写值 → CDP 逐字段填写）
- **v3**：多站点并发（多 tab 并行分析）
- **v4**：知识库积累（站点经验文件、平台速查表）
- **v5**：前端逆向 SOP 集成（API 发现 → 直接调用）
- **v6**：rel 属性实测 + 搜索引擎 Ping
