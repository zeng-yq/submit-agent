# 提交时自动切换到活动日志面板

## 背景

用户在提交外链时，无论从哪个入口触发提交流程（站点卡片、悬浮按钮、失败重试），都应该自动导航到活动日志面板查看提交进度。

当前 Dashboard 组件已有在引擎激活时自动切到 `log` 子标签的逻辑，但仅在用户已处于「外链提交」顶层标签页时生效。如果用户在「外链分析」或「设置」标签页，或者通过悬浮按钮触发提交，则不会自动跳转。

## 方案

在 `App.tsx` 中监听 `engineStatus`，当引擎变为活跃状态时自动将顶层标签页切到 `submit`。Dashboard 的现有逻辑随后接管，将子标签切到 `log`。

### 修改范围

**唯一修改文件**：`extension/src/entrypoints/sidepanel/App.tsx`

新增一个 `useEffect`：

```tsx
useEffect(() => {
  const isActive = engineStatus === 'running' || engineStatus === 'analyzing' || engineStatus === 'filling'
  if (isActive) {
    setTab('submit')
  }
}, [engineStatus])
```

### 工作原理

所有提交流程入口都经过 `useFormFillEngine`，状态转换序列为：

```
idle → reset() → idle → startSubmission() → analyzing → running → filling → idle
```

| 入口 | 触发路径 | 状态变化 |
|------|----------|----------|
| 站点卡片 | `handleStartSite` → `reset()` → `startSubmission()` | `idle → analyzing → ...` |
| 悬浮按钮 | `useFloatFill.runFloatFill` → `reset()` → `startSubmission()` | `idle → analyzing → ...` |
| 失败重试 | 同站点卡片 | 同上 |

### 边界情况

- **用户在提交中手动切换标签页**：不会被强制跳回，因为 `engineStatus` 未变化，`useEffect` 不会重触发
- **连续提交两个站点**：`reset()` 使状态回到 `idle`，下一次 `startSubmission` 再次触发 `idle → analyzing`，正常工作
- **悬浮按钮触发时侧边面板未打开**：后台先打开面板 → 组件挂载 → `useFloatFill` 检查 pending → 调用 `startSubmission` → 状态变化 → `useEffect` 触发跳转
- **当前已在 `submit` 标签页**：`setTab('submit')` 是 no-op，Dashboard 的现有逻辑接管

### 不修改的文件

- `useFloatFill.ts` — 无需改动
- `Dashboard.tsx` — 已有自动切到 log 子标签的逻辑
- `useFormFillEngine.ts` — 无需改动
- `background.ts` — 无需改动
