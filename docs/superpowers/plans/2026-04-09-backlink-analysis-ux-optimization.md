# Backlink Analysis UX Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the backlink analysis UX with button loading states, enhanced progress display, and inline expandable log details.

**Architecture:** Add `analyzingId` state to track which backlink is being analyzed. Enhance the progress bar to show the target domain. Add `expandedId` state for inline log expansion. All changes are local to the existing components — no new files needed.

**Tech Stack:** React hooks (useState/useCallback/useEffect), TypeScript, Tailwind CSS v4, chrome extension sidepanel

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `extension/src/hooks/useBacklinkAgent.ts` | Modify | Add `analyzingId` state, set/reset in `analyzeOne` |
| `extension/src/lib/i18n.ts` | Modify | Add step label and progress i18n keys |
| `extension/src/components/BacklinkAnalysis.tsx` | Modify | Button loading state, enhanced progress, inline expand |
| `extension/src/entrypoints/sidepanel/App.tsx` | Modify | Bridge `analyzingId` prop to BacklinkAnalysis |

No new files. No changes to `backlink-analyzer.ts`, `db.ts`, or `backlinks.ts`.

---

### Task 1: Add i18n keys for step labels and progress

**Files:**
- Modify: `extension/src/lib/i18n.ts:191-214` (en backlink section) and `extension/src/lib/i18n.ts:399-429` (zh backlink section)

- [ ] **Step 1: Add new English i18n keys**

Add after `backlink.adding` (line 214) in the `en` object:

```ts
'backlink.step.loading': 'Fetching page...',
'backlink.step.analyzing': 'Analyzing content...',
'backlink.step.done': 'Done',
'backlink.analyzingSingle': 'Analyzing — {domain}',
'backlink.analyzingDone': 'Done — {domain}',
'backlink.analyzingIn': 'Analyzing in progress...',
```

- [ ] **Step 2: Add matching Chinese i18n keys**

Add after `backlink.adding` (line 428) in the `zh` object:

```ts
'backlink.step.loading': '正在获取页面...',
'backlink.step.analyzing': '正在分析内容...',
'backlink.step.done': '完成',
'backlink.analyzingSingle': '正在分析 — {domain}',
'backlink.analyzingDone': '分析完成 — {domain}',
'backlink.analyzingIn': '分析进行中...',
```

- [ ] **Step 3: Verify build passes**

Run: `cd extension && npm run build`
Expected: Build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add extension/src/lib/i18n.ts
git commit -m "feat: add backlink step and progress i18n keys"
```

---

### Task 2: Add `analyzingId` state to useBacklinkAgent hook

**Files:**
- Modify: `extension/src/hooks/useBacklinkAgent.ts`

- [ ] **Step 1: Add `analyzingId` state**

Add after line 16 (`const [isRunning, setIsRunning] = useState(false)`):

```ts
const [analyzingId, setAnalyzingId] = useState<string | null>(null)
```

- [ ] **Step 2: Set/reset `analyzingId` in `analyzeOne`**

In `analyzeOne` callback, add `setAnalyzingId(backlink.id)` at the start of the try block (after line 25), and add a finally block to reset it.

The modified `analyzeOne` should be:

```ts
const analyzeOne = useCallback(
	async (backlink: BacklinkRecord): Promise<void> => {
		abortRef.current?.abort()
		const ac = new AbortController()
		abortRef.current = ac
		setAnalyzingId(backlink.id)

		try {
			const result = await analyzeBacklink(
				backlink.sourceUrl,
				ac.signal,
				(step) => setCurrentStep(step),
			)

			const publishable = result?.isBlog && result?.canComment
			const newStatus: BacklinkStatus = publishable ? 'publishable' : 'not_publishable'

			const updated = await updateBacklink({
				...backlink,
				status: newStatus,
				analysisLog: [result.summary || 'Analysis complete'],
			})

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

			setBacklinks(prev => prev.map(b => b.id === backlink.id ? updated : b))
		} catch (error) {
			if (ac.signal.aborted) return
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
		} finally {
			setAnalyzingId(null)
		}
	},
	[]
)
```

- [ ] **Step 3: Reset `analyzingId` in `reset`**

In the `reset` callback (line 118), add `setAnalyzingId(null)` to the body.

- [ ] **Step 4: Expose `analyzingId` in the return object**

Add `analyzingId` to the return object (line 170):

```ts
return {
	analyzingId,
	status,
	currentStep,
	currentIndex,
	batchSize,
	backlinks,
	isRunning,
	startAnalysis,
	stop,
	reset,
	reload,
	analyzeOne,
	addAndAnalyzeUrl,
}
```

- [ ] **Step 5: Verify build passes**

Run: `cd extension && npm run build`
Expected: Build succeeds (unused `analyzingId` warning is fine — will be used in next task).

- [ ] **Step 6: Commit**

```bash
git add extension/src/hooks/useBacklinkAgent.ts
git commit -m "feat: add analyzingId state to useBacklinkAgent hook"
```

---

### Task 3: Bridge `analyzingId` through App.tsx to BacklinkAnalysis

**Files:**
- Modify: `extension/src/entrypoints/sidepanel/App.tsx:32-44` (hook destructuring) and `158-176` (BacklinkAnalysis props)

- [ ] **Step 1: Destructure `analyzingId` from hook**

Add `analyzingId` to the useBacklinkAgent destructuring (after line 33):

```ts
const {
	analyzingId,
	currentStep: backlinkStep,
	currentIndex,
	batchSize,
	backlinks,
	isRunning: isBacklinkRunning,
	startAnalysis,
	analyzeOne: analyzeBacklink,
	stop: stopBacklinkAnalysis,
	reset: resetBacklinkAgent,
	reload: reloadBacklinks,
	addAndAnalyzeUrl,
} = useBacklinkAgent()
```

- [ ] **Step 2: Pass `analyzingId` to BacklinkAnalysis**

Add `analyzingId` prop to the `<BacklinkAnalysis>` component (line 158):

```tsx
<BacklinkAnalysis
	backlinks={backlinks}
	analyzingId={analyzingId}
	currentStep={backlinkStep}
	currentIndex={currentIndex}
	batchSize={batchSize}
	isRunning={isBacklinkRunning}
	onImportCsv={importBacklinksFromCsv}
	onReload={reloadBacklinks}
	onStartAnalysis={startAnalysis}
	onAnalyzeOne={analyzeBacklink}
	onAddUrl={addAndAnalyzeUrl}
	onStop={stopBacklinkAnalysis}
	onBack={() => {
		if (!isBacklinkRunning) resetBacklinkAgent()
		setView({ name: 'dashboard' })
	}}
