# backlink-agent 架构升级设计文档

> 借鉴 web-access skill 的设计理念和架构模式，对 backlink-agent 进行全面架构升级。
> 两个 skill 保持完全独立，不产生任何依赖关系。

## 设计目标

将 web-access 的四大设计模式移植到 backlink-agent：
1. "原则+参考"的 SKILL.md 架构（目标驱动，非步骤驱动）
2. CDP 代理 API 风格对齐（保持独立端口）
3. 站点经验系统（JSON 格式，仅用于提交阶段）
4. 子 agent 并行提交策略

---

## 1. SKILL.md 重构

### 现状

- 702 行程序化手册
- 包含 10 条"铁律"、详细步骤、数据格式定义
- 所有内容集中在一个文件中

### 目标

对标 web-access 的 "原则 + 参考" 架构。SKILL.md 从"操作手册"变为"决策框架"。

### 新结构

```
SKILL.md (~250 行)
├── 前言（元数据、触发条件、预检查）
├── 核心理念
│   ├── 外链工作的 4 阶段框架
│   │   1. 定义目标（要提交什么产品、什么类型的站点）
│   │   2. 选择策略（根据站点类型和已有经验选择工具组合）
│   │   3. 验证调整（每步验证结果，失败则调整策略）
│   │   4. 确认完成（对照原始目标检查提交结果）
│   └── 最小侵入原则（后台标签页、完成后关闭）
├── 工具选择决策矩阵
│   ├── CDP /eval → 需要页面上下文交互（表单检测、填充、点击）
│   ├── page-extractor.mjs → 需要提取页面正文文本供分析
│   ├── form-filler.js → 需要兼容 React/Vue 的表单填充
│   ├── curl/Jina → 辅助信息获取（产品页面、元数据）
│   └── sheets-sync.mjs → Google Sheets 同步
├── 外链工作流概览
│   IMPORT → ANALYZE → SUBMIT → SYNC
│   （仅展示数据流图，具体步骤见 references/）
├── 站点经验系统说明
│   ├── 提交前检查 data/site-experience.json
│   ├── 有经验则据此调整策略
│   ├── 无经验则正常流程，完成后记录
│   └── 经验过时则更新
├── 并行提交策略
│   └── 详见下文第 4 节
└── 参考文件索引
    ├── references/cdp-proxy-api.md
    ├── references/data-formats.md
    ├── references/publishability-rules.md
    ├── references/workflow-import.md
    ├── references/workflow-analyze.md
    ├── references/workflow-submit.md
    └── references/workflow-sync.md
```

### 新增的 references/ 文件

从 SKILL.md 中拆分出来的详细流程文档：

| 文件 | 内容 | 从 SKILL.md 的哪部分拆出 |
|------|------|--------------------------|
| `workflow-import.md` | Semrush CSV 导入流程、URL 格式、去重规则 | 现有导入章节 |
| `workflow-analyze.md` | 可发布性分析流程、CDP 扫描脚本使用、判断标准 | 现有分析章节 + publishability-rules.md |
| `workflow-submit.md` | 目录提交和博客评论的表单填充流程、注入脚本使用 | 现有提交章节 |
| `workflow-sync.md` | Google Sheets 同步配置和操作流程 | 现有同步章节 |

### 设计原则

- SKILL.md 只教"怎么想"，不教"怎么做"
- 具体操作步骤移入 `references/workflow-*.md`
- 按需加载：只有进入某阶段时才读取对应参考

---

## 2. CDP 代理架构对齐

### 现状

- `cdp-proxy.mjs`（614 行），端口 3457
- 与 web-access 的代理（端口 3456）功能高度重叠
- API 端点命名和行为有差异

### 目标

保持完全独立，但 API 风格和行为模式与 web-access 对齐。

### 关键改进

#### 2.1 API 端点对齐

确保以下端点的命名、参数、返回格式与 web-access 一致：

