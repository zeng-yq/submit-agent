# Backlink Analysis UX Optimization Design

## Problem

When analyzing backlinks (single or batch):

1. **Single-row "Analyze" button has no loading feedback** — `isRunning` is only set during batch analysis, so clicking a single row's Analyze button shows no visual change. User may click multiple times.
2. **Analysis logs buried in tooltip** — Logs are only visible via HTML `title` tooltip on error/not_publishable status badges. Publishable entries have no way to view the LLM summary. Tooltips are hard to read for multi-line content.
3. **Batch progress lacks context** — Only shows "Analyzing (1/20) — Fetching page..." with no indication of which URL is being processed.
4. **Step labels hardcoded in English** — `STEP_LABELS` in BacklinkAnalysis.tsx are not i18n-ized.

## Solution

Three targeted improvements: button loading state, enhanced progress display, and inline expandable log details.

## Part 1: Analyze Button Loading State

### State changes in `useBacklinkAgent.ts`

Add `analyzingId: string | null` state:

- Set to `backlink.id` at the start of `analyzeOne()`
- Reset to `null` in the finally block of `analyzeOne()`
- Expose via the hook's return value

### Button rendering in `BacklinkAnalysis.tsx`

- When `analyzingId === b.id`: button shows a spinning icon + "分析中..." text, disabled
- When `analyzingId !== null` (any other row): button is disabled, no text change
- When `analyzingId === null` and `isRunning` (batch): button is disabled (existing behavior preserved)
- Current analyzing row gets `bg-blue-500/5` background highlight

### Props change

Add `analyzingId: string | null` to `BacklinkAnalysisProps`.

## Part 2: Enhanced Progress Display

### Keep the same position (above the table), enhance content

**Structure when analyzing:**
```
[●] 正在分析 (3/20) — example-blog.com
    当前步骤：正在分析内容...
```

**Single item analysis:**
```
[●] 正在分析 — example-blog.com
    当前步骤：正在获取页面...
```

**After completion (auto-dismiss after 1.5s):**
```
[✓] 分析完成 — example-blog.com
```

### Implementation details

- Extract domain from `backlinks.find(b => b.id === analyzingId)?.sourceUrl` for display
- Add i18n keys for step labels: `backlink.step.loading`, `backlink.step.analyzing`, `backlink.step.done`
- Add `backlink.analyzingSingle` i18n key for single-item progress format
- Show progress area when `analyzingId !== null` OR `isRunning`
- Use a `useEffect` with timeout to auto-hide the completion message

### Files

- `BacklinkAnalysis.tsx` — modify progress indicator rendering
- `i18n.ts` — add step-related i18n keys

## Part 3: Inline Expandable Log Details

### Behavior

- Click a non-pending status badge to expand/collapse a detail row below
- Component tracks `expandedId: string | null` in local state
- Only non-pending entries are expandable (status badges get `cursor-pointer`)

### Expanded row content

```
┌────────────────────────────────────────────────────────┐
│ ▎ 分析结果：这是一个 WordPress 博客页面，支持评论且有   │
│ ▎ URL 字段，适合提交外链。                              │
└────────────────────────────────────────────────────────┘
```

- Left border colored by status: green (publishable), red (error/not_publishable)
- Background tinted by status
- Shows all `analysisLog` entries, joined by newlines
- Smaller font size (`text-xs`), `px-4 py-2` padding

### Status badge changes

- Add `cursor-pointer` and hover effect (`hover:opacity-80`)
- Add a small chevron icon or underline to indicate clickability
- Retain existing `title` tooltip as fallback

### Auto-expand after analysis

- When `analyzeOne` completes, if the item was clicked manually (not part of batch), auto-expand its log
- During batch analysis, auto-expand the most recently completed item

### Files

- `BacklinkAnalysis.tsx` — add `expandedId` state, expandable row rendering, badge click handler

## Files Changed Summary

| File | Changes |
|------|---------|
| `hooks/useBacklinkAgent.ts` | Add `analyzingId` state, expose in return |
| `components/BacklinkAnalysis.tsx` | Button loading state, enhanced progress, inline expand |
| `entrypoints/sidepanel/App.tsx` | Bridge `analyzingId` prop |
| `lib/i18n.ts` | Add step i18n keys |

### Unchanged

- `backlink-analyzer.ts` — core analysis logic stays the same
- `db.ts` — data layer unchanged
- `backlinks.ts` — CSV import unchanged
