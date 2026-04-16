# 导入流程参考

> 文件路径：`${SKILL_DIR}/references/workflow-import.md`

---

## 1. 外链导入

将外链候选数据导入 `backlinks.json`。导入是纯数据处理，不依赖产品信息，也不需要浏览器环境。

支持两种导入方式：

### 方式 A：Semrush CSV 导入（推荐）

用户提供 Semrush 导出的 CSV 文件路径。

**步骤：**

1. 运行 CSV 导入脚本（脚本自动去重并生成记录）：

```bash
node "${SKILL_DIR}/scripts/import-csv.mjs" <csv-file-path> "${SKILL_DIR}/data/backlinks.json"
```

2. 脚本输出 JSON，包含 `imported`（新增数量）、`skipped`（重复跳过数量）、`records`（新记录数组）
3. 读取现有 `${SKILL_DIR}/data/backlinks.json`
4. 将新记录合并到现有数组末尾
5. 使用 Write 工具写回 `backlinks.json`

**字段映射（脚本自动处理）：**

| Semrush 字段 | 系统字段    | 说明                   |
| ------------ | ----------- | ---------------------- |
| Source url   | sourceUrl   | 来源页面 URL           |
| Source title | sourceTitle | 来源页面标题           |
| Page ascore  | pageAscore  | 页面权威度评分（数字） |

**去重规则：**

- 脚本自动按 `sourceUrl` 去重（对比 `backlinks.json` 已有记录）
- 重复记录计入 `skipped` 数量，不写入输出

### 方式 B：手动 URL 列表

用户提供一个或多个 URL，每行一个。

**步骤：**

1. 解析 URL
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
