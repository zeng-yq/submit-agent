# 外链分析面板虚拟滚动优化

## 背景

外链分析面板导入 25000 条外链后，每次从其他面板切换过来都会卡顿。核心原因是全量渲染 25000 行到 DOM 中，React 需要创建 ~125,000 个虚拟 DOM 节点，浏览器需要一次性插入相同数量的 DOM 节点。

## 瓶颈分析

切换到 analysis tab 时的阻塞链路：

1. **IndexedDB 全量读取** (~50-150ms) — `listBacklinks()` 每次切换都执行
2. **重复数组遍历** (~10-30ms) — stats 计算 3 次 `.filter()` + tab 计数 2 次 `.filter()` + sort
3. **React 渲染** (~200-500ms) — 25000 个 BacklinkRow 组件同时创建，~125,000 VNode
4. **DOM 挂载** (~150-400ms) — 浏览器批量插入 ~125,000 DOM 节点，触发布局计算

阶段 3+4 占总耗时 ~80%，是核心瓶颈。

## 方案选择

| 方案 | 优点 | 缺点 |
|---|---|---|
| @tanstack/react-virtual + CSS Grid | ~3KB bundle、headless 灵活、社区活跃 | 需要把 table 改为 div grid |
| @tanstack/react-virtual + 保持 table | 保留原生表格语义 | table + 绝对定位兼容性差，实现复杂 |
| react-virtuoso TableVirtuoso | 开箱支持表格+动态高度 | ~12KB bundle，对扩展偏重 |

**选定方案**：@tanstack/react-virtual + CSS Grid

理由：
- Bundle 小，适合 Chrome 扩展
- Headless 设计，完全控制 DOM 结构
- 当前表格只有 4 列固定宽度，CSS Grid 可完美复刻
- 展开行作为虚拟行内部内容，由 virtualizer 自动测量高度

## 设计细节

### 结构变化

**当前**：
```
<div overflow-y-auto>
  <table table-fixed>
    <thead sticky> 表头 </thead>
    <tbody>
      {25000 × <BacklinkRow> → 1-2 个 <tr>}
    </tbody>
  </table>
</div>
```

**目标**：
```
<div ref={scrollRef} overflow-y-auto>
  <div position:relative height={totalSize}>
    {~20 × 虚拟行 (absolute + translateY)}
      每行 = CSS Grid 4列 + 可选展开内容
  </div>
</div>
```

### CSS Grid 布局

当前 table 列宽：`w-10`(AS) | auto(来源) | `w-20`(Status) | `w-16`(操作)

Grid 等价：`grid-template-columns: 2.5rem 1fr 5rem 4rem`

### 展开行处理

展开行不再是独立的 `<tr>`，而是虚拟行容器的内部子元素：

```
虚拟行容器 (data-index, ref=measureElement)
├── CSS Grid 行 (固定 ~36px)
│   ├── AS 分数
│   ├── 来源 URL
│   ├── 状态徽标
│   └── 操作按钮
└── 展开内容 (条件渲染, ~0-200px)
    └── 分析日志列表
```

virtualizer 通过 `measureElement` ref + ResizeObserver 自动检测高度变化。展开/折叠时无需手动通知。

### 统计计算优化

BacklinkAnalysis.tsx 的 stats 从 3 次 `.filter()` 改为 1 次 for 循环 + `useMemo`。

BacklinkTable.tsx 的 filteredBacklinks 加 `useMemo`，tab 计数从遍历改为基于 filteredBacklinks 计算。

## 影响范围

- `extension/package.json` — 新增 `@tanstack/react-virtual`
- `extension/src/components/BacklinkTable.tsx` — 核心改造（虚拟化 + CSS Grid）
- `extension/src/components/BacklinkRow.tsx` — 重构，输出 Grid 行内容
- `extension/src/components/BacklinkAnalysis.tsx` — stats 加 `useMemo`

不影响：`useBacklinkState`、`db.ts`、`BacklinkToolbar`、`App.tsx`

## 性能预期

| 指标 | 优化前 | 优化后 |
|---|---|---|
| DOM 节点数 | ~125,000+ | ~200 |
| React 组件数 | 25,000 | ~30 |
| 首次渲染耗时 | 400-900ms | < 50ms |
| 滚动流畅度 | 卡顿 | 60fps |

## 验收标准

- 25000 条外链时，切换到分析面板无感知卡顿 (< 100ms)
- 滚动流畅，无白屏闪烁
- 展开行功能正常，高度自适应
- Tab 筛选切换正常
- 现有测试通过
- `npm run build` 无报错
