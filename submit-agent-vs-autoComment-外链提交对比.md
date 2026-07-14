# submit-agent vs autoComment — 外链提交场景优劣分析

> 对比对象：
> - **submit-agent**（当前项目）：`/Users/fuqian/Documents/CODE/浏览器插件/submit-agent`，WXT + React 19 + TS 浏览器扩展，MIT 开源，无后端。
> - **autoComment**：`/Users/fuqian/Documents/CODE/浏览器插件/autoComment`，原生 JS 插件 + Express/MySQL 后端，商业 SaaS（积分 + 支付宝）。
>
> 分析日期：2026-07-13
> 聚焦场景：**提交外链**全流程（目录提交、博客评论、批量填充）。
> 信息来源：两个项目源码静态分析（含 content/background、表单识别、LLM、存储、测试）。

---

## 0. 项目概览

| 维度 | submit-agent | autoComment |
|---|---|---|
| 技术栈 | WXT + React 19 + TS + Vitest + Tailwind v4 | 原生 JS 插件 + Express/MySQL 后端 |
| 形态 | 纯浏览器插件（MV3），**无后端** | 插件 + **SaaS 后端**（积分/支付宝/CSV 导出） |
| 代码规模 | ~13k 行 TS/TSX | ~12k 行 JS（含后端） |
| manifest 自我定位 | "Submit Agent" — AI 产品提交外链 | "Auto Register Filler" — 自动填**注册表单**+生成推广文案 |
| content script 匹配 | 浮动按钮触发，sidepanel 编排 | `<all_urls>` 全站注入，权限仅 `activeTab`+`storage` |
| 商业模式 | 开源 MIT，本地优先，用户自带 LLM key | 付费 SaaS（积分扣费 + 支付宝），受邀制 userId |
| 测试 | 10 个测试文件（DOM、表单、评论系统、prompt） | 仅 payment.test.js，表单逻辑无单测 |
| 后端地址 | 无 | 全部硬编码 `https://jieyunsang.cn/api` |

---

## 1. 架构哲学：填表智能放在哪一层

这是理解两个项目一切差异的钥匙。

| | submit-agent | autoComment |
|---|---|---|
| 字段**识别/定位** | 规则引擎（7 步标签级联 + 蜜罐 + 分类 + 去重）→ 给字段生成 `canonical_id` | 规则引擎（写死选择器 + 多语种关键词 `.includes()`） |
| 字段**取值** | **LLM 决定**（产品字段→canonical_id 映射、语言匹配、锚文本、随机化） | **写死规则**（name/email/url 固定映射） |
| **评论文案** | LLM 生成（100-300 字、HTML 锚标签、强制页面语言） | LLM 生成（Qwen，文案夹带外链） |
| LLM 看到的输入 | 结构化、去重、带标签的字段列表（**不看原始 HTML**） | 不参与字段层 |

**关键差异**：

- submit-agent 的 LLM 永远拿不到原始 HTML，只能往已识别的 `canonical_id` 填值；匹配不上就**中止报错**（宁可不填，不错填）。
- autoComment 的 LLM 连字段层都不碰，只负责产出评论文案；表单识别与字段填充 100% 由 content.js 里的规则完成。

---

## 2. 提交外链核心流程

### 2.1 submit-agent（交互式，人在回路）

跨三个执行上下文：content script → background service worker → sidepanel React app。

1. **浮动按钮触发**（`FloatButton.content.ts:576`）：发 `{type:'FLOAT_FILL', action:'start'}`，带 MV3 service-worker 唤醒重试。初始化时 `CHECK_SITE_MATCH` 查询 background，三态显示（已知站点/未知站点"+"）。
2. **Background 编排**（`background.ts:214`）：`handleFloatFill()` 存 `floatFillTabId` 到 `chrome.storage.session`，`chrome.sidePanel.open({tabId})` 打开 sidepanel。
3. **Sidepanel 编排**（`useFloatFill.ts` → `useFormFillEngine.ts:67`）：`matchCurrentPage` 匹配站点；未匹配走用户确认流；匹配后 `startSubmission(site)`，从 `site.category === 'blog_comment'` 推导 `siteType`。
4. **填充引擎**（`FormFillEngine.ts:140`，单次 LLM 调用设计）：
   - analyze：content script 返回 `FormAnalysisResult`（评论场景含 `pageContent`）；
   - LLM 调用：`buildBlogCommentPrompt` / `buildDirectorySubmitPrompt` + `callLLM`（JSON 模式）；
   - 解析映射：`parseLLMJson` → `canonical_id` 精确匹配 → `fuzzyMatchField`（Jaccard ≥0.5）兜底；
   - 填充：逐字段发 `FLOAT_FILL action:fill`，带视觉注释。
