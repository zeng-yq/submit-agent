# 分析流程参考

> 文件路径：`${SKILL_DIR}/references/workflow-analyze.md`

---

## 1. 单条分析流程

对 `backlinks.json` 中每条 `status: "pending"` 的记录执行以下步骤：

### 步骤 1：域名去重检查

读取 `${SKILL_DIR}/data/sites.json`，如果该记录的 `domain` 已存在于站点库中，直接将 status 更新为 `skipped`，跳过后续步骤。

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
  -d "$(cat "${SKILL_DIR}/scripts/detect-comment-form.js")"

# 反垃圾系统检测
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${SKILL_DIR}/scripts/detect-antispam.js")"
```

### 步骤 5：快速判定

基于步骤 4 的结构化检测结果，尝试快速判定：

- **直接判定为 `not_publishable`**：
  - 存在 `bypassable: false` 的反垃圾系统（CleanTalk、hCaptcha、Jetpack）
  - 存在 `bypassable: 'depends_on_config'` 的反垃圾系统（保守策略）
  - `commentSystem` 为 `none` 且 `hasTextarea` 为 `false` 且 `hasCommentForm` 为 `false`

- **直接判定为 `publishable`**：
  - `commentSystem` 为 `native` 且 `hasTextarea` 为 `true` 且 `hasUnbypassable` 为 `false`

如果快速判定结果明确，跳过步骤 6，直接进入步骤 7。

### 步骤 6：Claude 综合判定（仅对快速判定无法明确的情况）

当评论系统为 Disqus/Facebook/Commento 等第三方系统，或评论信号模糊时，需要 Claude 做语义分析：

1. 执行页面内容提取脚本：

```bash
node "${SKILL_DIR}/scripts/page-extractor.mjs" <targetId>
```

2. 将提取结果（title、textContent、commentSignals）与步骤 4 的检测结果一起交给 Claude 分析
3. Claude 根据 `publishability-rules.md` 中的规则，综合判断可发布性
4. 输出判定结果：`{ status, category, reason }`

**需要 Claude 判定的典型场景：**
- 评论系统为 `disqus` / `facebook` / `commento`（第三方系统，需判断是否可操作）
- 存在 `bypassable: 'depends_on_config'` 的反垃圾（需具体分析）
- `commentSystem` 为 `none` 但 `hasTextarea` 为 `true`（textarea 用途不明确）

### 步骤 7：写回数据

将分析结果写入该条记录的 `analysis` 字段（格式见 `references/publishability-rules.md` 7.3 节），更新 `status`。使用 Write 工具写回 `backlinks.json`。

如果判定为 `publishable`，同时创建站点记录写入 `sites.json`。

### 步骤 8：关闭 tab

```bash
curl -s "http://localhost:3457/close?target=<targetId>"
```

---

## 2. 批量处理规则

- **逐条分析**：每次只打开一个 tab，分析完立即关闭再打开下一个
- **即时写回**：每条分析完成后立即更新 `backlinks.json`，防止中途丢失
- **进度报告**：每分析完 10 条，向用户报告进度（已完成/总数）
- **超时处理**：单条分析超过 30 秒标记为 `error` 并跳过，继续下一条
- **可恢复**：如果中途中断，下次启动时只会处理 `status: "pending"` 的记录

---

## 3. 报告输出

批量分析完成后，生成并展示分析报告。

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

按 `pageAscore` 降序排列，展示：

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
- 将 `publishable` 的站点自动迁移到 `sites.json`（需用户确认）
- 按反垃圾系统类型分组，推荐处理优先级
- 标注可直接操作的站点（无反垃圾 + 原生评论表单）

---

## 4. 相关参考

- 可发布性判定规则：`${SKILL_DIR}/references/publishability-rules.md`
- 数据格式规范：`${SKILL_DIR}/references/data-formats.md`
