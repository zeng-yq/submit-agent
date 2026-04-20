# 添加产品流程参考

> 文件路径：`${SKILL_DIR}/references/workflow-product.md`

---

## 触发条件

用户提供一个产品 URL，要求添加产品。

---

## 流程

### 步骤 1：环境检查

运行前置检查，确保 CDP Proxy 可用（`product-generator.mjs` 需要通过浏览器提取页面信息）：

```bash
node "${SKILL_DIR}/scripts/browser/check-deps.mjs"
```

### 步骤 2：提取页面信息

运行产品页面提取脚本：

```bash
node "${SKILL_DIR}/scripts/browser/product-generator.mjs" "<product-url>"
```

脚本输出 JSON 包含以下字段：
- `url` — 页面实际 URL
- `title` — 页面标题
- `metaDescription` — meta description
- `ogTitle` — OG 标题
- `ogDescription` — OG 描述
- `ogSiteName` — OG 站点名
- `ogImage` — OG 图片
- `headings` — H1-H3 标题列表（最多 15 个）
- `bodyText` — 正文内容（前 5000 字符）

### 步骤 3：生成产品记录

基于提取结果，生成符合数据库 `products` 表结构的产品记录。

**字段映射规则：**

| 产品字段 | 来源 | 说明 |
|---------|------|------|
| `id` | 自动生成 | 先查询 `node "${SKILL_DIR}/scripts/data/db-ops.mjs products"` 获取现有最大产品序号，再生成 `prod-{最大序号+1, 补零到3位}`，如 `prod-001` |
| `name` | `ogTitle` 或 `title` | 清理站点名后缀等冗余文本 |
| `url` | 用户提供的 URL | 使用原始输入 |
| `tagline` | `ogDescription` 或 `metaDescription` | 提炼为一句话 |
| `shortDesc` | 描述 + headings | 100 字以内概括 |
| `longDesc` | `bodyText` | 提炼核心卖点，300 字以内 |
| `categories` | `headings` + `bodyText` | 推断产品分类（如 SaaS、Productivity、Developer Tools） |
| `anchorTexts` | 基于 `name` | 生成 3-5 个变体（产品名、产品名 review、best 产品名 alternative 等） |
| `logoUrl` | `ogImage` | 有则填入 |
| `socialLinks` | 不提取 | 留空 `{}` |
| `founderName` | 不提取 | 留空 `""` |
| `founderEmail` | 不提取 | 留空 `""` |

### 步骤 4：写入数据

使用 `db-ops.mjs` CLI 将产品写入数据库：

```bash
node "${SKILL_DIR}/scripts/data/db-ops.mjs add-product '<productJSON>'
```

其中 `productJSON` 包含 Step 3 生成的所有字段：`id`, `name`, `url`, `tagline`, `short_desc`, `long_desc`, `categories`, `anchor_texts`, `logo_url`, `social_links`, `founder_name`, `founder_email`, `created_at`。

### 步骤 5：汇报结果

向用户展示添加的产品摘要：

> 产品已添加：
> - **名称**：xxx
> - **URL**：xxx
> - **分类**：xxx
> - **Tagline**：xxx
