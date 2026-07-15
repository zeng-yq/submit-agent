# AI 目录外链 CSV 导入 — 设计文档

- 日期：2026-07-15
- 范围：`extension/`（submit-agent 浏览器扩展）
- 状态：已实现（自动测试 286 全绿、build 通过；手动浏览器验证待确认）

## 1. 背景与问题

「外链提交」面板的资源库（IndexedDB `sites` store）目前只有两条数据来源：

1. 首次启动时从打包的 `sites.json` seed（`lib/sites.ts:6` `loadSites` → `db.ts:220` `seedSites`）。
2. 浮动按钮触发的**单条**「添加到外链库」（`App.tsx:126` `handleAddSite`）。

现有一份 AI 目录站点清单（CSV，约 380 行），格式为：

```
名称,url,价格,需要登录
Source Forge,https://sourceforge.net/,付费,是
Product Hunt,https://producthunt.com/,免费,是
...
```

需要把这批站点**批量导入**外链库，且：

- 分类一律为 `ai_directory`；
- 默认处于「未提交」状态（无 submission 记录）；
- CSV 中两类信息——`价格`（免费/付费/混合）与`需要登录`（是/否）——是当前 `SiteData` 模型**不具备**的结构化维度，需在数据模型与插件 UI 中一并补齐。

> 说明：项目里 `Backlink`（Semrush 分析）与 `Site`（提交资源库）是两套模型。本需求针对 **Site** 模型（`category=ai_directory`），与「外链分析」面板的 Backlink CSV 导入无关。

## 2. 目标与非目标

**目标**

- 新增「导入 CSV」入口，把上述格式 CSV 批量写入 `sites` store，`category='ai_directory'`，默认未提交。
- `SiteData` 新增结构化字段 `pricing_type`（free/paid/mixed）与 `requires_login`（boolean），并在卡片展示与编辑表单中支持。
- 按 domain 去重；已存在的 domain **更新补充**这两个新字段，保留其余字段与原分类。

**非目标**

- 不接入 Supabase（迁移尚未合并；本次仅在当前 IndexedDB 代码上实现）。
- 不新增「按价格筛选」下拉（标签展示已足够；需筛选时再加）。
- 不改动 `pricing?: string` 自由文本字段（保留，与新增枚举并存）。
- 不改动 Backlink 模型 / 外链分析面板 / 自动提交流程。

## 3. 关键决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| 存储层 | IndexedDB `sites` store | 当前生效代码；与现有 Site CRUD 一致，不碰未合并的 Supabase 迁移 |
| 价格建模 | 新增枚举 `pricing_type`（free/paid/mixed） | CSV 为固定三值，结构化便于展示与未来筛选；不动现有 `pricing` 自由文本 |
| 登录建模 | 新增 `requires_login: boolean` | CSV 为是/否二值；现有 login 检测是运行时行为（提交时），非站点属性 |
| 去重键 | `domain`（`extractDomain(url)`） | 与 `getSiteByDomain` 既有索引一致；一个 domain 对应一个站点 |
| 已存在 domain | `updateSite` 仅补 `pricing_type`/`requires_login` | 按用户选择「更新补充」；不改 category、不覆盖其余字段 |
| CSV 解析 | 复用 `backlinks.ts` 的 `parseCsv`（改为 export） | 已是 RFC 4180 实现（含 BOM/引号），避免重复 |
| 导入函数落点 | `lib/sites.ts`（调 `db.ts` 的 `addSite`/`updateSite`） | 与 `backlinks.ts` 放 `importBacklinksFromCsv` 的模式一致 |
| db schema | 不升 `DB_VERSION` | IndexedDB schemaless，新字段自动生效；无需按 pricing 建索引（无筛选需求） |

## 4. 数据模型变更

### 4.1 `extension/src/lib/types.ts`

`SiteData`（`:62-71`）新增两字段：

```ts
export interface SiteData {
    name: string
    submit_url: string | null
    category: SiteCategory
    dr: number | null
    status?: string
    monthly_traffic?: number
    pricing?: string                 // 既有，保留不动
    notes?: string
    pricing_type?: SitePricing       // 新增：结构化价格
    requires_login?: boolean         // 新增：是否需要登录
}
```

新增枚举与 label（完全模仿 `SITE_CATEGORIES`/`getCategoryLabel`，`:47-59`）：

```ts
export type SitePricing = 'free' | 'paid' | 'mixed'

export const SITE_PRICINGS: { value: SitePricing; label: string }[] = [
  { value: 'free', label: '免费' },
  { value: 'paid', label: '付费' },
  { value: 'mixed', label: '混合' },
]

export function getPricingLabel(pricing: string): string {
  return SITE_PRICINGS.find((p) => p.value === pricing)?.label ?? ''
}
```

