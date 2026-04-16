# 分析流程参考

> 文件路径：`${SKILL_DIR}/references/workflow-analyze.md`

---

## 1. 单条分析流程

对 `backlinks` 表中每条 `status: "pending"` 的记录执行以下步骤：

### 步骤 1：域名去重检查

```bash
node "${SKILL_DIR}/scripts/data/db-ops.mjs site <domain>
```

如果该记录的 `domain` 已存在于站点库中，直接将 status 更新为 `skipped`，跳过后续步骤：

```bash
node "${SKILL_DIR}/scripts/data/db-ops.mjs update-backlink <id> skipped
```

### 步骤 2：打开页面

```bash
curl -s "http://localhost:3457/new?url=<sourceUrl>"
# 返回 {"targetId":"xxx"}，记录此 ID
```

### 步骤 3：确认页面加载

```bash
curl -s "http://localhost:3457/info?target=<targetId>"
# 确认 ready 为 "complete"
```

如果 ready 不是 `complete`，等待最多 30 秒。超时则标记该条为 `error` 并跳过。

### 步骤 4：结构化检测

分别执行评论表单检测和反垃圾系统检测：

```bash
# 评论表单检测
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${SKILL_DIR}/scripts/injection/detect-comment-form.js")"

# 反垃圾系统检测
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${SKILL_DIR}/scripts/injection/detect-antispam.js")"
```

### 步骤 5：判定决策树

基于步骤 4 的结构化检测结果，按以下决策树判定：

```
检测结果
  ├─ bypassable=false 的反垃圾 → not_publishable
  ├─ bypassable=depends_on_config → not_publishable（保守）
  ├─ 无评论表单信号 → not_publishable
  ├─ 原生评论 + textarea + 无硬封 → publishable
  └─ 模糊信号 → Claude 综合判定（加载 publishability-rules.md）
```

**Claude 综合判定流程**（仅对模糊信号触发）：

1. 执行页面内容提取脚本：

```bash
node "${SKILL_DIR}/scripts/browser/page-extractor.mjs" <targetId>
```

2. 将提取结果（title、textContent、commentSignals）与步骤 4 的检测结果一起交给 Claude 分析
3. Claude 根据 `publishability-rules.md` 中的规则，综合判断可发布性
4. 输出判定结果：`{ status, category, reason }`

**触发 Claude 综合判定的典型场景：**
- 评论系统为 `disqus` / `facebook` / `commento`（第三方系统，需判断是否可操作）
- `commentSystem` 为 `none` 但 `hasTextarea` 为 `true`（textarea 用途不明确）

### 步骤 6：写回数据

根据判定结果选择对应的写入命令：

**不可发布（not_publishable）**：
```bash
node "${SKILL_DIR}/scripts/data/db-ops.mjs update-backlink <id> not_publishable '<analysisJSON>'
```

**已跳过（skipped）**：
```bash
node "${SKILL_DIR}/scripts/data/db-ops.mjs update-backlink <id> skipped
```

**可发布（publishable）**：使用 `add-publishable` 一次性更新外链状态并创建站点记录：
```bash
node "${SKILL_DIR}/scripts/data/db-ops.mjs add-publishable <id> '<siteJSON>'
```

分析结果写入 `analysis` 字段（格式见 `references/publishability-rules.md` 7.3 节）。

### 步骤 7：关闭 tab

```bash
curl -s "http://localhost:3457/close?target=<targetId>"
```

---

## 2. 批量处理规则

- **并行分析**：最多 3 个 subagent 同时分析不同外链候选（滑动窗口模式）
- **每条由独立 subagent 执行**：subagent 自行创建 tab、执行检测、判定、写回数据库、关闭 tab
- **即时写回**：每条分析完成后立即通过 `db-ops.mjs` 更新数据库，防止中途丢失
- **进度报告**：主 agent 每收到 5 条 subagent 返回结果后，向用户报告进度（已完成/总数/成功率）
- **超时处理**：单条分析超过 30 秒标记为 `error` 并跳过，继续下一条
- **可恢复**：如果中途中断，下次启动时只会处理 `status: "pending"` 的记录
- **并发安全**：数据库已启用 WAL + busy_timeout（5s），多个 subagent 可安全并发读写

