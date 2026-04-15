# submit-agent 插件功能迁移到 backlink-agent Skill 设计文档

## 背景

当前 submit-agent 是一个 Chrome 浏览器插件（React + Content Script + Service Worker），提供外链建设的完整工作流：产品管理、站点管理、外链分析、表单自动填写、博客评论生成、目录提交、Google Sheets 同步。

backlink-agent 是一个 Claude Code skill，通过 CDP Proxy 操控浏览器，目前覆盖了外链分析和站点管理功能，但缺少表单填写、评论生成、目录提交等核心执行能力。

**目标**：将插件的全部功能迁移到 backlink-agent skill 中，使 skill 成为外链建设的完整工具。

## 决策记录

| 决策点 | 结论 | 理由 |
|-------|------|------|
| 迁移范围 | 全量迁移 | 用户需求 |
| LLM 调用 | Claude 自身处理 | skill 环境下 Claude 即 LLM，无需外部 API |
| Google Sheets | 迁移 | 用户需要数据同步能力 |
| 浮动按钮/标注器 | 不迁移 | skill 无 Content Script，用截图确认替代 |
| 迁移方案 | 模块化脚本（方案 A） | 沿用插件的模块划分，改动最小 |

## 新增脚本清单

全部挂载到 `${SKILL_DIR}/scripts/` 下，与已有 6 个脚本并列：

| 脚本 | 类型 | 来源文件 | 职责 |
|------|------|---------|------|
| `form-analyzer.js` | 注入脚本（CDP /eval） | `FormAnalyzer.ts` + `dom-utils.ts` 表单检测部分 | 扫描页面所有表单，识别字段类型（email/url/textarea 等），7 级级联标签查找，推断字段用途，生成结构化字段描述，返回 JSON |
| `form-filler.js` | 注入脚本（CDP /eval） | `dom-utils.ts` 填写部分 | 接收 Claude 提供的字段-值映射，逐字段填写（兼容 React/Vue 受控组件：原生 setter + `_valueTracker` 重置 + `execCommand` 回退），验证填写结果，返回每个字段的状态 |
| `honeypot-detector.js` | 注入脚本（CDP /eval） | `dom-utils.ts` 蜜罐检测部分 | 7 维评分检测蜜罐字段（aria-hidden、隐藏父元素、font-size:0、max-height:0、随机哈希名称、不可见定位、尺寸为零），返回风险评分和排除建议 |
| `comment-expander.js` | 注入脚本（CDP /eval） | Content Script 中懒加载展开逻辑 | 检测并展开 wpDiscuz、WordPress 默认评论等懒加载的评论表单区域，通过页面 JS 上下文注入模拟点击触发 jQuery 事件，恢复被隐藏的表单字段 |
| `sheets-sync.mjs` | Node.js 脚本 | `sync/` 目录（google-auth.ts, sheets-client.ts, serializer.ts, types.ts） | Google Sheets 数据同步：服务账号 JWT 认证、分 Tab 分块上传（500 行/块）、下载反序列化、备份-上传-回滚策略、重试处理（401/429/5xx） |
| `product-generator.mjs` | Node.js 脚本 | `profile-generator.ts` | 通过 CDP 抓取产品页面 HTML，提取 meta 标签和正文内容，输出结构化信息供 Claude 生成完整产品资料 |

### 调用方式

- **注入脚本**（.js）：`curl -s -X POST "http://localhost:3457/eval?target=<targetId>" -d @"${SKILL_DIR}/scripts/<script>.js"`
- **Node.js 脚本**（.mjs）：`node "${SKILL_DIR}/scripts/<script>.mjs" <args>`

## 核心提交流程

### 目录提交流程

```
1. Claude 调用 form-analyzer.js（注入） → 获取页面所有表单和字段结构
2. Claude 调用 honeypot-detector.js（注入） → 标记蜜罐字段，从填写列表中排除
3. Claude 自身分析字段结构 + 产品信息 → 生成字段-值映射
   - 过滤搜索框、登录表单、邮件订阅表单
   - 将产品信息（name/url/tagline/description/categories 等）映射到表单字段
4. Claude 调用 form-filler.js（注入） → 传入映射，逐字段填写
5. CDP 截图确认 → 展示给用户
6. 用户确认后 → Claude 通过 CDP /click 点击提交按钮
7. 记录提交结果到 submissions.json
```

### 博客评论流程

```
1. Claude 调用 comment-expander.js（注入） → 展开懒加载评论区域
2. Claude 调用 form-analyzer.js（注入） → 获取评论表单结构
3. Claude 调用 page-extractor.mjs → 获取页面文本内容
4. Claude 自身阅读页面内容 → 生成与内容相关的真实评论（80-300 字符）
   - 引用页面具体内容，避免泛泛赞美
   - 自然植入产品链接
5. Claude 决定链接放置策略：
   - 优先级：URL 字段 > name 字段 > 评论正文 HTML 链接
6. Claude 调用 form-filler.js（注入） → 填写评论、姓名、邮箱、URL
7. CDP 截图确认 → 用户确认 → 提交
8. 记录提交结果到 submissions.json
```