| 端点 | 方法 | 用途 | 对齐要求 |
|------|------|------|----------|
| `/health` | GET | 连接状态 | 统一返回格式 |
| `/targets` | GET | 列出标签页 | 统一返回格式 |
| `/new?url=` | GET | 创建后台标签页 | 自动等待加载 |
| `/close?target=` | GET | 关闭标签页 | - |
| `/navigate?target=&url=` | GET | 导航 | 自动等待加载 |
| `/back?target=` | GET | 后退 | 自动等待加载 |
| `/info?target=` | GET | 页面信息 | 统一返回格式 |
| `/eval?target=` | POST | 执行 JS | - |
| `/click?target=` | POST | JS 点击 | - |
| `/clickAt?target=` | POST | CDP 鼠标事件 | - |
| `/setFiles?target=` | POST | 文件输入 | - |
| `/scroll?target=&y=&direction=` | GET | 滚动 | 含懒加载等待 |
| `/screenshot?target=&file=` | GET | 截图 | - |

backlink-agent 专有的额外端点保持不变。

#### 2.2 反检测统一

复用 web-access 的端口保护模式：
- 在 session 创建时自动 `Fetch.enable`
- 拦截页面到 `http://127.0.0.1:{chromePort}/*` 的请求
- 返回 `ConnectionRefused`

#### 2.3 连接发现机制

统一使用 web-access 的优先链：
1. 读取 `DevToolsActivePort` 文件（macOS/Linux/Windows 路径）
2. 回退到端口扫描（9222/9229/9333）

#### 2.4 不做的事

- 不检测 web-access 代理是否运行
- 不共享会话或状态
- 不引入对 web-access 的任何 import/reference
- 保持端口 3457 独立

---

## 3. 站点经验系统

### 设计

使用单个 JSON 文件存储所有站点的提交经验。

### 文件位置

```
data/site-experience.json
```

### 数据格式

```json
{
  "example-directory.com": {
    "domain": "example-directory.com",
    "aliases": ["example dir", "example提交"],
    "updated": "2026-04-16",
    "submitType": "directory",
    "formFramework": "native",
    "antispam": "none",
    "fillStrategy": "direct",
    "postSubmitBehavior": "redirect",
    "effectivePatterns": [
      "直接 fill 即可，无特殊处理",
      "提交按钮在表单底部，需要滚动到底部"
    ],
    "knownTraps": [
      "提交按钮有延迟加载，需要等待 2 秒"
    ]
  },
  "some-blog.com": {
    "domain": "some-blog.com",
    "aliases": [],
    "updated": "2026-04-16",
    "submitType": "blog-comment",
    "formFramework": "wordpress",
    "antispam": "akismet",
    "fillStrategy": "execCommand",
    "postSubmitBehavior": "moderation-notice",
    "effectivePatterns": [
      "使用 execCommand 填充评论框，React setter 对 wp 不生效",
      "评论需 80+ 字符才不会被 Akismet 标记"
    ],
    "knownTraps": [
      "wpDiscuz 评论区默认折叠，需先运行 comment-expander.js"
    ]
  }
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `domain` | string | 站点域名（同时也是 JSON key） |
| `aliases` | string[] | 域名别名或简称 |
| `updated` | string | 最后更新日期 (YYYY-MM-DD) |
| `submitType` | "directory" \| "blog-comment" | 提交类型 |
| `formFramework` | string | 表单技术栈 (native/react/vue/wordpress) |
| `antispam` | string | 反垃圾系统 (none/akismet/hcaptcha/etc) |
| `fillStrategy` | string | 填充策略 (direct/execCommand/reactSetter) |
| `postSubmitBehavior` | string | 提交后行为 (redirect/success-message/moderation-notice/silent) |
| `effectivePatterns` | string[] | 已验证有效的操作策略 |
| `knownTraps` | string[] | 已知的陷阱和注意事项 |

### 使用流程

1. **提交前**：读取 `data/site-experience.json`，查找目标域名
2. **有经验**：根据 `fillStrategy`、`effectivePatterns` 调整操作，避开 `knownTraps`
3. **无经验**：正常流程，完成后在 `effectivePatterns` 和 `knownTraps` 中记录新经验
4. **经验过时**：策略失败时更新对应条目（更新 `updated` 日期和失败信息）

### 边界

- **仅用于提交阶段**：分析外链是否可入库的过程不读写此文件
- **经验是提示，不是保证**：站点可能更新，经验可能过时，需要验证
- **查询方式**：Claude 直接用 Read 读取 JSON，也可通过脚本提取：
  ```bash
  node -e "console.log(JSON.parse(require('fs').readFileSync('data/site-experience.json')).['example.com'])"
  ```

---

## 4. 并行提交策略

### 设计

借鉴 web-access 的子 agent 并行模式，多个外链提交可以同时进行。

### 何时并行

- 当有 **3+ 个可提交站点**时，启动并行模式
- 分析阶段**不并行**（需要 Claude 深度判断）
- 提交阶段可以并行（操作相对机械化）

### 并行规则

1. **最多 3 个并行 agent**（避免 Chrome 资源耗尽）
2. 每个 agent 各自创建独立标签页（`/new`），通过 `targetId` 识别
3. 每个 agent 操作独立的 targetId，互不干扰
4. 标签页是天然隔离的，不存在竞态条件

### 子 Agent prompt 模板

```
在 {domain} 提交产品 {productName}。

