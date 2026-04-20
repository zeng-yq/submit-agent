# 信心度计算重构设计

## 背景

当前外链分析中信心度（confidence）的计算存在两个主要问题：

1. **canComment=false 时信心度恒为 0.3**：不可发布的页面也有 30% 信心度，语义上有误导性
2. **缺少负信号**：联系表单的 message 字段会被误判为评论字段，导致误报

信心度的语义定位：**衡量页面是否是评论页的确定程度**。

## 改动范围

仅修改 `extension/src/lib/backlink-analyzer.ts` 一个文件。

## 设计细节

### 1. 新增字段检测

在现有 commentFields/urlFields/textareaFields/emailFields 基础上，新增两组检测：

- **authorFields**：匹配字段名含 `author`/`name`/`nickname`
- **contactSignals**：检测未过滤表单的 action 含 `/contact`/`/support`/`/help`

复用现有的关键词匹配模式。

### 2. 信心度评分规则

基础分从 0.0 开始，通过正负信号累加：

| 信号 | 分值 | 条件 |
|------|------|------|
| 有未过滤表单 | +0.2 | `unfilteredForms.length > 0` |
| 有 textarea | +0.15 | `textareaFields.length > 0` |
| 有 comment/reply 命名字段 | +0.2 | `commentFields.length > 0` |
| 有 URL/website 字段 | +0.2 | `urlFields.length > 0` |
| 有 email 字段 | +0.05 | `emailFields.length > 0` |
| 有 author/name 字段 | +0.1 | `authorFields.length > 0` |
| CMS 已识别 | +0.15 | `cmsType !== 'unknown'` |
| 负信号：联系表单 | -0.2 | 表单 action 含 contact/support/help |
| 负信号：仅有 message 无 comment | -0.1 | 有 textarea 但无 commentFields 且无 urlFields |

最终 `confidence = clamp(total, 0, 1)`。

### 3. canComment 判定保持不变

`canComment` 的布尔判定逻辑（第 71-73 行）保持不变，信心度独立计算。

### 4. formType 推断保持不变

formType 的推断逻辑（第 83-86 行）保持不变，不在本次改动范围内。

## 理论分数分布

| 场景 | 预期分数 |
|------|----------|
| 无表单的页面 | 0.0 |
| 有搜索框但无评论功能 | 0.2（仅"有未过滤表单"） |
| 联系表单（有 textarea/message，action 含 /contact） | 0.25 → 0.25-0.2-0.1 = -0.05 → 0.0 |
| WordPress 评论页（完整字段） | 0.2+0.15+0.2+0.2+0.05+0.1+0.15 = 1.05 → 1.0 |
| 简单博客评论（textarea + comment 字段） | 0.2+0.15+0.2 = 0.55 |

## 测试要点

- canComment=false 时 confidence 应为 0.0
- 联系表单的 confidence 应低于 0.3
- 完整 WordPress 评论页 confidence 应 >= 0.9
- 简单评论页 confidence 应在 0.4-0.7 区间