5. **Content script 执行**（`content.ts`）：`analyze` 处理 SPA 等待 + wpDiscuz 展开 + Blogger 跨 iframe `postMessage`；`fill` 处理通过 `dom-utils.ts:fillAndVerify`。

### 2.2 autoComment（批量，无人值守）

content.js（全站注入）+ background.js（轻量 service worker）+ batch.js（批量调度器）。

1. **批量调度**（`batch.js:655`）：上传 URL 列表 → **串行**开标签页（一次一个 tab）→ PING 探活 → 发 `BATCH_HANDLE`。
2. **单页处理**（`content.js:3875` `handleBatchTask`）：
   - `waitForPageReady` → 违法站点拦截 → 去重检查；
   - `findCommentForm` + `findLikelyCommentTextarea` 找评论框（多策略展开）；
   - **找到框后**才调 Qwen 生成文案（避免无框浪费积分）；
   - `ensureAllCommentFormFieldsFilled` 填 name/email/website/comment；
   - 先 `writePendingResult` + `sendBeaconReport` 落盘，再 `clickCommentSubmitButton`；
   - `BATCH_HANDLE_CONFIRM` 通知 background 二次持久化（提交后页面可能刷新，content context 丢失，background 仍存活兜底）。
3. **表单识别**（纯规则，`content.js:1394` `findLikelyCommentTextarea`，400+ 行）：
   - WordPress 原生（`form#commentform`、`wp-comments-post.php`）；
   - wpDiscuz contenteditable div（代理对象）；
   - 标准选择器列表 + 多语种关键词匹配（英/中/西/葡/泰）；
   - 四套兜底（选择器→textarea 反查→评论容器→全表单关键词）。

---

## 3. 按目标环境逐项对比（核心）

### 环境 A：已知目录/平台提交（G2、SourceForge、Crunchbase、AI 导航站）

- **submit-agent：✅ 强势主场**。`sites.json` 内置 375 个站点（311 alive，带 DR/流量/语种/价格），`directory_submit` prompt（temperature 0.3，用产品名）。浮动按钮三态匹配，命中即一键填充。
- **autoComment：❌ 基本不覆盖**。无目录站点清单，prompt 只有评论场景。填注册表单（name/email/username/password）是为评论账号注册服务的，不是产品提交。

**判定**：目录提交场景 **submit-agent 完胜**，autoComment 不是为这个设计的。

---

### 环境 B：WordPress 原生博客评论

- **submit-agent：✅ 支持**。`comment-system-detector` + `wp-comments-post` action 检测，`blog_comment` prompt（创始人名、锚文本、页面语言）。
- **autoComment：✅✅ 更专精**。`findNativeWordPressCommentForm` 直接锁定 `#commentform`，`#author`/`input[name=author]` 等 WP 标准字段名起步，识别命中率极高，且不调 LLM 识别字段。

**判定**：两者都行。**autoComment 在"纯 WP 站点池"更省 token、更稳**；submit-agent 更"重"但单条评论质量更高（语言匹配 + 锚文本）。

---

### 环境 C：现代评论系统（Disqus / Giscus / Utterances / Facebook / Blogger / wpDiscuz）

| 评论系统 | submit-agent | autoComment |
|---|---|---|
| Disqus | ✅ 检测 + 展开等待 | ✅ 检测 + 点展开 + 等 5s |
| **Giscus** | ✅ 检测 | ❌ 未见 |
| **Utterances** | ✅ 检测 | ❌ 未见 |
| **Facebook** | ✅ 检测 | ❌ 未见 |
| **Blogger**（跨域 iframe）| ✅ **postMessage 协议**（`all_frames` 注入 iframe 上下文响应 REQUEST/FILL） | ❌ 未见跨域 iframe 处理 |
| **wpDiscuz** 懒加载 | ✅ 注入页面 JS 触发 jQuery + MutationObserver 等 800ms | ✅ contenteditable 代理对象 |

