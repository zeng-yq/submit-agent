import type { ColumnDef, SheetDef } from './types'

/**
 * Convert a typed object to a flat row array matching column order.
 * - 'json' fields → JSON.stringify
 * - 'date' fields (timestamps) → ISO 8601 string (or empty string if undefined/null)
 * - other fields → string (or empty string if undefined/null)
 */
export function serializeRow(obj: Record<string, unknown>, columns: ColumnDef[]): string[] {
  return columns.map((col) => {
    const raw = obj[col.key]
    if (raw === undefined || raw === null) return ''
    if (col.encode === 'json') return JSON.stringify(raw)
    if (col.encode === 'date') {
      const num = Number(raw)
      return Number.isNaN(num) ? '' : new Date(num).toISOString()
    }
    return String(raw)
  })
}

/**
 * Convert a flat row array back to a typed object.
 * - 'json' fields → JSON.parse (returns original value on parse failure)
 * - 'date' fields (ISO strings) → timestamp number (returns undefined if empty/invalid)
 * - other fields → restored as-is (empty string → undefined)
 */
export function deserializeRow(row: string[], columns: ColumnDef[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {}
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i]
    const val = row[i] ?? ''
    if (val === '') {
      continue // leave field undefined
    }
    if (col.encode === 'json') {
      try {
        obj[col.key] = JSON.parse(val)
      } catch {
        obj[col.key] = val
      }
    } else if (col.encode === 'date') {
      const ts = new Date(val).getTime()
      obj[col.key] = Number.isNaN(ts) ? undefined : ts
    } else {
      obj[col.key] = val
    }
  }
  return obj
}

/**
 * Convert an array of typed objects into the format expected by Sheets API:
 * first row is headers, remaining rows are data.
 */
export function serializeSheet(
  records: Record<string, unknown>[],
  sheetDef: SheetDef
): string[][] {
  const header = sheetDef.columns.map((c) => c.header)
  const rows = records.map((r) => serializeRow(r, sheetDef.columns))
  return [header, ...rows]
}

/**
 * Convert Sheets API response (array of arrays, first row is headers)
 * back to an array of typed objects. Skips rows shorter than header count.
 */
export function deserializeSheet(
  values: string[][],
  sheetDef: SheetDef
): { records: Record<string, unknown>[]; skipped: number } {
  if (values.length <= 1) return { records: [], skipped: 0 }

  const columns = sheetDef.columns
  const records: Record<string, unknown>[] = []
  let skipped = 0

  for (let i = 1; i < values.length; i++) {
    const row = values[i]
    if (!row || row.length < columns.length) {
      skipped++
      continue
    }
    records.push(deserializeRow(row, columns))
  }

  return { records, skipped }
}
