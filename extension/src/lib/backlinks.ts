import type { BacklinkRecord } from './types'
import { getBacklinkByUrl, saveBacklink, getSiteByDomain } from './db'

/** Parse a CSV string into rows (handles quoted fields per RFC 4180) */
function parseCsv(csvText: string): Record<string, string>[] {
	// Strip UTF-8 BOM if present (common in Windows-exported CSVs)
	if (csvText.charCodeAt(0) === 0xFEFF) {
		csvText = csvText.slice(1)
	}

	const rows: Record<string, string>[] = []
	let currentRow: string[] = []
	let currentField = ''
	let inQuotes = false
	let i = 0

	while (i < csvText.length) {
		const char = csvText[i]

		if (inQuotes) {
			if (char === '"') {
				if (i + 1 < csvText.length && csvText[i + 1] === '"') {
					currentField += '"'
					i += 2
					continue
				}
				inQuotes = false
			} else {
				currentField += char
			}
		} else {
			if (char === '"') {
				inQuotes = true
			} else if (char === ',') {
				currentRow.push(currentField)
				currentField = ''
			} else if (char === '\r') {
				// Skip CR, handle CRLF
			} else if (char === '\n') {
				currentRow.push(currentField)
				currentField = ''
				if (currentRow.length > 0 && currentRow.some(f => f !== '')) {
					rows.push(currentRow)
				}
				currentRow = []
			} else {
				currentField += char
			}
		}
		i++
	}

	// Handle last field/row
	currentRow.push(currentField)
	if (currentRow.length > 0 && currentRow.some(f => f !== '')) {
		rows.push(currentRow)
	}

	if (rows.length < 2) return []

	const headers = rows[0]
	return rows.slice(1).map(row => {
		const record: Record<string, string> = {}
		for (let j = 0; j < headers.length; j++) {
			record[headers[j]] = row[j] ?? ''
		}
		return record
	})
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

		// Dedup by exact URL
		const existing = await getBacklinkByUrl(sourceUrl)
		if (existing) {
			skipped++
			continue
		}

		const domain = extractDomain(sourceUrl)
		const existingSite = await getSiteByDomain(domain)
		if (existingSite) {
			skipped++
			continue
		}

		const ascore = parseInt(row['Page ascore'] ?? '0', 10)
		await saveBacklink({
			sourceUrl,
			sourceTitle: row['Source title']?.trim() ?? '',
			pageAscore: isNaN(ascore) ? 0 : ascore,
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