**判定**：评论系统**广度和深度 submit-agent 明显领先**（5 种检测器 + Blogger 跨域 iframe 协议 + wpDiscuz 注入触发）。autoComment 胜在 WP/wpDiscuz/Disqus 这几个高频项的工程成熟度。

---

### 环境 D：完全陌生的非主流网站（自定义 React 表单 / 非主流命名 / 隐藏字段）

真正考验"泛化"的环境。

- **submit-agent：🟡 混合策略，鲁棒但有上限**
  - 强项：蜜罐检测（8 信号：`aria-hidden`、`_wpcf7`/哈希名、`font-size:0`…）、表单分类（过滤搜索/登录/订阅，处理 Jetpack `subscribe_comments` 干扰）、字段去重、唯一选择器生成、`fuzzyMatchField` 兜底。
  - 弱项：依赖 7 步标签级联找到有意义标签；React 复杂包装/图标+稀疏文本的站点，标签可能为空，退到 `inferred_purpose` 关键词推断就脆了。但**失败时中止而非乱填**。
- **autoComment：🟡 纯启发式，找不到就放弃**
  - 强项：多语种关键词词典（英/中/西 `comentario`/葡 `comentário`/泰 `ความคิดเห็น`）"广撒网"，对多语种博客命中率高。
  - 弱项：找不到评论框直接 `__NO_COMMENT_BOX__` 放弃关 tab；无蜜罐意识、无字段去重、无质量门禁——但因为是纯评论场景，乱填的风险面比通用表单小。

**判定**：陌生站点上 **submit-agent 更鲁棒**（有质量门禁、宁错杀不乱填），**autoComment 更"敢填"但更糙**。两者遇到严重非主流实现都会失败。

---

### 环境 E：批量 / 无人值守

- **submit-agent：❌ 不擅长**。设计是浮动按钮 + sidepanel 的**交互式单站填充**，人在回路。有"分析并发数"设置但那是反链分析，不是批量提交。
- **autoComment：✅✅ 核心卖点**。`batch.js` 串行调度（一次一个 tab，PING→BATCH_HANDLE→BATCH_CONFIRMED→关 tab→下一个），background.js 兜底防刷新丢上下文，本地 `chrome.storage.local` 汇总 + 上报云端统计。带进度条/分类计数/导出。

**判定**：**批量无人值守 autoComment 完胜**，submit-agent 根本没有这个工作流。

---

### 环境 F：多语种目标站

- **autoComment：✅ 更直接**。关键词词典硬编码 5 语种，命中即识别。
- **submit-agent：✅ 更"高级"**。靠 LLM 做语言匹配（评论 prompt 强制"必须匹配页面内容语言" + 锚文本翻译规则），代价是每条都过 LLM。

**判定**：**autoComment 便宜、submit-agent 质量高**。批量发多语种农场选 autoComment；追求评论自然度选 submit-agent。

---

### 环境 G：账号安全 / 风控 / 合规

- **submit-agent：✅ 更安全**。蜜罐字段主动跳过、表单分类过滤无关表单、模糊匹配防错填。账号风险低。
- **autoComment：⚠️ 风控压力更大**。无蜜罐意识，靠 `illegal-site-filter`（色情/赌博拦截）+ 服务端敏感词（命中退积分）做内容侧合规，但**自动化批量评论本身就是灰色**：违反多数博客 ToS、可能触发搜索引擎反垃圾、Chrome 商店"自动化交互"条款风险。content script `<all_urls>` 全站注入但只声明 `activeTab`+`storage`，权限声明偏窄。

**判定**：合规与账号安全 **submit-agent 占优**；autoComment 的批量属性决定了它必然承担更高的封号/法律/平台政策风险。

---

## 4. 提交外链全链路对比表

