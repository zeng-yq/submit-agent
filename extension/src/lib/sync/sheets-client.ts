import { SHEET_DEFS } from './types'
import type { SyncResult, ExportProgress, ProgressCallback, ExportResult } from './types'
import { serializeSheet, deserializeSheet } from './serializer'
import { getAuthToken, removeCachedToken } from './google-auth'

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'

const CHUNK_SIZE = 500
const MAX_RETRIES = 3
const FETCH_TIMEOUT = 30_000
const TAB_DELAY_MS = 2_000

/**
 * Extract spreadsheet ID from a Google Sheet URL.
 * Handles URLs like:
 *   https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
 *   https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/
 */
export function parseSheetUrl(url: string): string | null {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

/**
 * Validate that a string looks like a Google Sheet URL.
 */
export function isValidSheetUrl(url: string): boolean {
  return !!parseSheetUrl(url)
}

/**
 * Helper to make authenticated requests to Google Sheets API.
 */
async function sheetsFetch(token: string, path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${SHEETS_BASE}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  if (res.status === 401) {
    await removeCachedToken(token)
    throw new Error('401')
  }
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`HTTP ${res.status}: ${body}`)
  }
  return res
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Fetch with retry, timeout, and error classification.
 * - 401: no retry, clear token, throw
 * - 429: read Retry-After, wait, retry
 * - 5xx: retry with exponential backoff
 * - other 4xx: no retry, throw
 * - network error / AbortError: retry with exponential backoff
 */
async function sheetsFetchWithRetry(
  token: string,
  path: string,
  init?: RequestInit,
  maxRetries: number = MAX_RETRIES,
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT)

    try {
      const res = await fetch(`${SHEETS_BASE}/${path}`, {
        ...init,
        signal: init?.signal ?? controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...init?.headers,
        },
      })
      clearTimeout(timeoutId)

      if (res.status === 401) {
        await removeCachedToken(token)
        throw new Error('401')
      }

      if (res.status === 429) {
        if (attempt < maxRetries) {
          const retryAfter = parseInt(res.headers.get('Retry-After') || '5')
          await sleep(retryAfter * 1000)
          continue
        }
        const body = await res.text()
        throw new Error(`HTTP 429: ${body}`)
      }

      if (res.status >= 500) {
        if (attempt < maxRetries) {
          await sleep(1000 * Math.pow(2, attempt))
          continue
        }
        const body = await res.text()
        throw new Error(`HTTP ${res.status}: ${body}`)
      }

      if (!res.ok) {
        const body = await res.text()
        throw new Error(`HTTP ${res.status}: ${body}`)
      }

      return res
    } catch (err) {
      clearTimeout(timeoutId)
      if (err instanceof Error && err.message === '401') throw err
      if (attempt < maxRetries) {
        await sleep(1000 * Math.pow(2, attempt))
        continue
      }
      throw err
    }
  }

  throw new Error('Max retries exceeded')
}

/**
 * Ensure a sheet tab exists. Creates it via batchUpdate if missing.
 */
async function ensureSheetTab(token: string, spreadsheetId: string, tabName: string): Promise<void> {
  // Get existing sheet names
  const meta = await sheetsFetch(token, `${spreadsheetId}?fields=sheets.properties.title`)
  const body = await meta.json()
  const existingTitles = new Set(
    (body.sheets as Array<{ properties: { title: string } }>)?.map(s => s.properties.title) ?? [],
  )
  if (existingTitles.has(tabName)) return

  // Create missing tab
  await sheetsFetch(token, `${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title: tabName } } }],
    }),
  })
}

/**
 * Ensure a sheet tab has enough rows to hold the data.
 * Google Sheets defaults to 1000 rows; this expands the grid if needed.
 */
async function ensureSheetCapacity(
  token: string,
  spreadsheetId: string,
  tabName: string,
  requiredRows: number,
): Promise<void> {
  const meta = await sheetsFetch(
    token,
    `${spreadsheetId}?fields=sheets.properties(sheetId,title,gridProperties)`,
  )
  const body = await meta.json()
  const sheets = body.sheets as Array<{
    properties: {
      sheetId: number
      title: string
      gridProperties?: { rowCount?: number }
    }
  }> | undefined

  const sheet = sheets?.find(s => s.properties.title === tabName)
  if (!sheet) return

  const currentRows = sheet.properties.gridProperties?.rowCount ?? 1000
  if (currentRows >= requiredRows) return

  await sheetsFetch(token, `${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [{
        updateSheetProperties: {
          properties: {
            sheetId: sheet.properties.sheetId,
            gridProperties: { rowCount: requiredRows },
          },
          fields: 'gridProperties.rowCount',
        },
      }],
    }),
  })
}

/**
 * Read current tab content for backup. Returns empty array if tab doesn't exist.
 */
