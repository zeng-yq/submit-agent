# 快捷随机打开未提交外链

## 背景

在外链提交面板的"未完成"视图中，用户需要逐个点击站点名称来打开提交页面，操作繁琐。需要一个快捷按钮，一键随机打开多个未提交外链页面，仅打开不自动提交。

## 设计方案

### UI 位置

在 Dashboard.tsx 搜索输入框右侧添加"随机打开"按钮。

### 按钮行为

- 仅在 `tab === 'undone'` 时显示
- 按钮文案动态显示可打开数量，如"随机打开 10 个"或"随机打开 3 个"（不足 10 个时显示实际数量）
- 无可打开站点时（没有 submit_url），按钮置灰禁用
- 点击后进入 loading 状态，防止重复点击，全部打开后恢复

### 核心逻辑

1. 从 `undoneSites` 中筛选有 `submit_url` 的站点
2. Fisher-Yates shuffle 随机打乱，取前 min(10, total) 个
3. 逐个调用 `chrome.tabs.create({ url, active: false })`，间隔 500ms
4. 最后一个 tab 设为 `active: true`，自动聚焦
5. 全部完成后按钮恢复可用

### 改动范围

- `extension/src/components/Dashboard.tsx`：添加按钮、shuffle 工具函数、批量打开逻辑