> `pricing_type` 与 `pricing` 并存：导入写 `pricing_type`；既有 `sites.json` 的英文 `pricing` 文本保留，不迁移。

## 5. 导入流程（数据流）

```
用户在「外链提交」面板点「导入 CSV」→ 选文件
→ App.handleImportAiDirectory(csvText)
→ importAiDirectoryFromCsv(csvText)            // lib/sites.ts
   parseCsv(csvText) → rows                    // 复用 backlinks.ts:5
   for each row:
     name = 名称.trim(); url = url.trim()
     if (!url) → skipped++
     domain = extractDomain(url)               // backlinks.ts:114
     existing = await getSiteByDomain(domain)  // db.ts
     pricing_type = map 价格（免费→free/付费→paid/混合→mixed/其他→undefined）
     requires_login = map 需要登录（是→true/否→false/其他→undefined）
     if (existing):
       await updateSite({ ...existing, pricing_type, requires_login })  // 只补两字段
       updated++
     else:
       await addSite({
         name, submit_url: url, category: 'ai_directory',
         dr: null, pricing_type, requires_login,
         domain, createdAt: now, updatedAt: now,
       })
       imported++
→ refreshSites()                               // useSites.refresh
→ 行内提示「新增 X · 更新 Y · 跳过 Z · 失败 N」
```

**关键不变量**

- 导入的 site **不写任何 submission 记录** → `Dashboard.undoneSites` 过滤（`Dashboard.tsx:104-113`，`!status || ...`）天然将其归为「未提交」。✓
- `category` 对新建恒为 `'ai_directory'`；对已存在记录**不修改**（保留原分类）。
- `updateSite` 仅合并 `pricing_type`/`requires_login`，其余字段（含原 `pricing`、`dr`、`notes`、`submit_url`）保持不变。

**值映射表**

| CSV `价格` | `pricing_type` | CSV `需要登录` | `requires_login` |
|---|---|---|---|
| 免费 | `free` | 是 | `true` |
| 付费 | `paid` | 否 | `false` |
| 混合 | `mixed` | 空/其他 | `undefined` |
| 空/其他 | `undefined` | | |

## 6. 组件改动（逐文件）

### 6.1 `extension/src/lib/backlinks.ts`

- `parseCsv`（`:5`）由 `function` 改为 `export function`（一行改动，供 sites.ts 复用）。其余不动。

### 6.2 `extension/src/lib/sites.ts`

新增导入函数：

```ts
export interface SiteImportResult {
    imported: number
    updated: number
    skipped: number
    errors: number
}

export async function importAiDirectoryFromCsv(csvText: string): Promise<SiteImportResult>
```

- `import { parseCsv, extractDomain } from './backlinks'`
- 现有 `import type { SiteData, SitesDatabase, SiteCategory } from './types'` 追加 `SiteRecord`；现有 `import { seedSites, listSites } from './db'` 追加 `addSite, updateSite, getSiteByDomain`
- 内部封装 `mapPricingType(zh): SitePricing | undefined` 与 `mapRequiresLogin(zh): boolean | undefined`（纯函数，便于单测）。
- 单行 `try/catch`：异常计入 `errors` 并继续，不中断整批。

### 6.3 `extension/src/components/Dashboard.tsx`

- `DashboardProps`（`:10-23`）新增 `onImportCsv?: (csvText: string) => Promise<SiteImportResult>`。
- 工具栏（`:188-223`，分类下拉与搜索框所在行）追加「导入 CSV」按钮 + 隐藏 `<input type="file" accept=".csv">`（复刻 `BacklinkToolbar` 模式）。
- 新增内部 state `importMsg`（string | null）：导入完成后显示一行统计，3 秒后清空。

### 6.4 `extension/src/components/SiteCard.tsx`

- 卡片 category 标签旁（`:119-121`）追加：`pricing_type` 小徽标（`getPricingLabel`）+ `requires_login` 时显示「需登录」标记。
- 编辑 Dialog（`:193-230`）新增两个输入：
  - 价格：`<Select options={SITE_PRICINGS}>`（含「未知」空选项）；
  - 需要登录：`<Select>`（是/否/未知）。
- `handleSave`（`:61-75`）的 `data` 增补 `pricing_type` / `requires_login`；`openEdit`（`:53-59`）初始化对应 state。

### 6.5 `extension/src/entrypoints/sidepanel/App.tsx`

- `import { importAiDirectoryFromCsv } from '@/lib/sites'`。
- 新增 `handleImportAiDirectory`：调用导入 → `refreshSites()` → 返回结果供 Dashboard 行内提示。
- Dashboard 渲染处（`:280-294`）传入 `onImportCsv={handleImportAiDirectory}`。

