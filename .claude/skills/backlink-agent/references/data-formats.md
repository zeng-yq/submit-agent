# 数据文件格式规范

> 文件路径：`${CLAUDE_SKILL_DIR}/references/data-formats.md`

所有数据以 JSON 格式存储在 `${CLAUDE_SKILL_DIR}/data/` 目录下。

---

### 2.1 文件清单

| 文件 | 路径 | 用途 |
|------|------|------|
| 产品资料 | `${CLAUDE_SKILL_DIR}/data/products.json` | 存储要推广的产品信息（名称、描述、锚文本等） |
| 外链候选 | `${CLAUDE_SKILL_DIR}/data/backlinks.json` | 外链候选站点列表，每条包含来源 URL、分析状态、检测结果 |
| 站点库 | `${CLAUDE_SKILL_DIR}/data/sites.json` | 已确认可发布的站点，作为外链建设的最终目标库 |
| 提交记录 | `${CLAUDE_SKILL_DIR}/data/submissions.json` | 每次外链提交的结果记录 |
| 同步配置 | `${CLAUDE_SKILL_DIR}/data/sync-config.json` | Google Sheets 同步配置 |

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
    "socialLinks": { "twitter": "...", "linkedin": "...", "facebook": "..." },
    "founderName": "创始人姓名",
    "founderEmail": "founder@example.com"
  }
]
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一标识，格式 `prod-{序号}` |
| `name` | string | 是 | 产品名称 |
| `url` | string | 是 | 产品官网 URL |
| `tagline` | string | 是 | 一句话简介 |
| `shortDesc` | string | 是 | 简短描述（100字以内） |
| `longDesc` | string | 是 | 详细描述（300字以内） |
| `categories` | string[] | 是 | 产品分类标签 |
| `anchorTexts` | string[] | 是 | 锚文本列表 |
| `logoUrl` | string | 否 | Logo 图片 URL |
| `socialLinks` | object | 否 | 社交媒体链接对象 `{ twitter, linkedin, facebook }` |
| `founderName` | string | 否 | 创始人姓名 |
| `founderEmail` | string | 否 | 创始人邮箱 |

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
    "submitUrl": "https://example.com/submit",
    "category": "blog_comment",
    "commentSystem": "native",
    "antispam": [],
    "relAttribute": "dofollow",
    "productId": "prod-001",
    "pricing": "free",
    "monthlyTraffic": "3.2M",
    "lang": "en",
    "dr": 45,
    "notes": "高质量站点，审核周期约3天",
    "addedAt": "2025-01-01T00:00:00Z"
  }
]
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一标识，格式 `site-{序号}` |
| `domain` | string | 是 | 站点域名 |
| `url` | string | 是 | 站点页面 URL |
| `submitUrl` | string | 否 | 提交页面 URL（可能与 url 不同） |
| `category` | string | 是 | 站点分类（如 `blog_comment`、`directory`、`guest_post`） |
| `commentSystem` | string | 否 | 评论系统类型 |
| `antispam` | string[] | 否 | 反垃圾措施列表 |
| `relAttribute` | string | 否 | 链接 rel 属性（`dofollow` / `nofollow`） |
| `productId` | string | 是 | 关联产品 ID |
| `pricing` | string | 否 | 定价类型 `free` \| `freemium` \| `paid` \| `unknown` |
| `monthlyTraffic` | string | 否 | 月流量估计（字符串，如 "3.2M"） |
| `lang` | string | 否 | 站点语言代码（如 "en"） |
| `dr` | number | 否 | Domain Rating 评分 |
| `notes` | string | 否 | 备注 |
| `addedAt` | string | 是 | ISO 8601 添加时间 |

**submissions.json** — 提交记录数组，记录每次外链提交的结果：
```json
[
  {
    "id": "sub-1714000000-a1b2",
    "siteName": "example.com",
    "siteUrl": "https://example.com/submit",
    "productId": "prod-001",
    "status": "submitted",
    "submittedAt": "2025-01-01T00:00:00Z",
    "result": "提交成功，等待审核",
    "screenshotPath": "screenshots/example-com-2025-01-01.png",
    "fields": { "name": "产品名", "email": "founder@example.com" }
  }
]
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一标识，格式 `sub-{timestamp}-{random4hex}` |
| `siteName` | string | 是 | 目标站点域名 |
| `siteUrl` | string | 是 | 提交页面 URL |
| `productId` | string | 是 | 关联产品 ID |
| `status` | string | 是 | `submitted` \| `failed` \| `skipped` |
| `submittedAt` | string | 是 | ISO 8601 时间戳 |
| `result` | string | 否 | 提交结果描述 |
| `screenshotPath` | string | 否 | 截图文件路径 |
| `fields` | object | 否 | 填写的字段键值对 |

**sync-config.json** — Google Sheets 同步配置：
```json
{
  "serviceAccountKey": "{ ... Google Cloud 服务账号 JSON 密钥 ... }",
  "sheetUrl": "https://docs.google.com/spreadsheets/d/xxx/edit"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `serviceAccountKey` | string | Google Cloud 服务账号 JSON 密钥（完整 JSON 字符串） |
| `sheetUrl` | string | Google Sheet URL |
