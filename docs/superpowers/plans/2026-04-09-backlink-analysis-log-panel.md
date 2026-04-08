# Backlink Analysis Log Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an activity log panel above the backlink analysis table that shows real-time analysis progress, LLM summaries, and error details — matching the SubmitFlow visual style.

**Architecture:** Extend `useBacklinkAgent` hook with a `logs` state array of `AnalysisLogEntry` objects. Each analysis (single or batch) pushes/updates entries. A new `AnalysisLogPanel` component in `BacklinkAnalysis.tsx` renders these entries with color-coded status indicators. `App.tsx` bridges the new props.

**Tech Stack:** React hooks, TypeScript, Tailwind CSS, existing i18n system.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `extension/src/hooks/useBacklinkAgent.ts` | Modify | Add `AnalysisLogEntry` type, `logs` state, log management in `analyzeOne` |
| `extension/src/components/BacklinkAnalysis.tsx` | Modify | Add `AnalysisLogPanel`, replace progress indicator, wire new props |
| `extension/src/entrypoints/sidepanel/App.tsx` | Modify | Bridge `logs` and `clearLogs` from hook to component |
| `extension/src/lib/i18n.ts` | Modify | Add log-related translation keys |

---

### Task 1: Add i18n translation keys

**Files:**
- Modify: `extension/src/lib/i18n.ts` (lines 204-214 for en, 418-428 for zh)

- [ ] **Step 1: Add English translation keys**

Insert these keys after `backlink.adding` (line 214) in the `en` object:

```ts
'backlink.log.running': 'Analyzing...',
'backlink.log.fetching': 'Fetching page...',
'backlink.log.analyzingContent': 'Analyzing content...',
'backlink.log.publishable': 'Publishable',
'backlink.log.notPublishable': 'Not publishable',
'backlink.log.error': 'Error: {message}',
'backlink.log.clearLogs': 'Clear logs',
```

- [ ] **Step 2: Add Chinese translation keys**

Insert matching keys after `backlink.adding` (line 428) in the `zh` object:

```ts
'backlink.log.running': '正在分析...',
'backlink.log.fetching': '正在获取页面...',
'backlink.log.analyzingContent': '正在分析内容...',
'backlink.log.publishable': '可发布',
'backlink.log.notPublishable': '不可发布',
'backlink.log.error': '错误：{message}',
'backlink.log.clearLogs': '清除日志',
```

- [ ] **Step 3: Commit**

```bash
git add extension/src/lib/i18n.ts
git commit -m "feat(i18n): add backlink analysis log translation keys"
```

---

### Task 2: Add log state management to useBacklinkAgent hook

**Files:**
- Modify: `extension/src/hooks/useBacklinkAgent.ts`

- [ ] **Step 1: Add AnalysisLogEntry type and logs state**

Add the type and state at the top of the file, after the imports (line 6):

```ts
export interface AnalysisLogEntry {
  id: string
  url: string
  sourceTitle: string
  status: 'running' | 'success' | 'error'
  step?: 'loading' | 'analyzing'
  summary?: string
  publishable?: boolean
  error?: string
  timestamp: number
}
```

Inside the hook function body, after line 16 (`const [isRunning, setIsRunning] = useState(false)`), add:

```ts
const [logs, setLogs] = useState<AnalysisLogEntry[]>([])
```

- [ ] **Step 2: Add clearLogs callback**

After the `stop` callback (line 115), add:

```ts
const clearLogs = useCallback(() => {
  setLogs([])
}, [])
```

- [ ] **Step 3: Update analyzeOne to manage log entries**

Replace the entire `analyzeOne` function (lines 19-77) with:

