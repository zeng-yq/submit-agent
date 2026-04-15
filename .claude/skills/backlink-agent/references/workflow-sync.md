# 同步流程参考

> 文件路径：`${SKILL_DIR}/references/workflow-sync.md`

---

## 1. Google Sheets 同步

将本地 JSON 数据与 Google Sheet 双向同步。

### 前置条件

1. 配置 `data/sync-config.json` 中的服务账号密钥和 Sheet URL
2. 将 Sheet 分享给服务账号的邮箱地址

### 上传（本地 → Sheet）

```bash
node "${SKILL_DIR}/scripts/sheets-sync.mjs" upload \
  --config "${SKILL_DIR}/data/sync-config.json" \
  --data "${SKILL_DIR}/data"
```

上传前自动备份现有 Sheet 数据，失败时自动回滚。

### 下载（Sheet → 本地）

```bash
node "${SKILL_DIR}/scripts/sheets-sync.mjs" download \
  --config "${SKILL_DIR}/data/sync-config.json" \
  --data "${SKILL_DIR}/data"
```

### 同步的 4 个 Tab

products / submissions / sites / backlinks

---

## 2. 相关参考

- 数据格式规范：`${SKILL_DIR}/references/data-formats.md`