async function backupTab(
  token: string,
  spreadsheetId: string,
  tabName: string,
): Promise<string[][]> {
  try {
    const range = encodeURIComponent(`${tabName}!A1:Z`)
    const res = await sheetsFetch(token, `${spreadsheetId}/values/${range}`)
    const body = await res.json()
    return (body.values as string[][]) ?? []
  } catch {
    return []
  }
}

/**
 * Upload a single tab's data in chunks with retry.
 * Returns true on success, false on failure.
 */
async function uploadTabChunked(
  token: string,
  spreadsheetId: string,
  tabName: string,
  rows: string[][],
  onProgress?: ProgressCallback,
  abortSignal?: AbortSignal,
): Promise<{ success: boolean; error?: string }> {
  // Clear existing data
  try {
    await sheetsFetchWithRetry(
      token,
      `${spreadsheetId}/values/${encodeURIComponent(tabName)}:clear`,
      { method: 'POST', signal: abortSignal },
    )
  } catch {
    // Tab might not exist yet, ignore clear errors
  }

  if (rows.length === 0) return { success: true }

  // Split rows into chunks
  const chunks: string[][][] = []
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    chunks.push(rows.slice(i, i + CHUNK_SIZE))
  }

  for (let c = 0; c < chunks.length; c++) {
    if (abortSignal?.aborted) return { success: false, error: 'Cancelled' }

    const chunkRows = chunks[c]
    const startRow = c * CHUNK_SIZE + 1
    const range = encodeURIComponent(`${tabName}!A${startRow}`)

    try {
      await sheetsFetchWithRetry(
        token,
        `${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          body: JSON.stringify({ values: chunkRows }),
          signal: abortSignal,
        },
      )
    } catch (err) {
      // 401 means auth is gone — re-throw so the caller aborts the entire export
      if (err instanceof Error && err.message === '401') throw err
      const errMsg = err instanceof Error ? err.message : String(err)
      onProgress?.({
        phase: 'upload',
        currentTab: tabName,
        totalTabs: 0,
        completedTabs: 0,
        currentChunk: c + 1,
        totalChunks: chunks.length,
        error: errMsg,
      })
      return { success: false, error: errMsg }
    }
  }

  return { success: true }
}

/**
 * Export all data to Google Sheets with backup, chunked upload, and rollback.
 */
export async function exportToSheets(
  sheetUrl: string,
  data: Record<string, Record<string, unknown>[]>,
  onProgress?: ProgressCallback,
  abortSignal?: AbortSignal,
): Promise<ExportResult> {
  const spreadsheetId = parseSheetUrl(sheetUrl)
  if (!spreadsheetId) {
    return { success: false, counts: {}, error: 'Invalid Google Sheet URL' }
  }

  let token: string
  try {
    token = await getAuthToken()
  } catch (err) {
    return { success: false, counts: {}, error: `Authentication failed: ${String(err)}` }
  }

  const tabEntries: Array<{ dataType: string; tabName: string }> = []
  for (const [dataType] of Object.entries(data)) {
    const sheetDef = SHEET_DEFS[dataType]
    if (sheetDef) tabEntries.push({ dataType, tabName: sheetDef.tabName })
  }

  // ---- Phase 1: Create tabs & Backup ----
  try {
    for (const { tabName } of tabEntries) {
      if (abortSignal?.aborted) {
        return { success: false, counts: {}, error: 'Cancelled' }
      }
      await ensureSheetTab(token, spreadsheetId, tabName)
    }
    token = await getAuthToken()
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('401')) {
      return { success: false, counts: {}, error: 'Authentication expired. Please try again.' }
    }
    return { success: false, counts: {}, error: msg }
  }

  const backups = new Map<string, string[][]>()
  for (const { tabName } of tabEntries) {
    if (abortSignal?.aborted) {
      return { success: false, counts: {}, error: 'Cancelled' }
    }
    onProgress?.({
      phase: 'backup',
      currentTab: tabName,
      totalTabs: tabEntries.length,
      completedTabs: 0,
      currentChunk: 0,
      totalChunks: 0,
    })
    const backup = await backupTab(token, spreadsheetId, tabName)
    backups.set(tabName, backup)
  }

  // ---- Phase 2: Chunked Upload ----
  const counts: Record<string, number> = {}
  const failedTabs: string[] = []
  const failedTabErrors: Record<string, string> = {}
  const succeededTabs: string[] = []

  let authExpired = false
  for (let i = 0; i < tabEntries.length; i++) {
    const { dataType, tabName } = tabEntries[i]
    if (abortSignal?.aborted || authExpired) break

    // 首个 tab 不等待，后续 tab 间添加延迟让 API 配额恢复
    if (i > 0) await sleep(TAB_DELAY_MS)

    const sheetDef = SHEET_DEFS[dataType]!
    const records = data[dataType] ?? []
    const rows = serializeSheet(records, sheetDef)
    const totalChunks = Math.ceil(rows.length / CHUNK_SIZE)

    // 扩展 sheet 网格行数以容纳所有数据（默认上限 1000 行）
    await ensureSheetCapacity(token, spreadsheetId, tabName, rows.length)

    onProgress?.({
      phase: 'upload',
      currentTab: tabName,
      totalTabs: tabEntries.length,
      completedTabs: i,
      currentChunk: 0,
      totalChunks,
    })

    try {
      const result = await uploadTabChunked(
        token,
        spreadsheetId,
        tabName,
        rows,
        onProgress,
        abortSignal,
      )

      if (result.success) {
        counts[dataType] = records.length
        succeededTabs.push(tabName)
      } else {
        failedTabs.push(tabName)
        if (result.error) failedTabErrors[tabName] = result.error
      }
    } catch (err) {
      // 401 from uploadTabChunked — abort entire export, proceed to rollback
      if (err instanceof Error && err.message === '401') {
        authExpired = true
        failedTabs.push(tabName)
        break
      }
      throw err
    }
  }

  // ---- Phase 3: Rollback failed tabs ----
  const rolledBack: string[] = []
  const rollbackFailed: string[] = []

  if (failedTabs.length > 0 || abortSignal?.aborted) {
    const tabsToRollback = abortSignal?.aborted
      ? [...failedTabs, ...succeededTabs]
      : failedTabs

    for (const tabName of tabsToRollback) {
      const backup = backups.get(tabName)
      if (!backup || backup.length === 0) {
        try {
          await sheetsFetch(
            token,
            `${spreadsheetId}/values/${encodeURIComponent(tabName)}:clear`,
            { method: 'POST' },
          )
          rolledBack.push(tabName)
        } catch {
          rollbackFailed.push(tabName)
        }
        continue
      }

      onProgress?.({
        phase: 'rollback',
        currentTab: tabName,
        totalTabs: tabsToRollback.length,
        completedTabs: rolledBack.length + rollbackFailed.length,
        currentChunk: 0,
        totalChunks: 0,
      })

      try {
        const range = encodeURIComponent(`${tabName}!A1`)
        await sheetsFetch(
          token,
          `${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`,
          { method: 'PUT', body: JSON.stringify({ values: backup }) },
        )
        rolledBack.push(tabName)
      } catch {
        rollbackFailed.push(tabName)
      }
    }
  }

  // Build result
  const wasCancelled = abortSignal?.aborted ?? false
  if (failedTabs.length === 0 && !wasCancelled) {
    return { success: true, counts }
  }

  const parts: string[] = []
  if (authExpired) parts.push('Authentication expired. Please try again.')
  if (wasCancelled) parts.push('Export cancelled.')
  if (failedTabs.length > 0) {
    const details = failedTabs.map(t => failedTabErrors[t] ? `${t} (${failedTabErrors[t]})` : t)
    parts.push(`Failed tabs: ${details.join(', ')}`)
  }
  if (rolledBack.length > 0) parts.push(`Rolled back: ${rolledBack.join(', ')}`)
  if (rollbackFailed.length > 0) {
    parts.push(`Rollback failed (check manually): ${rollbackFailed.join(', ')}`)
  }

  return {
    success: false,
    counts,
    error: parts.join(' '),
    failedTabs,
    rolledBack,
    rollbackFailed,
  }
}

/**
 * Import all data from Google Sheets.
 * Reads each tab, deserializes rows into typed objects.
 */
export async function importFromSheets(
  sheetUrl: string
): Promise<SyncResult & { data: Record<string, Record<string, unknown>[]>; skipped: number }> {
  const spreadsheetId = parseSheetUrl(sheetUrl)
  if (!spreadsheetId) {
    return { success: false, counts: {}, error: 'Invalid Google Sheet URL', data: {}, skipped: 0 }
  }

  let token: string
  try {
    token = await getAuthToken()
  } catch (err) {
    return { success: false, counts: {}, error: `Authentication failed: ${String(err)}`, data: {}, skipped: 0 }
  }

  const data: Record<string, Record<string, unknown>[]> = {}
  const counts: Record<string, number> = {}
  let totalSkipped = 0

  try {
    for (const [dataType, sheetDef] of Object.entries(SHEET_DEFS)) {
      const range = encodeURIComponent(`${sheetDef.tabName}!A1:Z`)
      const res = await sheetsFetch(token, `${spreadsheetId}/values/${range}`)
      const body = await res.json()
      const values = body.values as string[][] | undefined

      if (!values || values.length === 0) {
        data[dataType] = []
        counts[dataType] = 0
        continue
      }

      const { records, skipped } = deserializeSheet(values, sheetDef)
      data[dataType] = records
      counts[dataType] = records.length
      totalSkipped += skipped
    }

    return { success: true, counts, data, skipped: totalSkipped }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('401')) {
      return { success: false, counts, data: {}, skipped: 0, error: 'Authentication expired. Please try again.' }
    }
    return { success: false, counts, data: {}, skipped: 0, error: msg }
  }
}