```ts
const analyzeOne = useCallback(
  async (backlink: BacklinkRecord): Promise<void> => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    const logId = `${backlink.id}-${Date.now()}`
    const displayName = backlink.sourceTitle || extractDomain(backlink.sourceUrl)

    // Push running log entry
    setLogs(prev => [...prev, {
      id: logId,
      url: backlink.sourceUrl,
      sourceTitle: displayName,
      status: 'running',
      step: 'loading',
      timestamp: Date.now(),
    }])

    const updateLog = (updates: Partial<AnalysisLogEntry>) => {
      setLogs(prev => prev.map(l => l.id === logId ? { ...l, ...updates } : l))
    }

    try {
      const result = await analyzeBacklink(
        backlink.sourceUrl,
        ac.signal,
        (step) => {
          if (step === 'analyzing') {
            updateLog({ step: 'analyzing' })
          }
        },
      )

      const publishable = result?.isBlog && result?.canComment
      const newStatus: BacklinkStatus = publishable ? 'publishable' : 'not_publishable'

      const updated = await updateBacklink({
        ...backlink,
        status: newStatus,
        analysisLog: [result.summary || 'Analysis complete'],
      })

      // If publishable, add to sites table
      if (publishable) {
        const siteRecord: SiteRecord = {
          name: backlink.sourceTitle || extractDomain(backlink.sourceUrl),
          submit_url: backlink.sourceUrl,
          category: 'Blog Comment',
          lang: '',
          dr: null,
          monthly_traffic: '',
          pricing: 'Free',
          status: 'alive',
          notes: result.summary || '',
          source: 'crawled',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        await addSite(siteRecord)
      }

      updateLog({
        status: 'success',
        step: undefined,
        summary: result.summary || 'Analysis complete',
        publishable,
        timestamp: Date.now(),
      })

      setBacklinks(prev => prev.map(b => b.id === backlink.id ? updated : b))
    } catch (error) {
      if (ac.signal.aborted) {
        // Remove the running log entry if aborted
        setLogs(prev => prev.filter(l => l.id !== logId))
        return
      }
      const errorMsg = error instanceof Error ? error.message : String(error)
      try {
        const updated = await updateBacklink({
          ...backlink,
          status: 'error',
          analysisLog: [...backlink.analysisLog, `错误: ${errorMsg}`],
        })
        setBacklinks(prev => prev.map(b => b.id === backlink.id ? updated : b))
      } catch {
        console.error('Failed to update backlink error status:', errorMsg)
      }
      updateLog({
        status: 'error',
        step: undefined,
        error: errorMsg,
        timestamp: Date.now(),
      })
    }
  },
  []
)
```

- [ ] **Step 4: Update reset to clear logs**

In the `reset` callback (lines 118-127), add `setLogs([])` after `setIsRunning(false)`:

```ts
const reset = useCallback(() => {
  abortRef.current?.abort()
  abortRef.current = null
  stopRequestedRef.current = false
  setStatus('idle')
  setCurrentStep(null)
  setCurrentIndex(0)
  setBatchSize(0)
  setIsRunning(false)
  setLogs([])
}, [])
```

- [ ] **Step 5: Export logs and clearLogs**

Update the return object (lines 170-184) to include `logs` and `clearLogs`:

```ts
return {
  status,
  currentStep,
  currentIndex,
  batchSize,
  backlinks,
  isRunning,
  logs,
  startAnalysis,
  stop,
  reset,
  reload,
  analyzeOne,
  addAndAnalyzeUrl,
  clearLogs,
}
```

- [ ] **Step 6: Commit**

```bash
git add extension/src/hooks/useBacklinkAgent.ts
git commit -m "feat: add log state management to useBacklinkAgent hook"
```

---

### Task 3: Add AnalysisLogPanel to BacklinkAnalysis component

**Files:**
- Modify: `extension/src/components/BacklinkAnalysis.tsx`

- [ ] **Step 1: Update imports and props**

Add import for `AnalysisLogEntry` at the top (line 2):

```ts
import type { AnalysisLogEntry } from '@/hooks/useBacklinkAgent'
```

Add `useEffect, useRef` to the React import (line 3):

```ts
import { useEffect, useRef, useState } from 'react'
```

