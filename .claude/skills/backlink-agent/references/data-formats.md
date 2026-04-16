# 数据存储格式规范

> 文件路径：`${SKILL_DIR}/references/data-formats.md`

所有数据以 SQLite 格式存储在 `${SKILL_DIR}/data/backlink.db` 文件中。

---

### 2.1 数据库概述

- **数据库文件**：`${SKILL_DIR}/data/backlink.db`
- **访问方式**：通过 CLI 工具 `node "${SKILL_DIR}/scripts/db-ops.mjs <command> [args]"`
- **数据表**：`products`、`backlinks`、`sites`、`submissions`、`site_experience`

### 2.2 CLI 命令速查

所有命令均通过 Bash 工具执行，输出 JSON 格式。

#### 读取命令

| 命令 | 用途 | 示例 |
|------|------|------|
| `products` | 列出所有产品 | `node "${SKILL_DIR}/scripts/db-ops.mjs products` |
| `product <id>` | 获取指定产品 | `node "${SKILL_DIR}/scripts/db-ops.mjs product prod-001` |
| `backlinks [status]` | 列出外链候选（默认 pending） | `node "${SKILL_DIR}/scripts/db-ops.mjs backlinks publishable` |
| `sites [productId]` | 列出站点（可选按产品筛选） | `node "${SKILL_DIR}/scripts/db-ops.mjs sites prod-001` |
| `site <domain>` | 获取指定域名站点 | `node "${SKILL_DIR}/scripts/db-ops.mjs site example.com` |
| `submissions <productId>` | 获取指定产品的提交记录 | `node "${SKILL_DIR}/scripts/db-ops.mjs submissions prod-001` |
| `experience <domain>` | 获取站点经验 | `node "${SKILL_DIR}/scripts/db-ops.mjs experience example.com` |
| `stats` | 数据库统计概览 | `node "${SKILL_DIR}/scripts/db-ops.mjs stats` |

#### 写入命令

| 命令 | 用途 | 示例 |
|------|------|------|
| `update-backlink <id> <status> [analysis]` | 更新外链状态 | `node "${SKILL_DIR}/scripts/db-ops.mjs update-backlink bl-xxx skipped` |
| `add-publishable <id> <siteJSON>` | 标记可发布并添加站点 | `node "${SKILL_DIR}/scripts/db-ops.mjs add-publishable bl-xxx '{"id":"site-001",...}'` |
| `add-submission <submissionJSON> <experienceJSON>` | 添加提交记录和经验 | `node "${SKILL_DIR}/scripts/db-ops.mjs add-submission '{"id":"sub-xxx",...}' '{"fillStrategy":"direct",...}'` |
| `upsert-experience <domain> <experienceJSON>` | 写入/更新站点经验 | `node "${SKILL_DIR}/scripts/db-ops.mjs upsert-experience example.com '{"fillStrategy":"direct",...}'` |

---

### 2.3 数据表结构

**products** — 产品资料表：

| 列名 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | TEXT | 是 | 唯一标识，格式 `prod-{序号}` |
| `name` | TEXT | 是 | 产品名称 |
| `url` | TEXT | 是 | 产品官网 URL |
| `tagline` | TEXT | 是 | 一句话简介 |
| `short_desc` | TEXT | 是 | 简短描述（100字以内） |
| `long_desc` | TEXT | 是 | 详细描述（300字以内） |
| `categories` | TEXT | 是 | 产品分类标签（JSON 数组字符串） |
| `anchor_texts` | TEXT | 是 | 锚文本列表（JSON 数组字符串） |
| `logo_url` | TEXT | 否 | Logo 图片 URL |
| `social_links` | TEXT | 否 | 社交媒体链接（JSON 对象字符串） |
| `founder_name` | TEXT | 否 | 创始人姓名 |
| `founder_email` | TEXT | 否 | 创始人邮箱 |
| `created_at` | TEXT | 是 | ISO 8601 创建时间 |

**backlinks** — 外链候选表：

