import type { BacklinkRecord } from './types'
import { getBacklinkByUrl, saveBacklink } from './db'

/** Parse a CSV string into rows (handles quoted fields) */
function parseCsv(csvText: string): Record<string, string>[] {
	const lines = csvText.split(/\r?\n/)
	if (lines.length < 2) return []

	// Parse header
	const headers = parseCsvLine(lines[0])

	const rows: Record<string, string>[] = []
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i].trim()
		if (!line) continue
		const values = parseCsvLine(line)
		const row: Record<string, string> = {}
		for (let j = 0; j < headers.length; j++) {
			row[headers[j]] = values[j] ?? ''
		}
		rows.push(row)
	}
	return rows
}

/** Parse a single CSV line respecting quoted fields */
function parseCsvLine(line: string): string[] {
	const fields: string[] = []
	let current = ''
	let inQuotes = false

	for (let i = 0; i < line.length; i++) {
		const char = line[i]
		if (inQuotes) {
			if (char === '"') {
				if (i + 1 < line.length && line[i + 1] === '"') {
					current += '"'
					i++
				} else {
					inQuotes = false
				}
			} else {
				current += char
			}
		} else {
			if (char === '"') {
				inQuotes = true
			} else if (char === ',') {
				fields.push(current)
				current = ''
			} else {
				current += char
			}
		}
	}
	fields.push(current)
	return fields
}

export interface ImportResult {
	imported: number
	skipped: number
}

/** Parse Semrush CSV and import new backlinks into IndexedDB (dedup by sourceUrl) */
export async function importBacklinksFromCsv(csvText: string): Promise<ImportResult> {
	const rows = parseCsv(csvText)
	let imported = 0
	let skipped = 0

	for (const row of rows) {
		const sourceUrl = row['Source url']?.trim()
		if (!sourceUrl) continue

		// Dedup check
		const existing = await getBacklinkByUrl(sourceUrl)
		if (existing) {
			skipped++
			continue
		}

		const ascore = parseInt(row['Page ascore'] ?? '0', 10)
		const nofollow = (row['Nofollow'] ?? '').toLowerCase().trim() === 'true'

		await saveBacklink({
			sourceUrl,
			sourceTitle: row['Source title']?.trim() ?? '',
			pageAscore: isNaN(ascore) ? 0 : ascore,
			nofollow,
			targetUrl: row['Target url']?.trim() ?? '',
			status: 'pending',
			analysisLog: [],
		})
		imported++
	}

	return { imported, skipped }
}

/** Extract domain name from a URL */
export function extractDomain(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '')
	} catch {
		return url
	}
}
