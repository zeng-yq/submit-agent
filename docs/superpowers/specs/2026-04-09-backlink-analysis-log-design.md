# Backlink Analysis Log Panel Design

## Problem

When analyzing backlinks (single or batch):
1. Single-row "Analyze" button has no loading feedback — user clicks and sees nothing until result appears
2. Analysis logs are stored in `analysisLog` but only shown as HTML `title` tooltip on error/not_publishable status badges
3. LLM summary (the analysis result) is invisible for publishable entries and buried in tooltip for others
4. Batch progress only shows "Analyzing (1/20)... — Fetching page..." with no per-item detail

## Solution

Replace the existing progress indicator with an activity log panel above the table, matching the SubmitFlow's visual style (blue running, green success, red error, expandable details).

## Data Structure

```ts
interface AnalysisLogEntry {
  id: string
  url: string
  sourceTitle: string
  status: 'running' | 'success' | 'error'
  step?: 'loading' | 'analyzing'
  summary?: string
  reason?: string
  error?: string
  timestamp: number
}
```

## UI: Analysis Log Panel

Located above the table, replacing the current progress indicator bar. Visible whenever there are log entries (not just during `isRunning`).

**Running entry (blue):**
- Blue dot with pulse animation
- "正在分析 example.com/article — Fetching page..."

**Success + publishable (green):**
- Green checkmark
- "example.com/article — 可发布"
- Second indented line with LLM summary

**Success + not publishable (orange):**
- Orange X mark
- "example.com/article — 不可发布"
- Second indented line with LLM summary as reason

**Error (red):**
- Red X mark
- "example.com/article — 错误: {error message}"

**Panel behavior:**
- `max-h-48`, auto-scrolls to bottom on new entries
- Entries accumulate during batch analysis
- Single-item analysis also produces log entries (fixes "no feedback" issue)
- Panel persists after analysis completes so user can review results

## Code Changes

### `hooks/useBacklinkAgent.ts`
- Add `AnalysisLogEntry` type and `logs` state (`useState<AnalysisLogEntry[]>([])`)
- In `analyzeOne`: push running entry on start → update step via callback → set final status on success/error
- In `startAnalysis` loop: each iteration triggers analyzeOne which manages its own log entries
- `reset`: clear logs
- Return `logs` and `clearLogs()`

### `components/BacklinkAnalysis.tsx`
- Add `logs` and `onClearLogs` to props
- Remove existing progress indicator block (lines 180-191)
- Add `AnalysisLogPanel` component (inline or extracted) with colored log entries
- Pass `logs` from parent

### `entrypoints/sidepanel/App.tsx`
- Bridge `logs` and `clearLogs` from `useBacklinkAgent` to `BacklinkAnalysis` component

### `lib/i18n.ts`
- Add translation keys for log status labels (running, success-publishable, success-not-publishable, error)

### Unchanged
- `backlink-analyzer.ts` — core analysis logic stays the same
- `db.ts` — data layer unchanged
- `backlinks.ts` — CSV import unchanged

## Visual Reference

Existing SubmitFlow log style to align with:
- Blue running state with `animate-ping` dot (SubmitFlow.tsx:210-213)
- Green completed state with checkmark (SubmitFlow.tsx:232-243)
- Red error state with X mark (SubmitFlow.tsx:248-259)
- DebugLog expandable panel pattern (SubmitFlow.tsx:71-110)
