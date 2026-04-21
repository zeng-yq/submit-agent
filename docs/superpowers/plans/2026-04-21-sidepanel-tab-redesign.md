# Sidepanel 三 Tab 重设计 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 sidepanel 从全局 header + 视图切换模式重构为三 Tab 平铺模式（外链提交、外链分析、设置），产品选择器只在外链提交 Tab 内出现。

**Architecture:** 移除 App.tsx 中现有的 header（产品选择器 + 导航按钮），替换为顶部 Tab 栏。三个子组件（Dashboard/BacklinkAnalysis/SettingsPanel）各自去掉自有 header，由 Tab 栏统一提供导航上下文。产品选择器从全局位置移入外链提交 Tab 内容区。

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, WXT (浏览器插件框架)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `extension/src/entrypoints/sidepanel/App.tsx` | **重写** | Tab 栏 + 产品选择器 + 三 Tab 内容编排 |
| `extension/src/components/SettingsPanel.tsx` | **修改** | 移除自有 header，移除 `onClose` prop |
| `extension/src/components/BacklinkAnalysis.tsx` | **修改** | 移除自有 header 和返回按钮，移除 `onBack` prop |

---

### Task 1: 修改 SettingsPanel — 移除自有 header 和 onClose prop

**Files:**
- Modify: `extension/src/components/SettingsPanel.tsx`

SettingsPanel 当前有自己的 header（"设置" 标题 + "返回" 按钮）和 `onClose` prop。在 Tab 模式下，Tab 栏提供导航，SettingsPanel 不再需要这些。

- [ ] **Step 1: 修改 SettingsPanel props 接口和实现**

将 `SettingsPanelProps` 中的 `onClose` 移除。移除 header 部分。`handleSave` 中不再调用 `onClose()`，改为保存后显示内联成功提示。

```tsx
// SettingsPanel.tsx — 修改后的关键部分

interface SettingsPanelProps {
  // onClose 移除
}

// handleSave 回调中：
const handleSave = useCallback(async () => {
  setSaving(true)
  try {
    await setProviderConfigs({ active: activeProvider, configs })
    chrome.runtime.sendMessage({ type: 'FLOAT_BUTTON_TOGGLE', enabled: floatEnabled }).catch(() => {})
    // 不再调用 onClose()
    setSaveSuccess(true) // 新增：内联成功提示
    setTimeout(() => setSaveSuccess(false), 2000)
  } finally {
    setSaving(false)
  }
}, [activeProvider, configs, floatEnabled])
```

新增 `saveSuccess` state：

```tsx
const [saveSuccess, setSaveSuccess] = useState(false)
```

移除 header JSX 块（`<header>...</header>` 整段）。保存按钮文案改为在成功时显示 "已保存"：

```tsx
<Button
  onClick={handleSave}
  disabled={saving || !canSave}
  className="w-full"
  variant={saveSuccess ? 'success' : 'default'}
>
  {saving ? '保存中...' : saveSuccess ? '已保存' : '保存设置'}
</Button>
```

- [ ] **Step 2: 运行构建验证**

Run: `cd extension && npm run build`
Expected: 构建失败，因为 App.tsx 中传了 `onClose` prop 给 SettingsPanel（将在 Task 3 修复，此步先记录错误）

---

### Task 2: 修改 BacklinkAnalysis — 移除自有 header 和 onBack prop

**Files:**
- Modify: `extension/src/components/BacklinkAnalysis.tsx`

BacklinkAnalysis 当前有自己的 header（标题 + 统计 + 日志按钮 + 返回按钮）和 `onBack` prop。

- [ ] **Step 1: 修改 BacklinkAnalysis props 和布局**

从 `BacklinkAnalysisProps` 中移除 `onBack`。移除 header JSX 块，将统计信息和日志按钮移入 toolbar 区域。

```tsx
// BacklinkAnalysisProps 中移除 onBack
interface BacklinkAnalysisProps {
  // ... 其他 props 不变
  // onBack: () => void  ← 移除
}
```

移除 header 块（`<header>...</header>` 整段，约第 170-200 行）。将 stats 信息和日志按钮移到 toolbar 区域，紧跟在 toolbar `<div>` 的末尾：

