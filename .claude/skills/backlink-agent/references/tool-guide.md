# 工具选择指南

> 文件路径：`${SKILL_DIR}/references/tool-guide.md`

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

## 脚本路径速查

| 脚本 | 路径 | 类型 |
|------|------|------|
| db-ops.mjs | `${SKILL_DIR}/scripts/data/db-ops.mjs` | CLI 工具 |
| import-csv.mjs | `${SKILL_DIR}/scripts/data/import-csv.mjs` | CLI 工具 |
| cdp-proxy.mjs | `${SKILL_DIR}/scripts/browser/cdp-proxy.mjs` | 服务 |
| check-deps.mjs | `${SKILL_DIR}/scripts/browser/check-deps.mjs` | CLI 工具 |
| page-extractor.mjs | `${SKILL_DIR}/scripts/browser/page-extractor.mjs` | CLI 工具 |
| product-generator.mjs | `${SKILL_DIR}/scripts/browser/product-generator.mjs` | CLI 工具 |
| form-analyzer.js | `${SKILL_DIR}/scripts/injection/form-analyzer.js` | 注入脚本 |
| form-filler.js | `${SKILL_DIR}/scripts/injection/form-filler.js` | 注入脚本 |
| detect-comment-form.js | `${SKILL_DIR}/scripts/injection/detect-comment-form.js` | 注入脚本 |
| detect-antispam.js | `${SKILL_DIR}/scripts/injection/detect-antispam.js` | 注入脚本 |
| honeypot-detector.js | `${SKILL_DIR}/scripts/injection/honeypot-detector.js` | 注入脚本 |
| comment-expander.js | `${SKILL_DIR}/scripts/injection/comment-expander.js` | 注入脚本 |
