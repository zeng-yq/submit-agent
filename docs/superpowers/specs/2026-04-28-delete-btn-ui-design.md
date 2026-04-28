# 删除按钮 UI 优化设计

**日期**: 2026-04-28
**状态**: Approved

## 问题

悬浮按钮中的删除按钮采用扁平透明红色风格，与容器中其他元素（action-btn 渐变光泽风格、status-switch 毛玻璃 pill 风格）视觉割裂。

## 方案

将删除按钮改为与 action-btn 完全一致的设计语言，配色改为红色系。

### 改动范围

仅修改 `FloatButton.content.ts` 中的 `.delete-btn` CSS 样式，不涉及任何逻辑变更。

### 样式变更

| 属性 | 现有 | 改后 |
|------|------|------|
| width/height | 28px | 30px |
| border-radius | 7px | 9px |
| background | transparent | `linear-gradient(135deg, #F87171 0%, #DC2626 100%)` |
| color | #DC2626 | #fff |
| box-shadow | 无 | `0 2px 8px rgba(220,38,38,0.35), 0 1px 2px rgba(220,38,38,0.2)` |
| ::after | 无 | glossy highlight |
| hover | 背景变浅红 | `transform: scale(1.1)` |
| active | 背景变深红 | `transform: scale(0.95)` |
| transition | background/color 0.15s | `transform + box-shadow 0.2s cubic-bezier` |

### 不改动

- 垃圾桶 SVG 图标
- handleDeleteClick 逻辑
- 布局位置