```tsx
{/* Toolbar: data actions + batch controls + stats */}
<div className="shrink-0 px-4 pt-3 pb-3 space-y-2">
  <div className="flex items-center gap-2">
    {/* 现有的 CSV 导入和 URL 输入 */}
    <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
    <Button variant="outline" size="xs" onClick={() => fileInputRef.current?.click()} disabled={isRunning}>
      {'导入 CSV'}
    </Button>
    <div className="w-px h-5 bg-border/60" />
    <div className="flex items-center gap-1.5 flex-1 min-w-0">
      {/* 现有 URL 输入 */}
      ...
    </div>
    {/* 移入：日志按钮 */}
    <button
      type="button"
      className="relative p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors cursor-pointer shrink-0"
      onClick={() => setLogPanelOpen(prev => !prev)}
      title="活动日志"
    >
      <ScrollText className="w-4 h-4" />
      {logs.length > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center text-[8px] font-medium bg-primary text-primary-foreground rounded-full px-0.5">
          {logs.length > 99 ? '99+' : logs.length}
        </span>
      )}
    </button>
  </div>
  {/* 移入：统计信息 */}
  <div className="flex items-center gap-2 text-xs text-muted-foreground">
    <span className="tabular-nums">{stats.analyzed}/{stats.total}</span>
    {stats.publishable > 0 && (
      <span className="text-green-400 tabular-nums">{`${stats.publishable} 条可发布`}</span>
    )}
  </div>
  {importMsg && <p className="text-xs text-green-400 pl-0.5">{importMsg}</p>}
</div>
```

注意：组件 props 解构中移除 `onBack`。

- [ ] **Step 2: 运行构建验证**

Run: `cd extension && npm run build`
Expected: 构建失败，因为 App.tsx 中传了 `onBack` prop 给 BacklinkAnalysis（将在 Task 3 修复）

---

### Task 3: 重写 App.tsx — Tab 栏 + 产品选择器重新定位

**Files:**
- Rewrite: `extension/src/entrypoints/sidepanel/App.tsx`

这是核心改动。将 View 切换模式替换为 Tab 模式。

- [ ] **Step 1: 定义 Tab 类型，重写 App 组件结构**