## 数据模型

### 已有文件扩展

#### `data/products.json`

每个产品记录新增字段：

```json
{
  "socialLinks": {
    "twitter": "",
    "linkedin": "",
    "facebook": ""
  },
  "founderName": "",
  "founderEmail": ""
}
```

#### `data/sites.json`

每个站点记录新增字段（从插件的 385 个种子站点迁移）：

```json
{
  "submitUrl": "https://example.com/submit",
  "pricing": "free|freemium|paid",
  "monthlyTraffic": 10000,
  "lang": "en"
}
```

### 新增文件

#### `data/submissions.json`

提交记录数组：

```json
[
  {
    "id": "sub-1713283200000-a1b2",
    "siteName": "example.com",
    "siteUrl": "https://example.com/page",
    "productId": "prod-xxx",
    "status": "submitted|failed|skipped",
    "submittedAt": "2026-04-16T10:00:00Z",
    "result": "success|error_message",
    "screenshotPath": "/tmp/submit-xxx.png",
    "fields": {
      "name": "filled_value",
      "email": "filled_value"
    }
  }
]
```

#### `data/sync-config.json`

Google Sheets 同步配置：

```json
{
  "serviceAccountKey": "{}",
  "sheetUrl": "https://docs.google.com/spreadsheets/d/xxx"
}
```

## Google Sheets 同步

### 使用方式

```bash
# 上传本地数据到 Sheet
node "${SKILL_DIR}/scripts/sheets-sync.mjs" upload \
  --config "${SKILL_DIR}/data/sync-config.json" \
  --data "${SKILL_DIR}/data"

# 从 Sheet 下载数据到本地
node "${SKILL_DIR}/scripts/sheets-sync.mjs" download \
  --config "${SKILL_DIR}/data/sync-config.json" \
  --data "${SKILL_DIR}/data"
```

### 功能

- **认证**：Google 服务账号 JWT + RS256 签名，令牌缓存和自动刷新
- **上传**：读取 4 个 JSON 文件 → 序列化为行 → 分 Tab 分块上传（500 行/块）→ 失败回滚
- **下载**：读取 4 个 Tab → 反序列化为 JSON → 写入本地文件
- **重试策略**：401 不重试、429 按 Retry-After 等待、5xx 指数退避
- **4 个 Tab**：products / submissions / sites / backlinks

## 替代浮动按钮的方案

skill 模式下无法注入 Content Script 的浮动按钮。替代方式：

- **用户主动指令**：用户浏览网页时，直接告诉 Claude "分析当前页面" 或 "提交到这个站点"
- **CDP 截图确认**：每次填写操作前后截图，Claude 展示给用户在终端确认
- **提交记录追踪**：通过 submissions.json 记录每次提交的结果，替代浮动按钮的三态显示

## SKILL.md 扩展计划

在现有 SKILL.md 基础上新增/修改以下章节：

| 章节 | 内容 |
|------|------|
| 4.6 表单提交（新增） | 目录提交和博客评论的完整流程、脚本调用顺序 |
| 4.7 提交记录管理（新增） | 查看/统计提交历史、状态筛选 |
| 4.8 Google Sheets 同步（新增） | 配置、上传下载、备份回滚 |
| 4.9 产品资料生成（新增） | 输入 URL → CDP 抓取 → Claude 生成资料 |
| 5.x - 9.x 新脚本文档（新增） | 6 个新脚本的使用说明、参数、返回值格式 |
| references/data-formats.md（更新） | 补充 submissions.json 格式和扩展字段定义 |

## 种子站点数据迁移

插件的 `sites.json` 包含 385 个预置站点。迁移方案：

1. 将插件的 `src/assets/sites.json` 转换为 backlink-agent 的 `data/sites.json` 格式
2. 作为初始种子数据，首次运行时自动加载
3. 字段映射：`submit_url` → `submitUrl`，`monthly_traffic` → `monthlyTraffic`，`dr` 保留

## 不迁移的功能

| 功能 | 原因 | 替代方案 |
|------|------|---------|
| 浮动按钮 | 依赖 Content Script + Shadow DOM | 用户主动指令 + 截图确认 |
| 表单标注器 | 依赖 Content Script + Shadow DOM | CDP 截图展示 |
| 活动日志 UI | 依赖 React 组件 | Claude 在终端中实时报告进度 |
| LLM 提供商配置 | Claude 自身即 LLM | 不需要 |
| QuickCreate UI | 依赖 React 组件 | 命令行输入 URL → product-generator.mjs + Claude |

## 实施优先级

1. **P0 - 核心**：form-analyzer.js → form-filler.js → honeypot-detector.js → comment-expander.js
2. **P1 - 数据**：submissions.json 格式定义 → 种子站点迁移 → SKILL.md 更新
3. **P2 - 同步**：sheets-sync.mjs → sync-config.json
4. **P3 - 辅助**：product-generator.mjs
