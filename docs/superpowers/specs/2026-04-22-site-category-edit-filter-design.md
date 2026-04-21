# Site Category Edit & Filter Design

## Overview

为"外链提交"Dashboard 面板增加分类编辑和按分类筛选功能。分类固定为 3 类：`blog_comment`、`ai_directory`、`others`。用户可以手动将站点从现有分类覆盖为新分类。

## Categories

| Value | Label | 提交流程 |
|-------|-------|---------|
| `blog_comment` | 博客评论 | 博客评论流程 |
| `ai_directory` | AI 目录 | 目录提交流程 |
| `others` | 其他 | 目录提交流程 |

SiteType 推导逻辑不变：`category === 'blog_comment' ? 'blog_comment' : 'directory_submit'`。

## Type Changes

**`lib/types.ts`**:

```typescript
export type SiteCategory = 'blog_comment' | 'ai_directory' | 'others'

export const SITE_CATEGORIES: { value: SiteCategory; label: string }[] = [
  { value: 'blog_comment', label: '博客评论' },
  { value: 'ai_directory', label: 'AI 目录' },
  { value: 'others', label: '其他' },
]
```

`SiteData.category` 类型从 `string` 收窄为 `SiteCategory`。

## DB Layer

无需 DB schema 升级。`sites` store 已有 `by-category` 索引可直接复用。

**`lib/db.ts`**:

1. 新增 `updateSiteCategory(name: string, category: SiteCategory): Promise<SiteRecord>` — 读取站点、更新 category、写回
2. `seedSites` 中将 `"Non-Blog Comment"` 映射为 `'others'`：`category: site.category === 'Non-Blog Comment' ? 'others' : site.category`

## Dashboard Filter UI

在"全部"tab 搜索框左侧新增分类下拉筛选器（Select）：

- 仅在 `tab === 'all'` 时显示（与搜索框同步）
- 选项：全部 / 博客评论 / AI 目录 / 其他
- 默认值 `'all'` 表示不筛选
- 筛选逻辑：在现有 search 过滤之后追加 category 过滤

```
┌─────────────────────────────────────┐
│ [分类: 全部 ▼]  [搜索站点...]        │
├─────────────────────────────────────┤
│  Site cards...                      │
└─────────────────────────────────────┘
```

## SiteCard Inline Category Edit

卡片上的 category 文字改为可点击的下拉标签：

- 点击 → 弹出 3 选 1 的小 popover 菜单
- 当前选中项高亮
- 选择后立即保存并刷新
- 点击外部关闭

回调链路：
1. `SiteCard` 新增 `onCategoryChange?: (siteName: string, category: SiteCategory) => void`
2. `Dashboard` 实现回调：调用 `updateSiteCategory` → 触发 `reloadSites` → 更新 sites 状态
3. `Dashboard` 通过 prop 传递给 `SiteCard`

## Files to Modify

| File | Change |
|------|--------|
| `lib/types.ts` | 新增 `SiteCategory` 类型、`SITE_CATEGORIES` 常量；`SiteData.category` 收窄类型 |
| `lib/db.ts` | 新增 `updateSiteCategory`；`seedSites` 映射 `Non-Blog Comment` → `others` |
| `components/Dashboard.tsx` | 新增分类筛选下拉、`categoryFilter` state、`onCategoryChange` handler |
| `components/SiteCard.tsx` | 分类标签改为可点击的 inline editor、新增 `onCategoryChange` prop |
| `lib/sites.ts` | 更新 `filterByCategory` 使用 `SiteCategory` 类型 |

## Edge Cases

- DB 中已存在的站点 category 可能是旧值（`"Non-Blog Comment"`），在 UI 显示时需映射或容错
- `seedSites` 只处理新插入的站点（existing check 已有），不影响用户已编辑过的站点
- 分类筛选与搜索筛选叠加使用：先按 category 过滤，再按 search 过滤
