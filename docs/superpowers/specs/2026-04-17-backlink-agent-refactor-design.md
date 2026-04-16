# Backlink Agent v3.0 重构设计

## 背景

backlink-agent 是一个外链建设自动化 Skill，通过 CDP 操控浏览器完成产品管理、外链导入、可发布性分析和表单提交。

当前版本存在以下问题：
1. **SKILL.md 过长（~370 行）**：混含参考手册、流程指南、决策矩阵和行为准则，AI 难以快速定位
2. **workflow-product.md 有过时引用**：仍引用 `products.json` 文件存储，但数据已迁移到 SQLite
3. **db-ops.mjs 职责过重**：既是模块 API 又是 CLI 工具，CLI 参数接口不统一
4. **脚本平铺**：12 个脚本文件全部在 `scripts/` 根目录，无职责分层
5. **扩展性瓶颈**：新增数据表需改动 4+ 个文件（schema、CRUD、CLI、文档）

## 目标

1. SKILL.md 从 370 行降到 ~130 行，成为极简入口 + 按需加载路由
2. 数据层改为声明式 Schema，新增表只需加一个配置对象
3. 脚本按职责分为 data/browser/injection 三层
4. 修复所有过时引用
5. 保持数据库 schema（表结构）不变

## 设计

### 1. SKILL.md 极简入口（目标 ~130 行）

**保留内容**：
- 触发条件（5 行）
- 前置检查决策树（20 行）
- 操作路由表（10 行）
- 数据访问速查（10 行）
- 完整行为准则（30 行）
- References 按需加载表（10 行）
- 错误处理概览（15 行）

**移除内容**：
- 工具选择决策矩阵 → 移入 `references/tool-guide.md`
- 并行分析策略详细描述 → 移入 `workflow-analyze.md`
- 串行提交策略详细描述 → 移入 `workflow-submit.md`
- CDP Proxy API 速查表 → 保留在 `cdp-proxy-api.md`
- 站点经验系统详细流程 → 移入 `workflow-submit.md`

**SKILL.md 模板**：

```markdown
---
name: backlink-agent
description: 外链分析与入库 Agent。通过 CDP 操控浏览器，完成外链候选导入、可发布性判断和站点入库。
metadata:
  version: "3.0.0"
---

# Backlink Agent — 外链建设决策引擎

## 角色
你是外链建设决策引擎。通过 CDP 操控浏览器，完成产品管理、外链导入、
可发布性分析和表单提交。

## 触发条件
- 用户要求分析外链、导入 Semrush 数据、批量检查页面可发布性
- 用户要求管理外链候选站点或提交产品

## 前置检查
根据操作类型按需检查环境：

| 操作 | 检查项 |
|------|--------|
| IMPORT | 仅 Node.js |
| PRODUCT / ANALYZE / SUBMIT | Node.js + Chrome + CDP Proxy |

需要浏览器时执行：
```bash
cd "${SKILL_DIR}" && npm install
node "${SKILL_DIR}/scripts/browser/check-deps.mjs"
```

环境就绪后提示用户：
> CDP Proxy 运行在 `http://localhost:3457`，所有浏览器操作在后台 tab 执行。
> 数据存储在 `${SKILL_DIR}/data/backlink.db`。

## 操作路由
执行对应操作时，**只加载对应的 reference 文件**：

| 操作 | 触发 | 参考 | 环境依赖 |
|------|------|------|---------|
| PRODUCT | 用户提供产品 URL | `workflow-product.md` | Chrome + CDP |
| IMPORT | 用户提供 CSV/URL 列表 | `workflow-import.md` | Node.js |
| ANALYZE | 用户要求批量分析 | `workflow-analyze.md` | Chrome + CDP |
| SUBMIT | 用户要求提交到站点 | `workflow-submit.md` | Chrome + CDP |

## 数据访问
所有数据通过 `db-ops.mjs` CLI 访问，不直接操作数据库文件。

```bash
# 读取
node "${SKILL_DIR}/scripts/data/db-ops.mjs products
node "${SKILL_DIR}/scripts/data/db-ops.mjs backlinks [status]
node "${SKILL_DIR}/scripts/data/db-ops.mjs sites [productId]
node "${SKILL_DIR}/scripts/data/db-ops.mjs stats

# 写入
node "${SKILL_DIR}/scripts/data/db-ops.mjs add-product '<json>'
node "${SKILL_DIR}/scripts/data/db-ops.mjs update-backlink <id> <status> [json]
node "${SKILL_DIR}/scripts/data/db-ops.mjs add-publishable <id> '<siteJson>'
```