| 环节 | submit-agent | autoComment |
|---|---|---|
| 触发 | 浮动按钮→sidepanel（交互式） | batch 工作台批量开 tab（无人值守） |
| 站点匹配 | `sites.json` 375 站 + 运行时发现博客 | 无清单，全站注入 + 违禁过滤 |
| 表单识别 | 7 步标签级联 + 分类 + 去重 + 蜜罐 | 写死选择器 + 多语种关键词 |
| 评论系统 | 5 种 + Blogger 跨域 iframe 协议 | WP/wpDiscuz/Disqus/wpcf7 |
| 填什么值 | **LLM 决定**（语言/锚文本/随机化） | **规则决定**（固定字段映射） |
| 评论文案 | LLM（OpenAI 兼容，用户自带 key） | LLM（Qwen，走自家后端，1 次/积分） |
| 失败处理 | 中止报错，不乱填 | `no_comment_box` 放弃关 tab |
| 质量门禁 | 蜜罐/去重/模糊匹配/测试 10 套 | 违禁过滤/敏感词/退积分，表单逻辑无单测 |
| 数据存放 | 本地 IndexedDB + Google Sheets 同步 | 云端 MySQL（积分/订单）+ 本地 storage（批次明细） |
| 商业模式 | 开源 MIT，无后端 | SaaS（积分+支付宝），受邀制 userId |
| LLM 成本归谁 | 用户（自带 key） | 平台（含在积分里） |

---

## 5. 各自的硬伤

### submit-agent 的硬伤

1. **不能批量无人值守**——每个站点都要人点浮动按钮确认。
2. **每站一次 LLM 调用**，目录站成百上千时 token 成本和时延显著。
3. 陌生站点依赖标签级联，React/复杂包装站点仍可能识别不准（但有质量门禁兜底）。

### autoComment 的硬伤

1. **业务灰色**：批量自动评论外链违反多数博客 ToS，平台政策与法律风险高，商店审核可能被拒。
2. **泛化差**：纯规则识别，遇非主流评论系统直接放弃；无蜜罐意识，可能误填风控字段。
3. **强绑定单一后端**（`jieyunsang.cn` 硬编码），后端挂了插件即废；服务端 user_id 受邀制，不可私有化部署。
4. 表单识别逻辑**零单元测试**覆盖。

---

## 6. 关键代码位置速查

### submit-agent

| 模块 | 位置 |
|---|---|
| Content script 入口 + iframe/评论处理 | `extension/src/entrypoints/content.ts` |
| 浮动按钮 UI | `extension/src/agent/FloatButton.content.ts` |
| Background 枢纽 | `extension/src/entrypoints/background.ts` |
| 填充引擎（LLM 编排） | `extension/src/agent/FormFillEngine.ts` |
| 表单分析器 | `extension/src/agent/form-analyzer/`（classifier / scanner / field-resolver / comment-system-detector / comment-links） |
| Hooks | `extension/src/hooks/`（useFormFillEngine / useFloatFill / useBacklinkAnalysis） |
| Prompts | `extension/src/agent/prompts/`（blog-comment / directory-submit / product-context） |
| LLM 调用 | `extension/src/agent/llm-utils.ts` |
| 数据层 | `extension/src/lib/`（db / storage / backlinks / sites / backlink-analyzer） |
| Sheets 同步 | `extension/src/lib/sync/sheets-client.ts` |

### autoComment

| 模块 | 位置 |
|---|---|
| 表单识别入口 | `content.js:1394`、`content.js:1884` |
| 批量任务主流程 | `content.js:3875` |
| LLM 文案生成 | `content.js:3059` + `api/generate-copy.js:149` |
| 积分扣减 | `api/generate-copy.js:95`（每次 1 分） |
| 批量调度 | `batch.js:655` |
| 消息中转 | `background.js:46` |
| 违法过滤 | `illegal-site-filter.js:165` |
| 敏感词 | `api/blocked-keywords.js:53` |
| 权限声明 | `manifest.json:6-14`、`23-29` |

---

## 7. 结论与建议

按使用意图分场景选：

- **要做"AI 产品提交到目录站 + 高质量博客评论"，追求可控、合规、评论自然度** → **submit-agent**。它的混合智能（规则管结构、LLM 管取值）和质量门禁是正确工程方向，蜜罐防护也保护账号。
- **要做"大量博客农场批量铺外链、要计费变现"** → **autoComment** 的批量调度 + SaaS 后端是现成的，但要接受合规与封号风险。

### 融合方向（最有价值）

把 autoComment 的**批量调度工作流**（串行 tab + background 兜底持久化 + 进度面板）搬到 submit-agent 的**混合智能填充引擎**之上——既拿到批量能力，又保留 submit-agent 的识别鲁棒性和账号安全。

反向迁移（把 submit-agent 的智能塞进 autoComment）意义不大：autoComment 的规则识别在纯 WP 农场里已经够用且更便宜。