### 6.6 `extension/src/lib/db.ts`

- 无改动。复用既有 `addSite`（`:252`）、`updateSite`（`:257`）、`getSiteByDomain`。`SiteRecord extends SiteData` 自动获得新字段。

## 7. 边界与错误处理

| 场景 | 处理 |
|---|---|
| CSV 同 domain 多行（如 Google Forms 两行同 domain） | 首行新建，后续行命中 `getSiteByDomain` → `updated`（补字段），不重复建 |
| domain 已存在为 `blog_comment` | 仅补 `pricing_type`/`requires_login`，**保留 blog_comment 分类** |
| `url` 为空或非法 | `skipped`（非法 URL 时 `extractDomain` 回退原值，仍可作 domain 查询；空 url 直接跳过） |
| `url` 为表单/登录页链接（如 `docs.google.com/...`、`.../login`） | 照常作为 `submit_url` 存入；domain 取 hostname（可能为 `docs.google.com`，可接受） |
| `价格`/`需要登录` 为空或非标准值 | 对应字段设 `undefined`，卡片不显示该标签 |
| 单行解析异常 | 计入 `errors`，继续处理后续行 |
| CSV 表头非中文标准列名 | 取不到值的列按空处理（导入仍按 url 推进） |
| 重复 name 不同 domain（理论） | `sites` store 主键为 name，`put` 会覆盖；当前 CSV 不含此情况，不特殊处理 |

## 8. 测试计划（TDD）

参照现有 `backlink-dedup.test.ts`、`category-label.test.ts` 风格（依赖注入 / 纯函数优先）。

### 8.1 `ai-directory-import.test.ts`（新增）

- **值映射**：`mapPricingType('免费')→'free'`、`'付费'→'paid'`、`'混合'→'mixed'`、`''/其他→undefined`；`mapRequiresLogin('是')→true`、`'否'→false`、`''→undefined`。
- **CSV 解析**：中文表头 `名称,url,价格,需要登录` 正确切列；含 BOM、含逗号/引号字段。
- **新建分支**：domain 不存在 → 调 `addSite`，记录 `category='ai_directory'`、`dr=null`、两新字段正确，无 submission。
- **更新分支**：domain 已存在（mock `getSiteByDomain` 返回带原 `pricing`/`dr` 的记录）→ 调 `updateSite`，断言传入对象**保留**原 `pricing`/`dr`/`category`，**仅覆盖** `pricing_type`/`requires_login`。
- **统计**：混合一批数据后 `{ imported, updated, skipped, errors }` 计数正确。
- **健壮性**：某行抛错 → 计 `errors` 且不中断。

> db 层用 fake/inject 注入（参考 `backlink-dedup.test.ts` 对 `getBacklinkByUrl` 的处理），避免直接依赖真实 IndexedDB。

### 8.2 `category-label.test.ts` 扩展（或新增 pricing-label 用例）

- `getPricingLabel('paid')→'付费'`；未知值→空串。

## 9. 手动验证矩阵（实现后）

| 操作 | 期望 |
|---|---|
| 导入示例 CSV（含库中已有 domain） | 提示「新增 X · 更新 Y · 跳过 Z · 失败 0」；列表出现新 ai_directory 站点 |
| 导入后切到「未完成」tab | 新导入站点均在此（默认未提交） |
| 分类下拉选「AI 目录」 | 仅显示 `ai_directory` 站点（含新导入） |
| 卡片展示 | 显示价格徽标（如「付费」）与「需登录」标记 |
| 编辑某导入站点 | Dialog 价格/需要登录回显当前值，可改可存 |
| 重复导入同一 CSV | 新增数变 0，更新数≈首次新增数（domain 已存在，仅补字段） |
| 导入非法 CSV（错列） | 不崩溃，errors 计数，url 列仍尽力推进 |

## 10. 风险与回滚

- **风险**：CSV 部分站点已在 `sites.json` seed 中（同 domain，可能为 `others`/`blog_comment`）。按设计只补字段不改分类，符合预期；若用户希望强制转 `ai_directory`，可后续加开关。
- **风险**：`pricing_type`/`requires_login` 为可选字段，旧记录（seed 来的）无此字段。卡片需对 `undefined` 容错（不渲染标签）——已在 6.4 考量。
- **注意**：`Dashboard` 是共享组件，若 `options/App.tsx` 也渲染它，需同步传入 `onImportCsv`；该 prop 设计为可选，未传入时不渲染导入按钮（向后兼容）。
- **回滚**：改动集中在 `types.ts`、`backlinks.ts`(1 行)、`sites.ts`、`Dashboard.tsx`、`SiteCard.tsx`、`App.tsx` + 新测试，git revert 单提交即可还原。数据层无 schema 变更，无需回滚迁移。
