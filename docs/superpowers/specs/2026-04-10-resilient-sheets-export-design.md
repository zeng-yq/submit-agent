# Design: Resilient Google Sheets Export

**Date:** 2026-04-10
**Status:** Draft
**Scope:** `extension/src/lib/sync/` + `extension/src/components/SyncPanel.tsx`

## Problem

The current `exportToSheets` implementation has no resilience against network failures:

1. Each tab is cleared then written in a single API call — if the write fails, data is lost
2. Four tabs are processed sequentially — failure on tab 3 leaves tabs 1-2 overwritten and tabs 3-4 in an indeterminate state
3. No retry logic for transient failures (timeouts, 5xx, rate limits)
4. No timeout control on `fetch` calls
5. No progress feedback during upload
6. No way to cancel an in-progress export

For datasets >1000 rows per tab, a single large PUT request also risks hitting API size limits.

## Design

### Approach: Chunked Upload + Backup/Rollback

Keep the full-overwrite model but add chunking, retry, backup, and rollback.

### Phase 1: Backup

Before writing anything, read the current data from all 4 tabs via GET requests. Store backups in memory as `Map<tabName, string[][]>`.

### Phase 2: Chunked Upload

For each tab:
1. Clear the tab (ignore 404 — tab may not exist yet)
2. Serialize all records into rows
3. Split rows into chunks of `CHUNK_SIZE = 500` rows
4. Upload each chunk sequentially:
   - PUT to `/values/{tab}!A{startRow}?valueInputOption=USER_ENTERED`
   - On failure: retry up to `MAX_RETRIES = 3` times with exponential backoff (1s, 2s, 4s)
   - If a chunk fails all retries: mark the tab as failed, stop uploading remaining chunks for this tab

### Phase 3: Rollback on Failure

For any tab that failed to upload completely:
1. Use the backup data to write the original content back
2. If the rollback itself fails, log the error and report to the user

### Retry Strategy

```typescript
// Pseudocode for retry with error classification
async function sheetsFetchWithRetry(url, options, maxRetries = 3): Response {
  for attempt 0..maxRetries:
    abort after 30s timeout (AbortController)
    on 401: clear token, throw (no retry)
    on 429: read Retry-After header, wait, retry
    on 5xx: retry with exponential backoff
    on 4xx (other): no retry, throw
    on network error: retry with exponential backoff
}
```

| Error Type | Action |
|---|---|
| Network timeout/disconnect | Retry 3x, backoff |
| 401 Unauthorized | No retry, clear token, abort entire export |
| 429 Rate Limited | Read Retry-After, wait, retry |
| 5xx Server Error | Retry 3x, backoff |
| Other 4xx | No retry, fail this tab, rollback |

### Progress Reporting

`exportToSheets` accepts a `ProgressCallback`:

```typescript
interface ExportProgress {
  phase: 'backup' | 'upload' | 'rollback';
  currentTab: string;
  totalTabs: number;
  completedTabs: number;
  currentChunk: number;
  totalChunks: number;
  retriesLeft?: number;
  error?: string;
}

type ProgressCallback = (progress: ExportProgress) => void;
```

### UI Changes (SyncPanel.tsx)

- Display per-tab progress during export (waiting / uploading with % / completed / failed)
- Show backup and rollback phases
- Export button becomes "Cancel" button during upload (using AbortController)
- On failure: show which tabs succeeded, which failed, whether rollback succeeded
- Keep import flow as-is (import is less risky — it overwrites local IndexedDB which is easily re-synced)

### Constants

```typescript
const CHUNK_SIZE = 500;     // rows per chunk
const MAX_RETRIES = 3;      // retries per chunk
const FETCH_TIMEOUT = 30_000; // ms per request
```

### Files to Modify

| File | Change |
|---|---|
| `extension/src/lib/sync/sheets-client.ts` | Refactor `exportToSheets`: add backup phase, chunked upload, retry logic, rollback, progress callback |
| `extension/src/lib/sync/types.ts` | Add `ExportProgress` interface, `ProgressCallback` type |
| `extension/src/components/SyncPanel.tsx` | Add progress display UI, cancel button, detailed error reporting |

### What NOT to Change

- Import flow — lower risk (overwrites local data, easily re-synced from Sheets)
- Authentication flow (`google-auth.ts`) — already works correctly
- Serialization (`serializer.ts`) — row-level logic is fine, chunking happens after serialization
- Data model — no schema changes needed

### API Call Estimate

For a typical dataset (products 2000 rows, other tabs ~500 rows each):
- Backup: 4 GET requests
- Upload: 4 clear + ~7 PUT requests (products split into 4 chunks, others 1 chunk each)
- Total: ~15 API calls (vs. current 8, but each call is smaller and more reliable)

### Edge Cases

1. **Empty tab backup** — if a tab doesn't exist yet (GET returns error), backup is empty, rollback writes nothing
2. **Rollback failure** — log error, tell user to check Sheets manually
3. **User cancels mid-upload** — AbortController aborts current fetch, then rollback any tabs that were partially written
4. **All tabs fail** — rollback all, return error with details
5. **Auth expires mid-upload** — 401 handler clears token, aborts entire export, rolls back any completed tabs