/>
```

- [ ] **Step 3: Verify build passes**

Run: `cd extension && npm run build`
Expected: Type error because `BacklinkAnalysisProps` doesn't have `analyzingId` yet — this will be fixed in Task 4.

- [ ] **Step 4: Commit (combined with Task 4)**

Do not commit yet — commit together with the BacklinkAnalysis changes in Task 4.

---

### Task 4: Update BacklinkAnalysis — button loading state + enhanced progress + inline expand

This is the main UI task. All three parts are implemented together since they share the same component file.

**Files:**
- Modify: `extension/src/components/BacklinkAnalysis.tsx`

- [ ] **Step 1: Update props interface**

Replace the `BacklinkAnalysisProps` interface (lines 8-21) with:

```ts
interface BacklinkAnalysisProps {
	backlinks: BacklinkRecord[]
	analyzingId: string | null
	currentStep: AnalysisStep | null
	currentIndex: number
	batchSize: number
	isRunning: boolean
	onImportCsv: (csvText: string) => Promise<{ imported: number; skipped: number }>
	onReload: () => void
	onStartAnalysis: (count: number) => void
	onAnalyzeOne: (backlink: BacklinkRecord) => void
	onAddUrl: (url: string) => Promise<{ success: boolean; error?: string }>
	onStop: () => void
	onBack: () => void
}
```

- [ ] **Step 2: Update component destructuring**

Update the component function signature (line 36) to include `analyzingId`:

```ts
export function BacklinkAnalysis({
	backlinks,
	analyzingId,
	currentStep,
	currentIndex,
	batchSize,
	isRunning,
	onImportCsv,
	onReload,
	onStartAnalysis,
	onAnalyzeOne,
	onAddUrl,
	onStop,
	onBack,
}: BacklinkAnalysisProps) {
```

- [ ] **Step 3: Remove hardcoded `STEP_LABELS`, add `expandedId` state**

Remove `STEP_LABELS` constant (lines 30-34). Add `expandedId` state after line 58:

```ts
const [expandedId, setExpandedId] = useState<string | null>(null)
```

Add a helper to extract domain (inside the component, after the state declarations):

```ts
const getDomain = (url: string) => {
	try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}
```

Add a computed value for the currently analyzing backlink:

```ts
const analyzingBacklink = analyzingId ? backlinks.find(b => b.id === analyzingId) : null
```

- [ ] **Step 4: Replace the progress indicator section**

Replace the progress indicator block (lines 179-191) with enhanced progress:

```tsx
{/* Progress indicator */}
{(isRunning || analyzingId) && (
	<div className="px-3 py-1.5 flex items-center gap-1.5 text-xs text-muted-foreground border-b border-border/60">
		<span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
		{analyzingBacklink ? (
			<>
				{isRunning
					? t('backlink.analyzing', { current: currentIndex + 1, total: batchSize })
					: t('backlink.analyzingSingle', { domain: getDomain(analyzingBacklink.sourceUrl) })
				}
				{isRunning && (
					<span className="text-muted-foreground/80">
						{' — '}
						{getDomain(analyzingBacklink.sourceUrl)}
					</span>
				)}
				{currentStep && (
					<span className="text-muted-foreground/60">
						{' — '}
						{t(`backlink.step.${currentStep}` as any)}
					</span>
				)}
			</>
		) : isRunning ? (
			t('backlink.analyzingIn')
		) : null}
	</div>
)}
```

- [ ] **Step 5: Update table rows — row highlight + loading button + expandable row**

Replace the `<tbody>` content (lines 226-260) with:

```tsx
<tbody>
	{filteredBacklinks.map(b => {
		const isAnalyzing = analyzingId === b.id
		const isDisabled = analyzingId !== null || isRunning
		const isExpanded = expandedId === b.id

		return (
			<Fragment key={b.id}>
				<tr className={`border-b border-border/40 transition-colors ${isAnalyzing ? 'bg-blue-500/5' : 'hover:bg-accent/30'}`}>
					<td className="px-3 py-1.5 text-primary font-medium">{b.pageAscore}</td>
					<td className="px-3 py-1.5 overflow-hidden">
						<a
							href={b.sourceUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="truncate block text-primary hover:underline"
							title={b.sourceUrl}
						>
							{b.sourceTitle || b.sourceUrl}
						</a>
					</td>
					<td className="px-3 py-1.5">
						<span
							className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
								b.status !== 'pending' ? 'cursor-pointer hover:opacity-80' : 'cursor-default'
							} ${STATUS_COLORS[b.status]}`}
							title={(b.status === 'error' || b.status === 'not_publishable') && b.analysisLog?.length ? b.analysisLog.join('\n') : undefined}
							onClick={() => {
								if (b.status !== 'pending') {
									setExpandedId(isExpanded ? null : b.id)
								}
							}}
						>
							{t(`backlink.status.${b.status}` as any)}
						</span>
					</td>
					<td className="px-3 py-1.5 text-right">
						<Button
							variant="ghost"
							size="sm"
							className="text-xs h-6 px-2"
							disabled={isDisabled}
							onClick={() => onAnalyzeOne(b)}
						>
							{isAnalyzing ? (
								<span className="flex items-center gap-1">
									<svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
										<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
										<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
									</svg>
									{t('backlink.analyzingIn')}
								</span>
							) : (
								t('backlink.analyze')
							)}
						</Button>
					</td>
				</tr>
				{isExpanded && b.status !== 'pending' && b.analysisLog?.length > 0 && (
					<tr className="border-b border-border/40">
						<td colSpan={4} className="px-4 py-2">
							<div className={`text-xs rounded px-3 py-1.5 border-l-2 ${
								b.status === 'publishable' ? 'bg-green-500/5 border-green-400 text-green-300'
									: b.status === 'error' ? 'bg-red-500/5 border-red-400 text-red-300'
										: 'bg-red-500/5 border-red-400/70 text-red-300/80'
							}`}>
								{b.analysisLog.map((log, i) => (
									<div key={i}>{log}</div>
								))}
							</div>
						</td>
					</tr>
				)}
			</Fragment>
		)
	})}
</tbody>
```

**Important:** Add `Fragment` to the React import at line 3:

```ts
import { useRef, useState, Fragment } from 'react'
```

- [ ] **Step 6: Verify build passes**

Run: `cd extension && npm run build`
Expected: Build succeeds with no type errors.

- [ ] **Step 7: Commit (includes Task 3 changes)**

```bash
git add extension/src/components/BacklinkAnalysis.tsx extension/src/entrypoints/sidepanel/App.tsx
git commit -m "feat: add button loading state, enhanced progress, and inline log expand to backlink analysis"
```

---

### Task 5: Auto-expand log after single-item analysis

**Files:**
- Modify: `extension/src/components/BacklinkAnalysis.tsx`

- [ ] **Step 1: Add `useEffect` to auto-expand after analysis**

Add this import at the top of the file (update line 3):

```ts
import { useRef, useState, Fragment, useEffect } from 'react'
```

Add a ref to track the last completed analysis ID, and a useEffect after the `expandedId` state:

```ts
const lastAnalyzedRef = useRef<string | null>(null)

useEffect(() => {
	if (analyzingId) {
		lastAnalyzedRef.current = analyzingId
	} else if (lastAnalyzedRef.current) {
		// Analysis just completed — auto-expand if not in batch mode
		if (!isRunning) {
			setExpandedId(lastAnalyzedRef.current)
		}
		lastAnalyzedRef.current = null
	}
}, [analyzingId, isRunning])
```

- [ ] **Step 2: Verify build passes**

Run: `cd extension && npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add extension/src/components/BacklinkAnalysis.tsx
git commit -m "feat: auto-expand log detail after single-item backlink analysis"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** Part 1 (button loading) → Task 2 + Task 4. Part 2 (enhanced progress) → Task 1 + Task 4. Part 3 (inline expand) → Task 4 + Task 5.
- [x] **Placeholder scan:** All steps contain exact code. No TBD/TODO.
- [x] **Type consistency:** `analyzingId` is `string | null` throughout. `expandedId` is `string | null`. i18n keys match between en/zh sections.