---

## 3. 报告输出

所有 subagent 完成后，主 agent 查询数据库生成分析报告。

### 3.1 总览

```
外链分析报告
============
总数：N
可发布：A（X%）
不可发布：B（Y%）
已跳过：C（Z%）
分析出错：D
```

### 3.2 可发布站点列表

按 `page_ascore` 降序排列，展示：

| 排名 | 域名 | URL | 分类 | 评论系统 | 反垃圾系统 | AScore |
|------|------|-----|------|---------|-----------|--------|
| 1 | example.com | https://example.com/... | blog_comment | native | 无 | 85 |

### 3.3 反垃圾系统分布

```
反垃圾系统分布：
- 无反垃圾：45（60%）
- Akismet：15（20%）
- Anti-spam Bee：10（13%）
- hCaptcha：3（4%）
- CleanTalk：2（3%）
```

### 3.4 不可发布原因分布

```
不可发布原因：
- 无评论表单信号：25（62%）
- 不可绕过的反垃圾系统：10（25%）
- 页面无法访问：5（13%）
```

### 3.5 后续建议

根据分析结果给出可操作的建议：
- 将 `publishable` 的站点自动迁移到 `sites` 表（需用户确认）
- 按反垃圾系统类型分组，推荐处理优先级
- 标注可直接操作的站点（无反垃圾 + 原生评论表单）

---

## 并行分析策略

每次最多 **3 个 subagent** 同时分析不同的外链候选。主 agent 只做轻量调度，不承载业务数据。

### 设计原则

- **主 agent 是调度器**：只持有待分析记录列表和每条的简短状态，不读取/传递业务数据
- **Subagent 自给自足**：自行通过 `db-ops.mjs` 读取数据、操控浏览器、写入结果
- **返回最小摘要**：subagent 只向主 agent 返回一行结果，不回传完整过程

### 调度循环

```
主 Agent (调度器, 滑动窗口 maxSize=3)
  │
  │  1. 查询 backlinks 表中 status: "pending" 的记录
  │  2. 取前 3 条，派发 3 个 subagent（后台运行）
  │
  │── subagent-1: {id, domain, sourceUrl} ──→ 打开tab → 检测 → 判定 → 写回 → 关闭tab
  │── subagent-2: {id, domain, sourceUrl} ──→ ...
  │── subagent-3: {id, domain, sourceUrl} ──→ ...
  │
  │  3. 任一 subagent 返回 → 立即派发下一个 pending 记录
  │  4. 重复直到所有 pending 记录处理完毕
  │  5. 生成分析报告
```

### Subagent prompt 模板

```
分析外链候选 {id}（{domain}，{sourceUrl}）。

数据操作：
- 查询站点是否已存在：node "${SKILL_DIR}/scripts/data/db-ops.mjs site <domain>
- 更新外链状态：node "${SKILL_DIR}/scripts/data/db-ops.mjs update-backlink <id> <status> [analysisJSON]
- 标记可发布+添加站点：node "${SKILL_DIR}/scripts/data/db-ops.mjs add-publishable <id> '<siteJSON>'

要求：
- 必须加载 backlink-agent skill 并遵循分析流程指引（workflow-analyze.md）
- 自行创建 tab 打开页面，分析完成后自行关闭 tab
- 分析结果必须自行写入数据库
- 返回简短摘要

返回格式：
{id} | {domain} | publishable/not_publishable/skipped/error | 一句话说明
```

### 并行控制规则

- **最大并发 3**：同时运行的 subagent 不超过 3 个
- **滑动窗口**：一个完成，立即派发下一个，不等待整批完成
- **失败不重试**：subagent 标记为 `error` 的记录保持 error，不自动重试
- **进度报告**：每 5 条完成后向用户报告进度（已完成/总数/成功率）
- **上下文控制**：主 agent 上下文只增加一行摘要（约 50 tokens）每条记录

---

## 4. 相关参考

- 可发布性判定规则：`${SKILL_DIR}/references/publishability-rules.md`
- 数据格式规范：`${SKILL_DIR}/references/data-formats.md`