站点信息：{从 sites.json 提取的站点数据}
产品信息：{从 products.json 提取的产品数据}
站点经验：{从 site-experience.json 提取的经验，如有}

要求：
- 必须加载 backlink-agent skill 并遵循指引
- 提交完成后截图确认
- 将结果写入 submissions.json
```

### 结果收集

- 每个子 agent 完成后**汇报结果给主 agent**，由主 agent 统一写入 `submissions.json`
- 这样避免多个 agent 同时写同一文件的冲突问题
- 主 agent 在所有子 agent 完成后，汇总结果一次性写入

### 限制

- 不在分析阶段并行
- 每个代理只操作自己创建的标签页
- 如果 Chrome 内存不足，减少并行数

---

## 改造影响范围

### 新增文件

| 文件 | 说明 |
|------|------|
| `references/workflow-import.md` | 导入流程详解 |
| `references/workflow-analyze.md` | 分析流程详解 |
| `references/workflow-submit.md` | 提交流程详解 |
| `references/workflow-sync.md` | 同步流程详解 |
| `data/site-experience.json` | 站点经验（初始为 `{}`） |

### 修改文件

| 文件 | 改动 |
|------|------|
| `SKILL.md` | 全面重构：702 行 → ~250 行，改为决策框架 |
| `scripts/cdp-proxy.mjs` | API 对齐：端点命名、返回格式、反检测、连接发现 |
| `scripts/check-deps.mjs` | 适配代理改动 |
| `references/cdp-proxy-api.md` | 更新端点文档以反映 API 变更 |

### 不变的文件

| 文件 | 原因 |
|------|------|
| `scripts/import-csv.mjs` | 导入逻辑不变 |
| `scripts/page-extractor.mjs` | 提取逻辑不变 |
| `scripts/product-generator.mjs` | 生成逻辑不变 |
| `scripts/sheets-sync.mjs` | 同步逻辑不变 |
| 所有浏览器注入脚本 | 注入脚本在页面上下文运行，与架构无关 |
| `references/data-formats.md` | 格式定义不变 |
| `references/publishability-rules.md` | 判断规则不变 |
| `data/products.json` | 数据不变 |
| `data/backlinks.json` | 数据不变 |
| `data/sites.json` | 数据不变 |
| `data/submissions.json` | 数据不变 |

---

## 验收标准

1. SKILL.md 从 702 行缩减到 ~250 行，内容转为决策框架风格
2. 四个 workflow 参考文件包含拆分出的详细步骤
3. CDP 代理 API 端点与 web-access 风格一致
4. `data/site-experience.json` 存在且格式正确（初始为空对象）
5. SKILL.md 包含站点经验系统说明和并行提交指引
6. 删除 web-access skill 后 backlink-agent 功能不受影响
7. 现有测试全部通过