完整命令参考见 `data-formats.md`。

## 行为准则

### 禁止设限
唯一跳过理由：付费墙、站已死（域名过期/404/无响应）、CF 硬封。

### 前端不行先逆向
正常提交失败 → 查源码找隐藏 API → 分析网络请求 → 直接调后端。

### 去重按域名
同域名不同页面视为同一站点。

### 查邮件必须开新标签页
查找邮箱必须 /new 创建新 tab，禁止在分析页面中跳转。

### rel 属性每次实测
不依赖页面声明或他人报告。

### 先读知识库再操作
操作前通过 db-ops.mjs 查询当前状态。

### 切站必须确认产品
切换站点时确认当前活跃产品。

### 邮箱失败立刻切换
自定义域名邮箱失败 → 立即切 Gmail。

### 验证码协作先填完
遇到验证码：先填其他字段，最后处理验证码。

## 错误处理
| 场景 | 处理方式 |
|------|---------|
| CDP Proxy 未启动 | 运行 `check-deps.mjs`，自动启动 |
| Chrome 未开启远程调试 | 提示用户启用 |
| 页面加载超时（>30s） | 标记 `error`，跳过 |
| 数据库操作失败 | 提示用户检查数据库文件 |
| 批量分析中途失败 | 已写回的保留，未分析的保持 `pending` |

## 任务结束
1. 关闭本次任务创建的所有后台 tab
2. 不关闭用户原有 tab
3. CDP Proxy 保持运行
4. 确认数据已正确写入数据库

