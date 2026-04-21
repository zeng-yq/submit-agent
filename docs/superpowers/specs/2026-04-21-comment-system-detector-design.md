# 评论系统检测器设计

## 目标

在外链分析流程中增加对主流第三方评论系统（Disqus、Giscus、Utterances、Facebook Comments）的检测，检测结果作为 canComment 判断和置信度评分的信号。实现需易于扩展，未来新增系统只需往注册表添加一项。

## 背景

当前仅检测 WordPress 原生评论（通过表单 action）和 wpDiscuz（通过 content script 惰性展开）。Disqus 等基于 JS/iframe 的第三方系统完全无法识别。

外链分析流程：background 脚本打开目标页面标签 → content script 执行 `analyzeForms(document)` → 结果通过消息传回 `backlink-analyzer.ts` → 计算 canComment 和 confidence。

由于页面在真实浏览器标签中渲染，JS 评论系统的 DOM 元素会正常加载，因此检测在 content script 中执行。

## 方案

### 新增文件

`extension/src/agent/form-analyzer/comment-system-detector.ts`

注册式检测器，每个评论系统定义为：

```ts
interface CommentSystemDetector {
  name: string
  selectors: string[]
  boost: number  // 置信度贡献
}
```

检测逻辑：遍历注册表，用 `document.querySelector` 依次匹配选择器，返回第一个命中的系统信息。如果多个系统命中，返回优先级最高的（按数组顺序）。

**检测选择器：**

| 系统 | 选择器 | 说明 |
|---|---|---|
| Disqus | `#disqus_thread`, `iframe[src*="disqus.com"]` | 容器 div 或嵌入 iframe |
| Giscus | `giscus-widget`, `iframe[src*="giscus.app"]` | 自定义元素或 iframe |
| Utterances | `iframe[src*="utteranc.es"]` | 嵌入 iframe |
| Facebook Comments | `.fb-comments`, `iframe[src*="facebook.com/plugins/comments"]` | 社交插件 |

### 数据流变更

1. `form-analyzer/types.ts` — `FormAnalysisResult` 新增 `commentSystem?: CommentSystemResult`
2. `form-analyzer/comment-system-detector.ts` — 检测逻辑 + 注册表
3. `form-analyzer/index.ts` — `analyzeForms()` 中调用检测器
4. `lib/types.ts` — `BacklinkAnalysisResult` 新增 `commentSystem?: string`
5. `lib/backlink-analyzer.ts` — 从 `FormAnalysisResult` 读取检测结果，参与置信度计算

### 置信度调整

| 信号 | 变化 |
|---|---|
| 检测到第三方评论系统 | +0.20 |
| 已有 CMS 类型检测（WordPress 等） | +0.15（不变） |

第三方评论系统的存在本身就是强信号——页面明确支持评论。0.20 与 WordPress CMS 的 0.15 略高，因为第三方评论系统比 CMS 检测更具确定性。

### 扩展方式

新增系统只需在 `COMMENT_SYSTEM_DETECTORS` 数组中添加一项：

```ts
{
  name: 'newsystem',
  selectors: ['#newsystem-container', 'iframe[src*="newsystem.com"]'],
  boost: 0.20,
}
```

无需修改任何其他文件（类型、评分逻辑自动适配）。

## 不包含

- 不实现自动填写第三方评论系统表单（iframe 跨域限制）
- 不检测评论系统是否开放/关闭评论
- 不处理 Blogger/Discuz 检测（保留现有 cmsType 占位）
