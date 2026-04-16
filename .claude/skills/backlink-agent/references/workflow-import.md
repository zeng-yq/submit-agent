# 导入流程参考

> 文件路径：`${SKILL_DIR}/references/workflow-import.md`

---

## 1. 外链导入

将外链候选数据导入 SQLite 数据库的 `backlinks` 表。导入是纯数据处理，不依赖产品信息，也不需要浏览器环境。

支持两种导入方式：

### 方式 A：Semrush CSV 导入（推荐）

用户提供 Semrush 导出的 CSV 文件路径。

**步骤：**

1. 运行 CSV 导入脚本（脚本自动解析、去重并写入数据库）：

```bash
node "${SKILL_DIR}/scripts/data/import-csv.mjs" <csv-file-path>
```

2. 脚本输出 JSON：`{ "imported": <新增数量>, "skipped": <重复跳过数量> }`
3. 导入完成，数据已直接写入 SQLite 数据库

**字段映射（脚本自动处理）：**

| Semrush 字段 | 系统字段 | 说明 |
| ------------ | -------- | ---- |
| Source url | source_url | 来源页面 URL |
| Source title | source_title | 来源页面标题 |
| Page ascore | page_ascore | 页面权威度评分（数字） |

**去重规则：**

- 脚本自动按 `source_url` 去重（对比数据库已有记录）
- 重复记录计入 `skipped` 数量，不写入数据库

### 方式 B：手动 URL 列表

用户提供一个或多个 URL，每行一个。

**步骤：**

1. 解析 URL
2. 对每个 URL 生成记录并写入数据库：
   - `source_url` = 原始 URL
   - `source_title` = 空
   - `page_ascore` = 0
   - `id` = `bl-` + 时间戳 + `-` + 4 位随机十六进制
   - `domain` = `new URL(sourceUrl).hostname`
   - `status` = `pending`
   - `analysis` = `null`
   - `added_at` = 当前 ISO 时间
3. 按 `source_url` 去重
4. 通过 `db-ops.mjs` 写入数据库
