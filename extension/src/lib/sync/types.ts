/** Describes how a single field maps to a sheet column */
export interface ColumnDef {
  /** Header name in the sheet */
  header: string
  /** Key on the data object */
  key: string
  /** Encoding for complex types */
  encode?: 'json' | 'date'
}

/** Column definitions for each data type */
export interface SheetDef {
  /** Tab name in Google Sheet */
  tabName: string
  columns: ColumnDef[]
}

export interface SyncResult {
  success: boolean
  counts: Record<string, number>
  error?: string
}

/** Progress information reported during export */
export interface ExportProgress {
  phase: 'backup' | 'upload' | 'rollback'
  currentTab: string
  totalTabs: number
  completedTabs: number
  currentChunk: number
  totalChunks: number
  retriesLeft?: number
  error?: string
}

/** Callback to receive export progress updates */
export type ProgressCallback = (progress: ExportProgress) => void

/** Extended result with per-tab success/failure info */
export interface ExportResult extends SyncResult {
  failedTabs?: string[]
  rolledBack?: string[]
  rollbackFailed?: string[]
}

/** All four sheet definitions */
export const SHEET_DEFS: Record<string, SheetDef> = {
  products: {
    tabName: 'products',
    columns: [
      { header: 'id', key: 'id' },
      { header: 'name', key: 'name' },
      { header: 'url', key: 'url' },
      { header: 'tagline', key: 'tagline' },
      { header: 'shortDesc', key: 'shortDesc' },
      { header: 'longDesc', key: 'longDesc' },
      { header: 'categories', key: 'categories', encode: 'json' },
      { header: 'logoSquare', key: 'logoSquare' },
      { header: 'logoBanner', key: 'logoBanner' },
      { header: 'screenshots', key: 'screenshots', encode: 'json' },
      { header: 'founderName', key: 'founderName' },
      { header: 'founderEmail', key: 'founderEmail' },
      { header: 'socialLinks', key: 'socialLinks', encode: 'json' },
      { header: 'createdAt', key: 'createdAt', encode: 'date' },
      { header: 'updatedAt', key: 'updatedAt', encode: 'date' },
    ],
  },
  submissions: {
    tabName: 'submissions',
    columns: [
      { header: 'id', key: 'id' },
      { header: 'siteName', key: 'siteName' },
      { header: 'productId', key: 'productId' },
      { header: 'status', key: 'status' },
      { header: 'rewrittenDesc', key: 'rewrittenDesc' },
      { header: 'submittedAt', key: 'submittedAt', encode: 'date' },
      { header: 'notes', key: 'notes' },
      { header: 'error', key: 'error' },
      { header: 'failedAt', key: 'failedAt', encode: 'date' },
      { header: 'createdAt', key: 'createdAt', encode: 'date' },
      { header: 'updatedAt', key: 'updatedAt', encode: 'date' },
    ],
  },
  sites: {
    tabName: 'sites',
    columns: [
      { header: 'name', key: 'name' },
      { header: 'submit_url', key: 'submit_url' },
      { header: 'category', key: 'category' },
      { header: 'lang', key: 'lang' },
      { header: 'dr', key: 'dr' },
      { header: 'status', key: 'status' },
      { header: 'createdAt', key: 'createdAt', encode: 'date' },
      { header: 'updatedAt', key: 'updatedAt', encode: 'date' },
    ],
  },
}
