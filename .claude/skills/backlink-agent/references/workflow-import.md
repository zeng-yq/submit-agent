# 导入流程参考

> 文件路径：`${SKILL_DIR}/references/workflow-import.md`

---

## 1. 产品确认

外链建设必须关联一个产品。流程如下：

### 步骤 1：读取产品列表

使用 Read 工具读取 `${SKILL_DIR}/data/products.json`。

### 步骤 2：处理空列表

如果文件为空数组 `[]`，引导用户先添加产品（参见 `references/workflow-product.md`），添加完成后再继续导入流程。

### 步骤 3：多产品选择

如果产品列表中有多个产品，展示列表让用户选择当前要操作的产品。记录选中的产品 ID 为本次任务的「活跃产品」。

### 步骤 4：确认活跃产品

在后续所有操作中，始终使用确认的活跃产品。如果用户中途切换产品，需重新确认。

---

## 2. 外链导入

将外链候选数据导入 `backlinks.json`。支持两种导入方式：

### 方式 A：Semrush CSV 导入（推荐）

用户提供 Semrush 导出的 CSV 文件路径。

**步骤：**

1. 运行 CSV 导入脚本：

```bash
node "${SKILL_DIR}/scripts/import-csv.mjs" <csv-file-path> "${SKILL_DIR}/data/backlinks.json"
```

2. 脚本输出 JSON，包含 `imported`（新增数量）、`skipped`（重复跳过数量）、`records`（新记录数组）
3. 读取脚本输出的 JSON
4. 读取现有 `${SKILL_DIR}/data/backlinks.json`
5. 将新记录合并到现有数组末尾
6. 使用 Write 工具写回 `backlinks.json`

**字段映射（脚本自动处理）：**

| Semrush 字段 | 系统字段 | 说明 |
|-------------|---------|------|
| Source url | sourceUrl | 来源页面 URL |
| Source title | sourceTitle | 来源页面标题 |
| Page ascore | pageAscore | 页面权威度评分（数字） |

**去重规则：**
- 脚本自动按 `sourceUrl` 去重（对比 `backlinks.json` 已有记录）
- 重复记录计入 `skipped` 数量，不写入输出

### 方式 B：手动 URL 列表

用户提供一个或多个 URL，每行一个。

**步骤：**

1. 逐行解析 URL
2. 对每个 URL 生成记录：
   - `sourceUrl` = 原始 URL
   - `sourceTitle` = 空
   - `pageAscore` = 0
   - `id` = `bl-` + 时间戳 + `-` + 4 位随机十六进制
   - `domain` = `new URL(sourceUrl).hostname`
   - `status` = `pending`
   - `analysis` = `null`
   - `addedAt` = 当前 ISO 时间
3. 按 `sourceUrl` 去重
4. 合并到 `backlinks.json` 并写回
