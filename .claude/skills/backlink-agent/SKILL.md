---
name: backlink-agent
description: 外链分析与入库 Agent。通过 CDP 操控浏览器，完成外链候选导入、可发布性判断和站点入库。触发场景：用户要求分析外链、导入 Semrush 数据、批量检查页面可发布性、管理外链候选站点。
metadata:
  version: "2.0.0"
---

# Backlink Agent — 外链建设决策框架

## 前置检查

每次执行任务前，先确认环境就绪：

```bash
node "${SKILL_DIR}/scripts/check-deps.mjs"
```

脚本会依次检查 Node.js 22+、Chrome 远程调试端口、CDP Proxy（端口 3457）。

### 未通过时的引导

| 检查项 | 处理方式 |
|--------|---------|
| Node.js 版本过低 | 提示升级到 22+ |
| Chrome 未开启远程调试 | 引导打开 `chrome://inspect/#remote-debugging`，勾选 "Allow remote debugging" |
| CDP Proxy 连接超时 | 检查 Chrome 授权弹窗；查看日志 `$(getconf DARWIN_USER_TEMP_DIR)/cdp-proxy.log`（macOS）或 `/tmp/cdp-proxy.log`（Linux） |

### 通过后提示

> 环境就绪。CDP Proxy 运行在 `http://localhost:3457`。
> 所有浏览器操作将在后台 tab 中执行，不会干扰你当前的工作。
> 数据文件位于 `${SKILL_DIR}/data/` 目录。

---

## 核心理念

**带着目标进入，边看边判断，遇到阻碍就解决。**

### 外链工作的 4 阶段框架

**① 定义目标** — 明确要提交什么产品、什么类型的站点、达到什么效果。这是后续所有判断的锚点。

**② 选择策略** — 根据站点类型、已有经验（`data/site-experience.json`）、工具能力选择最可能成功的方式。先读站点经验，有经验则据此调整；无经验则走通用流程。

**③ 验证调整** — 每一步的结果都是证据。表单分析结果与预期不符？调整填充策略。提交后页面报错？分析错误原因并重试或回退。不在同一个失败的方法上反复尝试。

**④ 确认完成** — 对照原始目标检查：提交是否成功？记录是否写入？

### 最小侵入原则

- 所有操作在后台 tab 中执行（`/new` with `background: true`）
- 不操作用户已有的 tab
- 完成后关闭自己创建的 tab
- CDP Proxy 持续运行，不主动停止

---

## 工具选择决策矩阵

根据场景选择最合适的工具，不要默认只用一种：

| 场景 | 工具 | 说明 |
|------|------|------|
| 需要页面上下文交互 | **CDP /eval** | 表单检测、DOM 查询、元素操控 |
| 需要提取页面正文供分析 | **page-extractor.mjs** | 提取纯文本 + 评论信号 |
| 需要兼容 React/Vue 填表 | **form-filler.js** | 原生 setter + _valueTracker + execCommand |
| 需要辅助信息（产品页面、元数据） | **curl / Jina** | 快速获取，无需 CDP |
| 需要从产品页面提取信息 | **product-generator.mjs** | 提取 meta、标题、正文，自动生成产品记录 |

CDP Proxy API 速查（完整文档见 `references/cdp-proxy-api.md`）：

| 端点 | 用途 |
|------|------|
| GET /health | 健康检查 |
| GET /targets | 列出所有 Tab |
| GET /new?url= | 创建后台 Tab（自动等待加载） |
| GET /close?target= | 关闭 Tab |
| GET /navigate?target=&url= | 导航（自动等待加载） |
| GET /back?target= | 后退 |
| GET /info?target= | 页面标题/URL/状态 |
| POST /eval?target= | 执行 JS |
| GET /page-text?target= | 获取页面纯文本 |
| POST /setFiles?target= | 文件上传 |
| POST /click?target= | JS 点击（el.click()） |
| POST /clickAt?target= | CDP 真实鼠标点击 |
| GET /scroll?target=&y=&direction= | 滚动（含懒加载等待） |

---

## 操作概览

所有操作均为**独立操作**，可在不同时间、不同会话中分别执行。它们共享数据文件，但运行时互不依赖。

| 操作 | 说明 | 数据来源 | 详见 |
|------|------|---------|------|
| **PRODUCT** | 添加产品，提取页面信息 | 用户提供 URL → `products.json` | `references/workflow-product.md` |
| **IMPORT** | 导入外链候选数据 | 用户提供的 Semrush 数据 → `backlinks.json` | `references/workflow-import.md` |
| **ANALYZE** | 批量分析可发布性 | `backlinks.json` 中的 pending 条目 | `references/workflow-analyze.md` |
| **SUBMIT** | 对可发布站点执行表单提交 | `backlinks.json` 可发布条目 + `products.json` | `references/workflow-submit.md` |

