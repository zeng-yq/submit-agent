import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Textarea } from './ui/Textarea'
import { listProducts, listSubmissions, listSites } from '@/lib/db'
import { bulkPutProducts, bulkPutSubmissions, bulkPutSites } from '@/lib/db'
import {
  exportToSheets,
  importFromSheets,
  isValidSheetUrl,
} from '@/lib/sync/sheets-client'
import {
  setServiceAccountKey,
  getServiceAccountEmail,
  getServiceAccountJson,
  isOAuthConfigured,
  clearServiceAccountKey,
  removeCachedToken,
} from '@/lib/sync/google-auth'
import type { ExportProgress } from '@/lib/sync/types'
import { SHEET_DEFS } from '@/lib/sync/types'

const SHEET_URL_KEY = 'submitAgent_sheetUrl'

async function getSheetUrl(): Promise<string> {
  const result = await chrome.storage.local.get(SHEET_URL_KEY)
  return (result[SHEET_URL_KEY] as string) ?? 'https://docs.google.com/spreadsheets/d/1bNHx-9ArYgfyigme7I6A3enH6ZUgrELYpCevv_gFZkU/edit?gid=335758461#gid=335758461'
}

async function setSheetUrl(url: string): Promise<void> {
  await chrome.storage.local.set({ [SHEET_URL_KEY]: url })
}

const TAB_NAMES = (Object.values(SHEET_DEFS) as Array<{ tabName: string }>).map(d => d.tabName)

type TabUploadStatus = 'waiting' | 'uploading' | 'complete' | 'failed'

type TabProgress = {
  status: TabUploadStatus
  percent: number
}

type SyncStatus =
  | { type: 'idle' }
  | { type: 'exporting'; phase: ExportProgress['phase']; tabs: Record<string, TabProgress> }
  | { type: 'importing' }
  | { type: 'success'; message: string; detail?: string }
  | { type: 'error'; message: string }

