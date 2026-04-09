import { google } from 'googleapis'
import { SHEET_DEFS } from './types'
import type { SyncResult } from './types'
import { serializeSheet, deserializeSheet } from './serializer'
import { getAuthToken, removeCachedToken, createCredential } from './google-auth'

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
 * Export all data to Google Sheets.
 * For each data type, clears the tab (or creates it) and writes header + data rows.
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

  const auth = createCredential(token)
  const sheets = google.sheets({ version: 'v4', auth })
  const counts: Record<string, number> = {}

  try {
    for (const [dataType, records] of Object.entries(data)) {
      const sheetDef = SHEET_DEFS[dataType]
      if (!sheetDef) continue

      const rows = serializeSheet(records, sheetDef)
      const range = `${sheetDef.tabName}!A1`

      await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: sheetDef.tabName,
      })

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: rows },
      })

      counts[dataType] = records.length
    }

    return { success: true, counts }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('401')) {
      await removeCachedToken(token)
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

  const auth = createCredential(token)
  const sheets = google.sheets({ version: 'v4', auth })
  const data: Record<string, Record<string, unknown>[]> = {}
  const counts: Record<string, number> = {}
  let totalSkipped = 0

  try {
    for (const [dataType, sheetDef] of Object.entries(SHEET_DEFS)) {
      const range = `${sheetDef.tabName}!A1:Z`
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
      })

      const values = response.data.values as string[][] | undefined
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
      await removeCachedToken(token)
      return { success: false, counts: {}, data: {}, skipped: 0, error: 'Authentication expired. Please try again.' }
    }
    return { success: false, counts: {}, data: {}, skipped: 0, error: msg }
  }
}
