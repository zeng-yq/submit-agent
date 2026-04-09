import { SHEET_DEFS } from './types'
import type { SyncResult } from './types'
import { serializeSheet, deserializeSheet } from './serializer'
import { getAuthToken, removeCachedToken } from './google-auth'

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'

const CHUNK_SIZE = 500
const MAX_RETRIES = 3
const FETCH_TIMEOUT = 30_000

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
 * Export all data to Google Sheets.
 * For each data type, creates the tab (if missing), clears it, and writes header + data rows.
 */
export async function exportToSheets(
  sheetUrl: string,
  data: Record<string, Record<string, unknown>[]>
): Promise<SyncResult> {
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

  const counts: Record<string, number> = {}

  try {
    // Collect all needed tab names and create missing ones
    const neededTabs: string[] = []
    for (const [dataType] of Object.entries(data)) {
      const sheetDef = SHEET_DEFS[dataType]
      if (sheetDef) neededTabs.push(sheetDef.tabName)
    }
    for (const tabName of neededTabs) {
      await ensureSheetTab(token, spreadsheetId, tabName)
    }
    // Get fresh token in case it was refreshed
    token = await getAuthToken()

    for (const [dataType, records] of Object.entries(data)) {
      const sheetDef = SHEET_DEFS[dataType]
      if (!sheetDef) continue

      const rows = serializeSheet(records, sheetDef)
      const range = encodeURIComponent(`${sheetDef.tabName}!A1`)

      // Clear existing data in the tab
      try {
        await sheetsFetch(token, `${spreadsheetId}/values/${encodeURIComponent(sheetDef.tabName)}:clear`, {
          method: 'POST',
        })
      } catch {
        // Tab might not exist yet, ignore clear errors
      }

      // Write header + data rows
      await sheetsFetch(token, `${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`, {
        method: 'PUT',
        body: JSON.stringify({ values: rows }),
      })

      counts[dataType] = records.length
    }

    return { success: true, counts }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('401')) {
      return { success: false, counts, error: 'Authentication expired. Please try again.' }
    }
    return { success: false, counts, error: msg }
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
