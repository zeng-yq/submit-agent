# 可发布性判定规则

> 文件路径：`${CLAUDE_SKILL_DIR}/references/publishability-rules.md`

---

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
