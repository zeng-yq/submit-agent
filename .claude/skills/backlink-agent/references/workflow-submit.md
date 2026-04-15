# 提交流程参考

> 文件路径：`${CLAUDE_SKILL_DIR}/references/workflow-submit.md`

---

## 1. 目录提交流程

1. 通过 `/new` 打开目标站点的 `submitUrl`
2. 等待页面加载完成（`/info` 确认 ready 为 complete）
3. 调用 `form-analyzer.js` 注入分析表单结构
4. 调用 `honeypot-detector.js` 注入检测蜜罐字段
5. Claude 分析字段 + 活跃产品信息，生成字段映射
6. 设置 `window.__FILL_DATA__`，调用 `form-filler.js` 注入填写
7. `/screenshot` 截图确认 → 展示给用户
8. 用户确认后通过 `/click` 点击提交按钮
9. 记录到 `data/submissions.json`
10. `/close` 关闭 tab

## 2. 博客评论流程

1. 通过 `/new` 打开目标页面
2. 调用 `comment-expander.js` 注入展开评论区域
3. 等待 ~1 秒让 DOM 更新
4. 调用 `form-analyzer.js` 注入分析评论表单
5. 调用 `page-extractor.mjs` 提取页面内容
6. Claude 阅读页面内容，生成相关评论（80-300 字符）
7. 决定链接放置策略（URL 字段 > name 字段 > 正文 HTML）
8. 设置 `window.__FILL_DATA__`，调用 `form-filler.js` 注入填写
9. `/screenshot` 截图确认 → 用户确认 → 提交
10. 记录到 `data/submissions.json`
11. `/close` 关闭 tab

**form-filler.js 调用方式（两步注入）：**

```bash
# 步骤 1: 设置填写数据
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "window.__FILL_DATA__ = { fields: { 'field_0': 'value1', 'field_1': 'value2' } }"

# 步骤 2: 执行填写脚本
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${CLAUDE_SKILL_DIR}/scripts/form-filler.js")"
```

---

## 3. 站点经验查询与更新

提交前读取 `${CLAUDE_SKILL_DIR}/data/site-experience.json`，查找目标域名。

### 有经验

根据经验调整策略：
- `fillStrategy` 决定使用哪种填充方式（direct / execCommand / reactSetter）
- `effectivePatterns` 指导具体操作顺序
- `knownTraps` 提醒需要避免的陷阱

### 无经验

正常流程完成后，将发现的操作经验写入 `site-experience.json`：

```json
{
  "domain.com": {
    "domain": "domain.com",
    "aliases": [],
    "updated": "2026-04-16",
    "submitType": "directory",
    "formFramework": "native",
    "antispam": "none",
    "fillStrategy": "direct",
    "postSubmitBehavior": "redirect",
    "effectivePatterns": ["有效策略描述"],
    "knownTraps": ["陷阱描述"]
  }
}
```

字段说明：
- `domain` — 站点域名（JSON key）
- `aliases` — 域名别名或简称
- `updated` — 最后更新日期
- `submitType` — `"directory"` | `"blog-comment"`
- `formFramework` — 表单技术栈 (native/react/vue/wordpress)
- `antispam` — 反垃圾系统 (none/akismet/hcaptcha/etc)
- `fillStrategy` — 填充策略 (direct/execCommand/reactSetter)
- `postSubmitBehavior` — 提交后行为 (redirect/success-message/moderation-notice/silent)
- `effectivePatterns` — 已验证有效的操作策略数组
- `knownTraps` — 已知的陷阱和注意事项数组

### 经验过时

策略失败时更新对应条目，更新 `updated` 日期。

---

## 4. 提交记录管理

查看和统计提交历史。

- 所有提交记录存储在 `data/submissions.json`
- 按状态筛选：`submitted` / `failed` / `skipped`
- 按产品筛选：`productId`
- 统计总提交数、成功率、失败原因分布

---

## 5. 注入脚本参考

### detect-comment-form.js

检测页面是否包含评论表单及相关信号。
返回 JSON：hasTextarea、hasUrlField、hasAuthorField、hasEmailField、hasCommentForm、isWordPress、commentSystem 等。

```bash
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${CLAUDE_SKILL_DIR}/scripts/detect-comment-form.js")"
```

### detect-antispam.js

检测页面使用的反垃圾系统。
返回 JSON：detected 数组（name、bypassable、evidence）、hasBypassable、hasUnbypassable、count。

```bash
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${CLAUDE_SKILL_DIR}/scripts/detect-antispam.js")"
```

### form-analyzer.js

扫描所有表单元素，返回结构化字段描述。
返回值：fields（字段数组）、forms（表单分组）、page_info（页面信息）。

```bash
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${CLAUDE_SKILL_DIR}/scripts/form-analyzer.js")"
```

### honeypot-detector.js

检测蜜罐表单字段，7 维评分系统。
返回值：`{ total, suspicious, honeypots, all }`

```bash
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${CLAUDE_SKILL_DIR}/scripts/honeypot-detector.js")"
```

### form-filler.js

逐字段填写表单，兼容 React/Vue 受控组件。
使用两步注入（先设置 `window.__FILL_DATA__`，再执行脚本）。
返回值：`{ success, total, results: [{ canonical_id, status, filled, verified }] }`

### comment-expander.js

展开懒加载的评论表单区域（支持 wpDiscuz、WordPress 默认评论）。
CDP 页面上下文可直接访问 jQuery。
返回值：`{ found, triggerSelector, clicked, unhid, hint }`

```bash
curl -s -X POST "http://localhost:3457/eval?target=<targetId>" \
  -d "$(cat "${CLAUDE_SKILL_DIR}/scripts/comment-expander.js")"
```

### page-extractor.mjs

通过 CDP Proxy 提取页面正文文本和评论信号。
输出 JSON：title、textContent（截断 8000 字符）、commentSignals、url。

```bash
node "${CLAUDE_SKILL_DIR}/scripts/page-extractor.mjs" <targetId>
```

---

## 6. 相关参考

- 数据格式规范：`${CLAUDE_SKILL_DIR}/references/data-formats.md`
- CDP Proxy API：`${CLAUDE_SKILL_DIR}/references/cdp-proxy-api.md`