export function SyncPanel({ onDataImported }: { onDataImported?: () => void }) {
  const [sheetUrl, setSheetUrlState] = useState('')
  const [status, setStatus] = useState<SyncStatus>({ type: 'idle' })
  const [loaded, setLoaded] = useState(false)

  // Service account state
  const [saEmail, setSaEmail] = useState('')
  const [saConfigured, setSaConfigured] = useState(false)
  const [showSaConfig, setShowSaConfig] = useState(false)
  const [saJsonInput, setSaJsonInput] = useState('')
  const [saInputError, setSaInputError] = useState('')
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    Promise.all([
      getSheetUrl(),
      isOAuthConfigured(),
      getServiceAccountEmail(),
      getServiceAccountJson(),
    ]).then(([url, configured, email, json]) => {
      setSheetUrlState(url)
      setSaConfigured(configured)
      setSaEmail(email)
      if (configured && !saJsonInput) setSaJsonInput(json)
      if (!configured) setShowSaConfig(true)
      setLoaded(true)
    })
  }, [])

  const handleUrlChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSheetUrlState(e.target.value)
    setStatus({ type: 'idle' })
  }, [])

  const handleUrlBlur = useCallback(() => {
    setSheetUrl(sheetUrl)
  }, [sheetUrl])

  const handleSaJsonChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setSaJsonInput(e.target.value)
    setSaInputError('')
  }, [])

  const handleSaJsonBlur = useCallback(async () => {
    if (!saJsonInput.trim()) return
    try {
      const email = await setServiceAccountKey(saJsonInput.trim())
      setSaEmail(email)
      setSaConfigured(true)
      setSaJsonInput('')
    } catch (err) {
      setSaInputError(err instanceof Error ? err.message : String(err))
    }
  }, [saJsonInput])

  const handleDisconnect = useCallback(async () => {
    await clearServiceAccountKey()
    await removeCachedToken()
    setSaConfigured(false)
    setSaEmail('')
    setShowSaConfig(true)
  }, [])

  const handleExportProgress = useCallback(
    (progress: ExportProgress) => {
      setStatus((prev) => {
        if (prev.type !== 'exporting') return prev
        const tabs = { ...prev.tabs }
        if (progress.phase === 'upload') {
          if (!tabs[progress.currentTab]) {
            tabs[progress.currentTab] = { status: 'waiting', percent: 0 }
          }
          const percent =
            progress.totalChunks > 0
              ? Math.round((progress.currentChunk / progress.totalChunks) * 100)
              : 0
          tabs[progress.currentTab] = {
            status: progress.error ? 'failed' : 'uploading',
            percent,
          }
        }
        if (progress.phase === 'upload' && progress.completedTabs > 0) {
          const completed = TAB_NAMES.slice(0, progress.completedTabs)
          for (const name of completed) {
            if (tabs[name]?.status !== 'failed') {
              tabs[name] = { status: 'complete', percent: 100 }
            }
          }
        }
        return { ...prev, phase: progress.phase, tabs }
      })
    },
    [],
  )

  const handleCancelExport = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
  }, [])

  const handleExport = useCallback(async () => {
    if (!isValidSheetUrl(sheetUrl)) {
      setStatus({ type: 'error', message: '请输入有效的 Google Sheet 链接' })
      return
    }
    if (!saConfigured) {
      setShowSaConfig(true)
      setStatus({ type: 'error', message: '请先配置服务账号。' })
      return
    }
    await setSheetUrl(sheetUrl)

    const abortController = new AbortController()
    abortControllerRef.current = abortController

    const initialTabs: Record<string, TabProgress> = {}
    for (const name of TAB_NAMES) {
      initialTabs[name] = { status: 'waiting', percent: 0 }
    }
    setStatus({ type: 'exporting', phase: 'backup', tabs: initialTabs })

    try {
      const [products, submissions, sites] = await Promise.all([
        listProducts(),
        listSubmissions(),
        listSites(),
      ])

      const result = await exportToSheets(
        sheetUrl,
        {
          products: products as unknown as Record<string, unknown>[],
          submissions: submissions as unknown as Record<string, unknown>[],
          sites: sites as unknown as Record<string, unknown>[],
        },
        handleExportProgress,
        abortController.signal,
      )

      if (result.success) {
        const detail = `产品: ${result.counts['products'] ?? 0}, 提交记录: ${result.counts['submissions'] ?? 0}, 站点: ${result.counts['sites'] ?? 0}`
        setStatus({ type: 'success', message: '导出完成', detail })
      } else {
        setStatus({
          type: 'error',
          message: result.error ?? `同步错误: Unknown`,
        })
      }
    } catch (err) {
      if (abortController.signal.aborted) {
        setStatus({ type: 'error', message: '导出已取消' })
      } else {
        setStatus({ type: 'error', message: `同步错误: ${String(err)}` })
      }
    } finally {
      abortControllerRef.current = null
    }
  }, [sheetUrl, saConfigured, handleExportProgress])

  const handleImport = useCallback(async () => {
    if (!isValidSheetUrl(sheetUrl)) {
      setStatus({ type: 'error', message: '请输入有效的 Google Sheet 链接' })
      return
    }
    if (!saConfigured) {
      setShowSaConfig(true)
      setStatus({ type: 'error', message: '请先配置服务账号。' })
      return
    }
    await setSheetUrl(sheetUrl)
    setStatus({ type: 'importing' })

    try {
      const result = await importFromSheets(sheetUrl)

      if (result.success) {
        // Ensure records have required IDB keyPath fields
        const products = (result.data.products as Record<string, unknown>[]).map(r => r.id ? r : { ...r, id: crypto.randomUUID() })
        const submissions = (result.data.submissions as Record<string, unknown>[]).map(r => r.id ? r : { ...r, id: crypto.randomUUID() })
        await Promise.all([
          bulkPutProducts(products as any),
          bulkPutSubmissions(submissions as any),
          bulkPutSites(result.data.sites as any),
        ])

        let detail = `产品: ${result.counts['products'] ?? 0}, 提交记录: ${result.counts['submissions'] ?? 0}, 站点: ${result.counts['sites'] ?? 0}`
        if (result.skipped > 0) {
          detail += `\n${result.skipped} 行因格式无效被跳过`
        }

        setStatus({ type: 'success', message: '导入完成', detail })
        onDataImported?.()
      } else {
        setStatus({ type: 'error', message: result.error ?? `同步错误: Unknown` })
      }
    } catch (err) {
      setStatus({ type: 'error', message: `同步错误: ${String(err)}` })
    }
  }, [sheetUrl, saConfigured, onDataImported])

  const isWorking = status.type === 'exporting' || status.type === 'importing'
  const isExporting = status.type === 'exporting'

  if (!loaded) return null

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-3">
      <div className="text-xs font-semibold text-foreground">{'数据同步'}</div>

      {/* Service Account Configuration */}
      <button
        type="button"
        className="w-full flex items-center justify-between text-xs text-foreground/80 hover:text-foreground transition-colors"
        onClick={() => setShowSaConfig(!showSaConfig)}
      >
        <span>{'服务账号'}</span>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${saConfigured ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive'}`}>
            {saConfigured ? '已连接' : '未配置'}
          </span>
          <svg className={`w-3.5 h-3.5 transition-transform ${showSaConfig ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {showSaConfig && (
        <div className="space-y-2 pl-0.5">
          <Textarea
            label={'服务账号 JSON 密钥'}
            placeholder={'粘贴你的服务账号 JSON 密钥...'}
            value={saJsonInput}
            onChange={handleSaJsonChange}
            onBlur={handleSaJsonBlur}
            disabled={isWorking}
            rows={4}
          />
          {saInputError && (
            <div className="text-[11px] text-destructive">{saInputError}</div>
          )}
          {saConfigured && saEmail && (
            <div className="space-y-1">
              <div className="text-[11px] text-foreground/60">{'服务账号邮箱（将 Sheet 分享给此地址）'}</div>
              <div className="text-[11px] font-mono text-foreground/80 bg-foreground/5 rounded px-2 py-1 break-all select-all">
                {saEmail}
              </div>
            </div>
          )}
          <div className="text-[10px] text-foreground/50 leading-relaxed">{'Google Cloud Console → IAM 与管理员 → 服务账号 → 创建服务账号 → 密钥 → 添加密钥 (JSON)。下载后将 JSON 内容粘贴到上方。'}</div>
          {saConfigured && (
            <button
              type="button"
              className="text-[11px] text-destructive hover:text-destructive/80 transition-colors"
              onClick={handleDisconnect}
              disabled={isWorking}
            >
              {'断开连接'}
            </button>
          )}
        </div>
      )}

      <div className="border-t border-border" />

      {/* Sheet URL */}
      <Input
        label={'Google Sheet 链接'}
        placeholder={'https://docs.google.com/spreadsheets/d/...'}
        value={sheetUrl}
        onChange={handleUrlChange}
        onBlur={handleUrlBlur}
        disabled={isWorking}
      />

      <div className="flex gap-2">
        <Button
          variant={isExporting ? 'destructive' : 'outline'}
          size="sm"
          className="flex-1"
          disabled={!sheetUrl || (isWorking && !isExporting)}
          onClick={isExporting ? handleCancelExport : handleExport}
        >
          {isExporting ? '取消' : '上传到 Google Sheets'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={!sheetUrl || isWorking}
          onClick={handleImport}
        >
          {status.type === 'importing' ? '下载中...' : '从 Google Sheets 下载'}
        </Button>
      </div>

      {status.type === 'exporting' && (
        <div className="space-y-1.5 animate-in fade-in duration-200">
          <div className="text-[11px] text-foreground/60">
            {status.phase === 'backup' && '正在备份...'}
            {status.phase === 'upload' && '正在上传'}
            {status.phase === 'rollback' && '正在回滚...'}
          </div>
          {Object.entries(status.tabs).map(([tabName, tab]) => (
            <div key={tabName} className="flex items-center gap-2 text-[11px]">
              <span className="w-20 text-foreground/70">{tabName}</span>
              {tab.status === 'waiting' && (
                <span className="text-foreground/40">{'等待中'}</span>
              )}
              {tab.status === 'uploading' && (
                <div className="flex-1 flex items-center gap-1.5">
                  <div className="flex-1 h-1 bg-foreground/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-300"
                      style={{ width: `${tab.percent}%` }}
                    />
                  </div>
                  <span className="text-foreground/60 w-8 text-right">{tab.percent}%</span>
                </div>
              )}
              {tab.status === 'complete' && (
                <span className="text-success">{'完成'}</span>
              )}
              {tab.status === 'failed' && (
                <span className="text-destructive">{'失败'}</span>
              )}
            </div>
          ))}
        </div>
      )}

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