典型使用顺序为 IMPORT → ANALYZE → SUBMIT，但不必在同一会话中完成。每个操作按需读取对应的参考文件，不需要提前全部加载。

---

## 站点经验系统

提交阶段的效率加速器。仅用于表单提交过程，分析阶段不使用。

**提交前**：读取 `${SKILL_DIR}/data/site-experience.json`，查找目标域名的操作经验。

**有经验**：根据 `fillStrategy` 选择填充方式，按 `effectivePatterns` 操作，避开 `knownTraps`。

**无经验**：正常提交流程，完成后将发现的操作经验写入该文件。

**经验过时**：策略失败时更新对应条目。

经验是提示，不是保证——站点可能更新，遇到失效时立即回退通用模式并更新经验。

---

## 并行提交策略

当有 **3+ 个可提交站点**时，启动并行提交模式。

### 规则

- **最多 3 个并行 agent**（避免 Chrome 资源耗尽）
- 每个 agent 各自创建独立标签页（`/new`），通过 `targetId` 识别
- 标签页是天然隔离的，不存在竞态条件
- 分析阶段**不并行**（需要 Claude 深度判断）

### 子 Agent prompt 模板

```
在 {domain} 提交产品 {productName}。

站点信息：{从 sites.json 提取的站点数据}
产品信息：{从 products.json 提取的产品数据}
站点经验：{从 site-experience.json 提取的经验，如有}

要求：
- 必须加载 backlink-agent skill 并遵循指引
- 将结果汇报给主 agent
```

### 结果收集

每个子 agent 完成后**汇报结果给主 agent**，由主 agent 统一写入 `submissions.json`。

---

## 行为准则

以下是外链建设过程中必须遵守的准则：

### 禁止设限

唯一合法的跳过理由：真付费墙、站已死（域名过期/404/无响应）、CF 硬封。其他"看起来难"都不是跳过理由。

### 前端不行先逆向

正常表单提交失败时：先查页面源码找隐藏 API → 检查网络请求分析提交逻辑 → 尝试直接调用后端 API。

### 去重按域名

同一域名下的不同页面视为同一个站点。去重以域名为单位。

### 查邮件必须开新标签页

查找联系邮箱时：必须用 `/new` 创建新 tab，在新 tab 中搜索，查找完毕后 `/close`。禁止在分析页面中跳转。

### rel 属性每次实测

外链的 `rel` 属性必须实际发布后检查，不依赖页面声明或他人报告。

### 先读知识库再操作

执行任何操作前，先读取相关数据文件（products.json、backlinks.json、sites.json），了解当前状态。

### 切站必须确认产品

切换到不同目标站点时，必须确认当前活跃产品。

### 邮箱失败立刻切换

自定义域名邮箱注册/提交失败时，立即切换到 Gmail 重试。

### 验证码协作先填完所有字段

遇到验证码时：先自动填写所有其他字段，最后再处理验证码。

---

## 错误处理

| 场景 | 处理方式 |
|------|---------|
| CDP Proxy 未启动 | 运行 `check-deps.mjs`，自动启动 Proxy |
| Chrome 未开启远程调试 | 提示用户启用远程调试 |
| 页面加载超时（>30s） | 标记 `error`，跳过继续 |
| CDP 连接断开 | Proxy 内置重连，持续失败则暂停提示 |
| JSON 文件损坏 | 提示用户，不自行覆盖 |
| 批量分析中途失败 | 已分析已写回，未分析的保持 `pending` |
| `/eval` 返回 JS 错误 | 检查 CSP 阻止，降级检测；标记 `error` 继续 |

---

## 任务结束

1. 关闭本次任务中创建的所有后台 tab（通过记录的 targetId 逐一 `/close`）
2. 不关闭用户原有的 tab
3. CDP Proxy 保持运行
4. 确认数据文件已正确写入

---

## References 索引

| 文件 | 何时加载 |
|------|---------|
| `references/cdp-proxy-api.md` | 需要 CDP API 详细参考时 |
| `references/data-formats.md` | 操作数据文件前，了解字段格式 |
| `references/publishability-rules.md` | 分析阶段，判断可发布性 |
| `references/workflow-product.md` | 添加产品时 |
| `references/workflow-import.md` | 进入导入阶段时 |
| `references/workflow-analyze.md` | 进入分析阶段时 |
| `references/workflow-submit.md` | 进入提交阶段时 |
