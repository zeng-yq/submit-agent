# 站点编辑弹窗设计

## 概述

在外链提交面板的每条站点卡片上，添加编辑按钮（Pencil 图标），点击后弹出编辑弹窗，可修改站点的所有可编辑字段。同时将分类编辑从卡片内联的 CategoryEditor 迁移到编辑弹窗中，卡片上仅保留分类的只读标签。

## 背景

当前 SiteCard 上的分类编辑器（CategoryEditor）以 popover 形式内联在站点名称下方，只能修改分类。用户需要在弹窗中统一编辑所有站点属性（URL、分类、名称、DR 等）。

## 设计决策

### 1. 新建 Dialog 基础组件

**位置**：`extension/src/components/ui/Dialog.tsx`

**API 设计**：

```tsx
<Dialog open={boolean} onClose={() => void}>
  <DialogHeader>
    <DialogTitle>标题</DialogTitle>
    <DialogDescription>描述（可选）</DialogDescription>
  </DialogHeader>
  <DialogContent>表单内容</DialogContent>
  <DialogFooter>
    <Button onClick={onClose}>取消</Button>
    <Button onClick={onSave}>保存</Button>
  </DialogFooter>
</Dialog>
```

**行为**：
- 点击遮罩层关闭（等同取消）
- ESC 键关闭
- 遮罩：`fixed inset-0 z-50 bg-black/50`
- 卡片居中：`bg-popover border border-border rounded-lg shadow-xl max-w-md`
- 无动画（与项目现有 popover 一致）

### 2. 编辑按钮

**位置**：在开始按钮和重置按钮之间

按钮组顺序：**开始提交** → **编辑（Pencil）** → **重置状态** → **删除**

**样式**：与现有按钮一致，使用 `lucide-react` 的 `Pencil` 图标，`w-3.5 h-3.5`，hover 时显示蓝色高亮。

### 3. 编辑表单字段

| 字段 | 控件 | 对应属性 | 说明 |
|------|------|----------|------|
| 站点名称 | Input | `site.name` | 文本输入 |
| 提交 URL | Input | `site.submit_url` | 可清空（设为 null） |
| 分类 | Select | `site.category` | 3 个选项：博客评论 / AI 目录 / 其他 |
| DR 分数 | Input (number) | `site.dr` | 可为 null |
| 语言 | Input | `site.lang` | 可选 |
| 备注 | Textarea | `site.notes` | 可选 |

**保存行为**：点击"保存"按钮确认修改，点击"取消"或遮罩放弃修改。

### 4. 分类显示迁移

- **移除**：SiteCard 内嵌的 `CategoryEditor` 组件
- **替换为**：站点名称下方的只读分类标签 `<span>`，显示 `getCategoryLabel(site.category)`
- 分类编辑功能移到编辑弹窗中

## 数据流

```
Dashboard
  → SiteCard (onSave)
    → 编辑弹窗内部 useState 管理表单临时数据
    → 保存时回调 onSave(siteName, Partial<SiteData>)
  → useSites.updateSite(siteName, data)
    → IndexedDB 更新
```

## 涉及文件

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `components/ui/Dialog.tsx` | 新增 | Dialog 基础组件 |
| `components/SiteCard.tsx` | 修改 | 加编辑按钮、移除 CategoryEditor、加编辑弹窗 |
| `hooks/useSites.ts` | 修改 | 新增 `updateSite` 方法 |

## 不涉及的文件

- `Dashboard.tsx` — 仅需传递 `onSave` prop，无结构变更
- `types.ts` — 类型不变
- 其他组件不受影响