## References 索引
| 文件 | 何时加载 |
|------|---------|
| `workflow-product.md` | 执行 PRODUCT 操作时 |
| `workflow-import.md` | 执行 IMPORT 操作时 |
| `workflow-analyze.md` | 执行 ANALYZE 操作时 |
| `workflow-submit.md` | 执行 SUBMIT 操作时 |
| `cdp-proxy-api.md` | 需要 CDP API 详细参考时 |
| `data-formats.md` | 操作数据前 |
| `publishability-rules.md` | 分析阶段，判断可发布性 |
| `tool-guide.md` | 选择工具时 |
```

### 2. 声明式 Schema + 自动 CRUD

#### 2.1 db.mjs — 声明式表定义

每个表用一个配置对象定义，包含字段、约束和索引：

```javascript
export const TABLES = {
  products: {
    columns: {
      id:           { type: 'TEXT', pk: true },
      name:         { type: 'TEXT', notNull: true, unique: true },
      url:          { type: 'TEXT', notNull: true },
      tagline:      { type: 'TEXT', notNull: true },
      short_desc:   { type: 'TEXT', notNull: true },
      long_desc:    { type: 'TEXT', notNull: true },
      categories:   { type: 'TEXT', notNull: true, json: true },
      anchor_texts: { type: 'TEXT', notNull: true, json: true },
      logo_url:     { type: 'TEXT' },
      social_links: { type: 'TEXT', json: true },
      founder_name: { type: 'TEXT' },
      founder_email:{ type: 'TEXT' },
      created_at:   { type: 'TEXT', notNull: true },
    },
  },
  backlinks: {
    columns: {
      id:           { type: 'TEXT', pk: true },
      source_url:   { type: 'TEXT', notNull: true, unique: true },
      source_title: { type: 'TEXT' },
      domain:       { type: 'TEXT', notNull: true },
      page_ascore:  { type: 'INTEGER' },
      status:       { type: 'TEXT', notNull: true, check: "'pending','publishable','not_publishable','skipped','error'" },
      analysis:     { type: 'TEXT', json: true },
      added_at:     { type: 'TEXT', notNull: true },
    },
    indexes: [
      { name: 'idx_backlinks_status', columns: ['status'] },
      { name: 'idx_backlinks_domain', columns: ['domain'] },
    ],
  },
  sites: {
    columns: {
      id:             { type: 'TEXT', pk: true },
      domain:         { type: 'TEXT', notNull: true },
      url:            { type: 'TEXT', notNull: true },
      submit_url:     { type: 'TEXT' },
      category:       { type: 'TEXT', notNull: true },
      comment_system: { type: 'TEXT' },
      antispam:       { type: 'TEXT', json: true },
      rel_attribute:  { type: 'TEXT' },
      product_id:     { type: 'TEXT', notNull: true, fk: 'products(id)' },
      pricing:        { type: 'TEXT' },
      monthly_traffic:{ type: 'TEXT' },
      lang:           { type: 'TEXT' },
      dr:             { type: 'INTEGER' },
      notes:          { type: 'TEXT' },
      added_at:       { type: 'TEXT', notNull: true },
    },
    indexes: [
      { name: 'idx_sites_domain', columns: ['domain'] },
      { name: 'idx_sites_product_id', columns: ['product_id'] },
    ],
  },
  submissions: {
    columns: {
      id:           { type: 'TEXT', pk: true },
      site_name:    { type: 'TEXT', notNull: true },
      site_url:     { type: 'TEXT', notNull: true },
      product_id:   { type: 'TEXT', notNull: true, fk: 'products(id)' },
      status:       { type: 'TEXT', notNull: true, check: "'submitted','failed','skipped'" },
      submitted_at: { type: 'TEXT', notNull: true },
      result:       { type: 'TEXT' },
      fields:       { type: 'TEXT', json: true },
    },
    indexes: [
      { name: 'idx_submissions_product_id', columns: ['product_id'] },
      { name: 'idx_submissions_status', columns: ['status'] },
    ],
  },
  site_experience: {
    columns: {
      domain:             { type: 'TEXT', pk: true },
      aliases:            { type: 'TEXT', json: true },
      updated:            { type: 'TEXT', notNull: true },
      submit_type:        { type: 'TEXT' },
      form_framework:     { type: 'TEXT' },
      antispam:           { type: 'TEXT' },
      fill_strategy:      { type: 'TEXT' },
      post_submit_behavior:{ type: 'TEXT' },
      effective_patterns: { type: 'TEXT', json: true },
      known_traps:        { type: 'TEXT', json: true },
    },
  },
};
```

Schema 特性标记：
- `pk: true` — 主键约束
- `unique: true` — 唯一约束
- `notNull: true` — NOT NULL 约束
- `json: true` — 自动 JSON 序列化/反序列化
- `check: '...'` — CHECK 约束
- `fk: 'table(column)'` — 外键约束
- `indexes` — 索引定义

#### 2.2 db-ops.mjs — 通用 CRUD 引擎

从 TABLES 定义自动生成通用 CRUD：

```javascript
// 通用操作（自动从 schema 推导）
function insert(db, table, record)     // 插入，处理 JSON 字段 + camelCase/snake_case
function getById(db, table, id)        // 按 PK 查询
function getBy(db, table, col, val)    // 按任意列查询
function list(db, table, filters)      // 列表查询，支持过滤
function update(db, table, id, data)   // 更新
function upsert(db, table, key, data)  // UPSERT 语义
```

保留手写的复合操作：
- `addPublishableSite(db, backlinkId, site)` — 跨表事务
- `addSubmissionWithExperience(db, submission, experience)` — 跨表事务
- `importCsv(db, filePath)` — CSV 解析 + 批量导入
- `getStats(db)` — 聚合统计

CLI 路由表：
```javascript
const CLI_ROUTES = {
  // 标准读取
  'products':    () => list('products'),
  'product':     (id) => getById('products', id),
  'backlinks':   (status) => list('backlinks', status ? { status } : undefined),
  'sites':       (productId) => list('sites', productId ? { product_id: productId } : undefined),
  'site':        (domain) => getBy('sites', 'domain', domain),
  'submissions': (productId) => list('submissions', { product_id: productId }),
  'experience':  (domain) => getBy('site_experience', 'domain', domain),
  'stats':       () => getStats(),
  // 标准写入
  'add-product': (json) => insert('products', JSON.parse(json)),
  'update-backlink': (id, status, analysis) => updateBacklink(id, status, analysis),
  // 复合操作
  'add-publishable': (id, siteJson) => addPublishableSite(id, JSON.parse(siteJson)),
  'add-submission': (subJson, expJson) => addSubmissionWithExperience(JSON.parse(subJson), JSON.parse(expJson)),
  'upsert-experience': (domain, json) => upsert('site_experience', 'domain', domain, JSON.parse(json)),
};
```

#### 2.3 新增表的成本

只需在 `db.mjs` 的 `TABLES` 中添加一个配置对象，自动获得：
- 建表 SQL
- INSERT / GET / LIST / UPDATE 操作
- JSON 字段自动序列化/反序列化
- camelCase ↔ snake_case 自动转换
- CLI 读取命令（需在路由表注册一行）

### 3. 脚本目录分层

```
scripts/
  data/           # 纯数据处理，不依赖浏览器
    db.mjs
    db-ops.mjs
    db.test.mjs
    import-csv.mjs
  browser/        # 与 CDP Proxy 交互的服务端脚本
    cdp-proxy.mjs
    check-deps.mjs
    page-extractor.mjs
    product-generator.mjs
  injection/      # 零依赖的浏览器注入脚本
    form-analyzer.js
    form-filler.js
    detect-comment-form.js
    detect-antispam.js
    honeypot-detector.js
    comment-expander.js