```tsx
import { useState, useRef, useEffect, useCallback } from 'react'
import type { SiteData } from '@/lib/types'
import { Dashboard } from '@/components/Dashboard'
import { QuickCreate } from '@/components/QuickCreate'
import { SettingsPanel } from '@/components/SettingsPanel'
import { useProduct } from '@/hooks/useProduct'
import { useSites } from '@/hooks/useSites'
import { useFormFillEngine } from '@/hooks/useFormFillEngine'
import { useBacklinkAgent } from '@/hooks/useBacklinkAgent'
import { BacklinkAnalysis } from '@/components/BacklinkAnalysis'
import { importBacklinksFromCsv } from '@/lib/backlinks'
import { matchCurrentPage, filterSubmittable } from '@/lib/sites'

type Tab = 'submit' | 'analysis' | 'settings'

export default function App() {
  const [tab, setTab] = useState<Tab>('submit')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // ... 所有现有 hooks 保持不变（useProduct, useSites, useFormFillEngine, useBacklinkAgent）
  // ... 所有现有 callbacks 保持不变（handleDeleteSite, runFloatFill, handleStartSite 等）

  const tabs: { id: Tab; label: string }[] = [
    { id: 'submit', label: '外链提交' },
    { id: 'analysis', label: '外链分析' },
    { id: 'settings', label: '设置' },
  ]

  const isLoading = productLoading || sitesLoading

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Tab 栏 */}
      <div className="flex shrink-0 border-b border-border/60">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex-1 py-2.5 text-xs font-medium text-center border-b-2 transition-colors cursor-pointer ${
              tab === t.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 overflow-hidden">
        {tab === 'submit' && (
          activeProduct ? (
            <div className="flex flex-col h-full">
              {/* 产品选择器 — 仅在外链提交 Tab 中显示 */}
              <div className="shrink-0 px-3 py-2 border-b border-border/60">
                <div className="flex items-center justify-between">
                  <div className="relative" ref={dropdownRef}>
                    {/* 产品下拉按钮 — 复用现有样式 */}
                    <button
                      type="button"
                      className="text-xs font-semibold flex items-center gap-1.5 hover:text-primary transition-colors cursor-pointer"
                      onClick={() => setDropdownOpen((o) => !o)}
                    >
                      {activeProduct.name}
                      <svg className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-150 ${dropdownOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                    {dropdownOpen && (
                      <div className="absolute top-full left-0 mt-1.5 bg-popover border border-border/60 rounded-lg shadow-lg z-50 min-w-[180px] py-1.5">
                        {products.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            className={`w-full text-left px-3.5 py-2 text-xs hover:bg-accent transition-colors cursor-pointer ${
                              p.id === activeProduct?.id ? 'font-semibold text-primary' : ''
                            }`}
                            onClick={() => { setActive(p.id); setDropdownOpen(false) }}
                          >
                            {p.name}
                          </button>
                        ))}
                        <div className="border-t border-border/60 my-1" />
                        <button
                          type="button"
                          className="w-full text-left px-3.5 py-2 text-xs hover:bg-accent transition-colors text-muted-foreground cursor-pointer"
                          onClick={() => { setDropdownOpen(false) }}
                        >
                          {'+ 添加产品'}
                        </button>
                        <button
                          type="button"
                          className="w-full text-left px-3.5 py-2 text-xs hover:bg-accent transition-colors text-muted-foreground cursor-pointer"
                          onClick={() => { setDropdownOpen(false); chrome.runtime.openOptionsPage() }}
                        >
                          {'管理产品'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Dashboard 内容 */}
              <div className="flex-1 overflow-hidden p-3">
                {isLoading ? (
                  <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                    {'加载中...'}
                  </div>
                ) : (
                  <Dashboard
                    sites={sites}
                    submissions={submissions}
                    onSelectSite={handleStartSite}
                    onRetrySite={handleStartSite}
                    onResetStatus={resetSubmission}
                    onDeleteSite={handleDeleteSite}
                    engineStatus={engineStatus}
                    engineLogs={engineLogs}
                    onClearEngineLogs={clearLogs}
                    activeSiteName={currentEngineSite?.name ?? null}
                  />
                )}
              </div>
            </div>
          ) : (
            <QuickCreate
              onSave={async (data) => {
                await createProduct(data)
              }}
              onSkip={() => chrome.runtime.openOptionsPage()}
            />
          )
        )}

        {tab === 'analysis' && (
          <BacklinkAnalysis
            backlinks={backlinks}
            analyzingId={analyzingId}
            currentStep={backlinkStep}
            currentIndex={currentIndex}
            batchSize={batchSize}
            isRunning={isBacklinkRunning}
            onImportCsv={importBacklinksFromCsv}
            onReload={reloadBacklinks}
            onStartAnalysis={startAnalysis}
            onAnalyzeOne={analyzeBacklink}
            onAddUrl={addUrl}
            onStop={stopBacklinkAnalysis}
            batchHistory={batchHistory}
            activeBatchId={activeBatchId}
            onSelectBatch={selectBatch}
            onDismissBatch={dismissBatch}
            logs={backlinkLogs}
            onClearLogs={clearBacklinkLogs}
          />
        )}

        {tab === 'settings' && (
          <SettingsPanel />
        )}
      </div>

      {/* 确认弹窗 — 未匹配页面 */}
      {pendingUnmatchedUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-popover border border-border/60 rounded-lg shadow-xl max-w-sm w-full mx-4 p-5">
            <h3 className="text-sm font-semibold mb-2">{'页面未在资源库中'}</h3>
            <p className="text-xs text-muted-foreground mb-1">{'当前页面不在外链资源库中，是否仍然提交？'}</p>
            <p className="text-xs text-muted-foreground break-all mb-4">{pendingUnmatchedUrl}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-accent transition-colors cursor-pointer"
                onClick={handleCancelUnmatched}
              >
                {'取消'}
              </button>
              <button
                type="button"
                className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
                onClick={handleConfirmUnmatched}
              >
                {'提交'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

关键改动说明：
1. **移除 `View` 类型** — 替换为 `Tab = 'submit' | 'analysis' | 'settings'`
2. **移除所有视图切换逻辑** — 不再有 `if (view.name === 'settings') return ...` 等分支渲染
3. **移除 header** — 产品选择器和导航按钮全部去掉
4. **新增 Tab 栏** — 三等分 flex 布局，下划线指示当前 Tab
5. **产品选择器移入 submit Tab** — 仅在 `tab === 'submit'` 时渲染
6. **无产品时** — submit Tab 直接显示 QuickCreate（无 header 包裹）
7. **BacklinkAnalysis 不再传 `onBack`** — 由 Tab 切换替代
8. **SettingsPanel 不再传 `onClose`** — 由 Tab 切换替代
9. **移除 `Button` 导入** — App.tsx 不再直接使用 Button 组件

注意：需要保留所有现有的 hooks、callbacks、effects（`runFloatFill`、`handleStartSite`、`useEffect` 监听等），只改渲染部分。

reloadBacklinks 的触发需要调整 — 当切换到 analysis Tab 时触发：

```tsx
useEffect(() => {
  if (tab === 'analysis') {
    reloadBacklinks()
  }
}, [tab, reloadBacklinks])
```

- [ ] **Step 2: 运行构建验证**

Run: `cd extension && npm run build`
Expected: 构建成功

- [ ] **Step 3: 运行测试**

Run: `cd extension && npx vitest run`
Expected: 所有测试通过

- [ ] **Step 4: 提交**

```bash
git add extension/src/entrypoints/sidepanel/App.tsx extension/src/components/SettingsPanel.tsx extension/src/components/BacklinkAnalysis.tsx
git commit -m "refactor(ui): sidepanel 改为三 Tab 平铺布局

- 外链提交 Tab：包含产品选择器和 Dashboard 内容
- 外链分析 Tab：BacklinkAnalysis 内容，无产品选择器
- 设置 Tab：SettingsPanel 内容，无产品选择器
- 移除 SettingsPanel 和 BacklinkAnalysis 的自有 header
- 移除 view 切换模式，改为 Tab 切换"
```
