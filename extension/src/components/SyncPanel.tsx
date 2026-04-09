import { useCallback, useEffect, useState } from 'react'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { useT } from '@/hooks/useLanguage'
import { listProducts, listSubmissions, listSites, listBacklinks } from '@/lib/db'
import { bulkPutProducts, bulkPutSubmissions, bulkPutSites, bulkPutBacklinks } from '@/lib/db'
import {
  exportToSheets,
  importFromSheets,
  isValidSheetUrl,
} from '@/lib/sync/sheets-client'

const SHEET_URL_KEY = 'submitAgent_sheetUrl'

async function getSheetUrl(): Promise<string> {
  const result = await chrome.storage.local.get(SHEET_URL_KEY)
  return (result[SHEET_URL_KEY] as string) ?? ''
}

async function setSheetUrl(url: string): Promise<void> {
  await chrome.storage.local.set({ [SHEET_URL_KEY]: url })
}

type SyncStatus =
  | { type: 'idle' }
  | { type: 'exporting' }
  | { type: 'importing' }
  | { type: 'success'; message: string; detail?: string }
  | { type: 'error'; message: string }

export function SyncPanel() {
  const t = useT()
  const [sheetUrl, setSheetUrlState] = useState('')
  const [status, setStatus] = useState<SyncStatus>({ type: 'idle' })
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    getSheetUrl().then(setSheetUrlState).then(() => setLoaded(true))
  }, [])

  const handleUrlChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSheetUrlState(e.target.value)
    setStatus({ type: 'idle' })
  }, [])

  const handleUrlBlur = useCallback(() => {
    setSheetUrl(sheetUrl)
  }, [sheetUrl])

  const handleExport = useCallback(async () => {
    if (!isValidSheetUrl(sheetUrl)) {
      setStatus({ type: 'error', message: t('sync.invalidUrl') })
      return
    }
    await setSheetUrl(sheetUrl)
    setStatus({ type: 'exporting' })

    try {
      const [products, submissions, sites, backlinks] = await Promise.all([
        listProducts(),
        listSubmissions(),
        listSites(),
        listBacklinks(),
      ])

      const result = await exportToSheets(sheetUrl, {
        products: products as unknown as Record<string, unknown>[],
        submissions: submissions as unknown as Record<string, unknown>[],
        sites: sites as unknown as Record<string, unknown>[],
        backlinks: backlinks as unknown as Record<string, unknown>[],
      })

      if (result.success) {
        const detail = t('sync.exportCounts', {
          products: result.counts['products'] ?? 0,
          submissions: result.counts['submissions'] ?? 0,
          sites: result.counts['sites'] ?? 0,
          backlinks: result.counts['backlinks'] ?? 0,
        })
        setStatus({ type: 'success', message: t('sync.exportSuccess'), detail })
      } else {
        setStatus({ type: 'error', message: result.error ?? t('sync.error', { error: 'Unknown' }) })
      }
    } catch (err) {
      setStatus({ type: 'error', message: t('sync.error', { error: String(err) }) })
    }
  }, [sheetUrl, t])

  const handleImport = useCallback(async () => {
    if (!isValidSheetUrl(sheetUrl)) {
      setStatus({ type: 'error', message: t('sync.invalidUrl') })
      return
    }
    await setSheetUrl(sheetUrl)
    setStatus({ type: 'importing' })

    try {
      const result = await importFromSheets(sheetUrl)

      if (result.success) {
        await Promise.all([
          bulkPutProducts(result.data.products as any),
          bulkPutSubmissions(result.data.submissions as any),
          bulkPutSites(result.data.sites as any),
          bulkPutBacklinks(result.data.backlinks as any),
        ])

        let detail = t('sync.importCounts', {
          products: result.counts['products'] ?? 0,
          submissions: result.counts['submissions'] ?? 0,
          sites: result.counts['sites'] ?? 0,
          backlinks: result.counts['backlinks'] ?? 0,
        })
        if (result.skipped > 0) {
          detail += `\n${t('sync.importSkipped', { skipped: result.skipped })}`
        }

        setStatus({ type: 'success', message: t('sync.importSuccess'), detail })
      } else {
        setStatus({ type: 'error', message: result.error ?? t('sync.error', { error: 'Unknown' }) })
      }
    } catch (err) {
      setStatus({ type: 'error', message: t('sync.error', { error: String(err) }) })
    }
  }, [sheetUrl, t])

  const isWorking = status.type === 'exporting' || status.type === 'importing'

  if (!loaded) return null

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-3">
      <div className="text-xs font-semibold text-foreground">{t('sync.title')}</div>

      <Input
        label={t('sync.sheetUrl')}
        placeholder={t('sync.sheetUrlPlaceholder')}
        value={sheetUrl}
        onChange={handleUrlChange}
        onBlur={handleUrlBlur}
        disabled={isWorking}
      />

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={!sheetUrl || isWorking}
          onClick={handleExport}
        >
          {status.type === 'exporting' ? t('sync.exporting') : t('sync.export')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={!sheetUrl || isWorking}
          onClick={handleImport}
        >
          {status.type === 'importing' ? t('sync.importing') : t('sync.import')}
        </Button>
      </div>

      {status.type === 'success' && (
        <div className="text-xs text-success bg-success/8 rounded-lg px-3 py-2 animate-in fade-in duration-200 space-y-0.5">
          <div className="font-medium">{status.message}</div>
          {status.detail && <div className="text-success/80 whitespace-pre-line">{status.detail}</div>}
        </div>
      )}

      {status.type === 'error' && (
        <div className="text-xs text-destructive bg-destructive/8 rounded-lg px-3 py-2 animate-in fade-in duration-200">
          {status.message}
        </div>
      )}
    </div>
  )
}