```

**路径迁移映射**：

| 旧路径 | 新路径 |
|--------|--------|
| scripts/db.mjs | scripts/data/db.mjs |
| scripts/db-ops.mjs | scripts/data/db-ops.mjs |
| scripts/db.test.mjs | scripts/data/db.test.mjs |
| scripts/import-csv.mjs | scripts/data/import-csv.mjs |
| scripts/cdp-proxy.mjs | scripts/browser/cdp-proxy.mjs |
| scripts/check-deps.mjs | scripts/browser/check-deps.mjs |
| scripts/page-extractor.mjs | scripts/browser/page-extractor.mjs |
| scripts/product-generator.mjs | scripts/browser/product-generator.mjs |
| scripts/form-analyzer.js | scripts/injection/form-analyzer.js |
| scripts/form-filler.js | scripts/injection/form-filler.js |
| scripts/detect-comment-form.js | scripts/injection/detect-comment-form.js |
| scripts/detect-antispam.js | scripts/injection/detect-antispam.js |
| scripts/honeypot-detector.js | scripts/injection/honeypot-detector.js |
| scripts/comment-expander.js | scripts/injection/comment-expander.js |

**受影响的引用**：SKILL.md、所有 workflow references、db.test.mjs、check-deps.mjs、package.json 中的路径。

### 4. References 修复与优化

#### 4.1 workflow-product.md

**修复**：Step 4 从"读取 products.json + Write 工具写回"改为：
```bash
node "${SKILL_DIR}/scripts/data/db-ops.mjs add-product '<productJSON>'
```

**更新**：所有 `${SKILL_DIR}/scripts/` 路径更新为分层后的路径。

#### 4.2 workflow-analyze.md

**优化**：合并"快速判定"和"Claude 综合判定"为一个决策树：

```
检测结果
  ├─ bypassable=false 的反垃圾 → not_publishable
  ├─ bypassable=depends_on_config → not_publishable（保守）
  ├─ 无评论表单信号 → not_publishable
  ├─ 原生评论 + textarea + 无硬封 → publishable
  └─ 模糊信号 → Claude 综合判定（加载 publishability-rules.md）
```

**并入**：并行分析策略从 SKILL.md 移入此文件。

#### 4.3 workflow-submit.md

**并入**：串行提交策略和站点经验系统从 SKILL.md 移入此文件。

**优化**：合并注入脚本调用示例为一个统一的"注入脚本速查"块。

#### 4.4 data-formats.md

**更新**：反映新的目录结构路径和 CLI 命令格式。

#### 4.5 新增 tool-guide.md

从 SKILL.md 提取的工具选择决策矩阵，作为独立参考。

### 5. 不变的部分

- 所有注入脚本（`.js`）的代码逻辑不变
- `cdp-proxy.mjs` 的 API 和逻辑不变
- `import-csv.mjs` 的解析逻辑不变
- 数据库 schema（表结构）不变
- 数据库数据文件不变

### 6. 测试策略

- `db.test.mjs` 适配新 schema 定义和新的 CRUD API
- 保持现有测试覆盖范围
- 新增声明式 schema 的建表测试

### 7. 实施顺序

1. 创建目录结构（data/browser/injection）
2. 重写 `db.mjs`（声明式 schema）
3. 重写 `db-ops.mjs`（通用 CRUD 引擎）
4. 移动脚本文件到新目录
5. 更新 `db.test.mjs`
6. 重写 `SKILL.md`
7. 更新所有 references 文件
8. 运行测试确认通过
9. 运行 `npm run build` 确认无报错