Update the props interface (lines 8-21) — add `logs` and `onClearLogs`, remove unused `currentStep`:

```ts
interface BacklinkAnalysisProps {
  backlinks: BacklinkRecord[]
  currentIndex: number
  batchSize: number
  isRunning: boolean
  logs: AnalysisLogEntry[]
  onImportCsv: (csvText: string) => Promise<{ imported: number; skipped: number }>
  onReload: () => void
  onStartAnalysis: (count: number) => void
  onAnalyzeOne: (backlink: BacklinkRecord) => void
  onAddUrl: (url: string) => Promise<{ success: boolean; error?: string }>
  onStop: () => void
  onBack: () => void
  onClearLogs: () => void
}
```

- [ ] **Step 2: Remove STEP_LABELS constant**

Delete lines 30-34 (the `STEP_LABELS` constant) — no longer needed.

- [ ] **Step 3: Add AnalysisLogPanel component**

Add this component before the main `BacklinkAnalysis` function (after `STATUS_COLORS`):

```tsx
function AnalysisLogPanel({ logs, onClear }: { logs: AnalysisLogEntry[]; onClear: () => void }) {
  const t = useT()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs.length])

  if (logs.length === 0) return null

  return (
    <div className="px-3 py-2 border-b border-border/60">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{t('backlink.log')}</span>
        <button
          type="button"
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          onClick={onClear}
        >
          {t('backlink.log.clearLogs')}
        </button>
      </div>
      <div className="max-h-48 overflow-y-auto space-y-1">
        {logs.map(log => (
          <div key={log.id} className="text-xs">
            {log.status === 'running' && (
              <div className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
                <span className="relative flex h-1.5 w-1.5 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500" />
                </span>
                <span className="truncate">{log.sourceTitle}</span>
                <span className="text-muted-foreground/60 shrink-0">
                  — {log.step === 'analyzing' ? t('backlink.log.analyzingContent') : t('backlink.log.fetching')}
                </span>
              </div>
            )}
            {log.status === 'success' && (
              <div>
                <div className={`flex items-center gap-1.5 ${log.publishable ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  <span className="shrink-0">{log.publishable ? '✓' : '✕'}</span>
                  <span className="truncate">{log.sourceTitle}</span>
                  <span className="shrink-0">
                    — {log.publishable ? t('backlink.log.publishable') : t('backlink.log.notPublishable')}
                  </span>
                </div>
                {log.summary && (
                  <div className="ml-4 text-[10px] text-muted-foreground truncate" title={log.summary}>
                    {log.summary}
                  </div>
                )}
              </div>
            )}
            {log.status === 'error' && (
              <div className="flex items-center gap-1.5 text-red-500">
                <span className="shrink-0">✕</span>
                <span className="truncate">{log.sourceTitle}</span>
                <span className="text-muted-foreground/60 shrink-0">
                  — {t('backlink.log.error', { message: log.error || '' })}
                </span>
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Update BacklinkAnalysis function signature**

Update the destructured props (lines 36-49) to match the new interface:

```tsx
export function BacklinkAnalysis({
  backlinks,
  currentIndex,
  batchSize,
  isRunning,
  logs,
  onImportCsv,
  onReload,
  onStartAnalysis,
  onAnalyzeOne,
  onAddUrl,
  onStop,
  onBack,
  onClearLogs,
}: BacklinkAnalysisProps) {
```

- [ ] **Step 5: Replace progress indicator with AnalysisLogPanel**

Replace the existing progress indicator block (lines 179-191):

```tsx
{/* Progress indicator */}
{isRunning && (
  <div className="px-3 py-1.5 flex items-center gap-1.5 text-xs text-muted-foreground border-b border-border/60">
    <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
    {t('backlink.analyzing', { current: currentIndex + 1, total: batchSize })}
    {currentStep && (
      <span className="text-muted-foreground/60">
        {' — '}
        {STEP_LABELS[currentStep]}
      </span>
    )}
  </div>
)}
```

With:

```tsx
{/* Analysis log panel */}
<AnalysisLogPanel logs={logs} onClear={onClearLogs} />
```

- [ ] **Step 6: Commit**

```bash
git add extension/src/components/BacklinkAnalysis.tsx
git commit -m "feat: add AnalysisLogPanel component replacing progress indicator"
```

---

### Task 4: Bridge new props in App.tsx

**Files:**
- Modify: `extension/src/entrypoints/sidepanel/App.tsx` (lines 32-44, 158-175)

- [ ] **Step 1: Destructure logs and clearLogs from useBacklinkAgent**

Update the destructuring at lines 32-44 to include `logs` and `clearLogs`:

```ts
const {
  currentStep: backlinkStep,
  currentIndex,
  batchSize,
  backlinks,
  isRunning: isBacklinkRunning,
  logs: backlinkLogs,
  startAnalysis,
  analyzeOne: analyzeBacklink,
  stop: stopBacklinkAnalysis,
  reset: resetBacklinkAgent,
  reload: reloadBacklinks,
  addAndAnalyzeUrl,
  clearLogs: clearBacklinkLogs,
} = useBacklinkAgent()
```

- [ ] **Step 2: Pass new props to BacklinkAnalysis component**

Update the BacklinkAnalysis usage (lines 158-175):

```tsx
<BacklinkAnalysis
  backlinks={backlinks}
  currentIndex={currentIndex}
  batchSize={batchSize}
  isRunning={isBacklinkRunning}
  logs={backlinkLogs}
  onImportCsv={importBacklinksFromCsv}
  onReload={reloadBacklinks}
  onStartAnalysis={startAnalysis}
  onAnalyzeOne={analyzeBacklink}
  onAddUrl={addAndAnalyzeUrl}
  onStop={stopBacklinkAnalysis}
  onClearLogs={clearBacklinkLogs}
  onBack={() => {
    if (!isBacklinkRunning) resetBacklinkAgent()
    setView({ name: 'dashboard' })
  }}
/>
```

- [ ] **Step 3: Commit**

```bash
git add extension/src/entrypoints/sidepanel/App.tsx
git commit -m "feat: bridge log props from useBacklinkAgent to BacklinkAnalysis"
```

---

### Task 5: Verify build and manual test

- [ ] **Step 1: Run build to verify no TypeScript errors**

Run: `cd extension && npm run build`
Expected: Build completes with no errors.

- [ ] **Step 2: Manual test checklist**

Load the extension in Chrome and verify:
1. Import CSV with backlinks → navigate to backlink analysis view
2. Click single "Analyze" button on a row → log panel appears above table with blue running entry → transitions to green/orange/red result with summary
3. Click "Start Analysis" for batch → log entries accumulate in panel, auto-scrolls to bottom
4. Click "Stop" during batch → stops cleanly
5. Click "Clear logs" → log panel disappears
6. Click "Back" → returns to dashboard, logs cleared on re-entry (reset called)
7. Verify log summaries show LLM analysis results for both publishable and not_publishable
8. Verify error entries show error message from API failures

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address build/manual test issues for backlink log panel"
```

---

## Self-Review

**Spec coverage:**
- Data structure (AnalysisLogEntry) → Task 2
- UI log panel (color-coded entries, auto-scroll, clear) → Task 3
- Hook log management (push/update/clear) → Task 2
- i18n keys → Task 1
- App.tsx bridging → Task 4
- Build verification → Task 5

**Placeholder scan:** No TBD/TODO/placeholders found. All code blocks contain complete implementations.

**Type consistency:**
- `AnalysisLogEntry` exported from `useBacklinkAgent.ts`, imported in `BacklinkAnalysis.tsx` — consistent
- `logs` and `clearLogs` prop names match across hook return, App.tsx destructuring, and component props
- `onClearLogs` prop name consistent between component interface and App.tsx usage