| 列名 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | TEXT | 是 | 唯一标识，格式 `bl-{timestamp}-{random4hex}` |
| `source_url` | TEXT | 是 | 来源页面 URL（UNIQUE） |
| `source_title` | TEXT | 否 | 来源页面标题 |
| `domain` | TEXT | 是 | 站点域名 |
| `page_ascore` | INTEGER | 否 | 页面权威度评分 |
| `status` | TEXT | 是 | 状态：`pending` \| `publishable` \| `not_publishable` \| `skipped` \| `error` |
| `analysis` | TEXT | 否 | 分析结果（JSON 对象字符串） |
| `added_at` | TEXT | 是 | ISO 8601 添加时间 |

状态值：`pending`（待分析） | `publishable`（可发布） | `not_publishable`（不可发布） | `skipped`（已跳过） | `error`（分析出错）

**sites** — 站点库表：

| 列名 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | TEXT | 是 | 唯一标识，格式 `site-{序号}` |
| `domain` | TEXT | 是 | 站点域名 |
| `url` | TEXT | 是 | 站点页面 URL |
| `submit_url` | TEXT | 否 | 提交页面 URL（可能与 url 不同） |
| `category` | TEXT | 是 | 站点分类（如 `blog_comment`、`directory`、`guest_post`） |
| `comment_system` | TEXT | 否 | 评论系统类型 |
| `antispam` | TEXT | 否 | 反垃圾措施列表（JSON 数组字符串） |
| `rel_attribute` | TEXT | 否 | 链接 rel 属性（`dofollow` / `nofollow`） |
| `product_id` | TEXT | 是 | 关联产品 ID |
| `pricing` | TEXT | 否 | 定价类型 `free` \| `freemium` \| `paid` \| `unknown` |
| `monthly_traffic` | TEXT | 否 | 月流量估计（字符串，如 "3.2M"） |
| `lang` | TEXT | 否 | 站点语言代码（如 "en"） |
| `dr` | INTEGER | 否 | Domain Rating 评分 |
| `notes` | TEXT | 否 | 备注 |
| `added_at` | TEXT | 是 | ISO 8601 添加时间 |

**submissions** — 提交记录表：

| 列名 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | TEXT | 是 | 唯一标识，格式 `sub-{timestamp}-{random4hex}` |
| `site_name` | TEXT | 是 | 目标站点域名 |
| `site_url` | TEXT | 是 | 提交页面 URL |
| `product_id` | TEXT | 是 | 关联产品 ID |
| `status` | TEXT | 是 | `submitted` \| `failed` \| `skipped` |
| `submitted_at` | TEXT | 是 | ISO 8601 时间戳 |
| `result` | TEXT | 否 | 提交结果描述 |
| `fields` | TEXT | 否 | 填写的字段键值对（JSON 对象字符串） |

**site_experience** — 站点经验表：

| 列名 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `domain` | TEXT | 是 | 站点域名（PRIMARY KEY） |
| `aliases` | TEXT | 否 | 域名别名（JSON 数组字符串） |
| `updated` | TEXT | 是 | 最后更新日期 |
| `submit_type` | TEXT | 否 | `"directory"` \| `"blog-comment"` |
| `form_framework` | TEXT | 否 | 表单技术栈 (native/react/vue/wordpress) |
| `antispam` | TEXT | 否 | 反垃圾系统 (none/akismet/hcaptcha/etc) |
| `fill_strategy` | TEXT | 否 | 填充策略 (direct/execCommand/reactSetter) |
| `post_submit_behavior` | TEXT | 否 | 提交后行为 (redirect/success-message/moderation-notice/silent) |
| `effective_patterns` | TEXT | 否 | 已验证有效的操作策略（JSON 数组字符串） |
| `known_traps` | TEXT | 否 | 已知的陷阱和注意事项（JSON 数组字符串） |

---

### 2.4 数据访问说明

**重要**：所有数据操作必须通过 `db-ops.mjs` CLI 执行，不要直接操作数据库文件。

- **读取数据**：使用 Bash 工具执行 `node "${SKILL_DIR}/scripts/db-ops.mjs <command>`
- **写入数据**：使用 Bash 工具执行对应的写入命令
- **CLI 输出统一为 JSON 格式**，可直接用于后续处理
- **写入命令中的 JSON 参数**需要正确转义（使用单引号包裹 JSON 字符串）
