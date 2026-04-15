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
