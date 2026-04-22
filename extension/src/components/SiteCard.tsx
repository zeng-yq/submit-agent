import { useState } from 'react'
import { Play, Trash2, Loader2, Pencil } from 'lucide-react'
import type { SiteData, SubmissionStatus, SiteCategory } from '@/lib/types'
import { SITE_CATEGORIES, getCategoryLabel } from '@/lib/types'
import { Dialog, DialogHeader, DialogTitle, DialogCloseButton, DialogContent, DialogFooter } from './ui/Dialog'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Select } from './ui/Select'
import { Textarea } from './ui/Textarea'

interface SiteCardProps {
	site: SiteData
	status?: SubmissionStatus
	onSelect?: (site: SiteData) => void
	onDelete?: (siteName: string) => void
	onResetStatus?: (siteName: string) => void
	onSave?: (siteName: string, data: Partial<SiteData>) => void
	disabled?: boolean
	isActive?: boolean
}

const statusBar: Record<SubmissionStatus, string> = {
	not_started: '',
	in_progress: 'bg-blue-400',
	submitted: 'bg-green-400',
	approved: 'bg-green-500',
	rejected: 'bg-red-400',
	failed: 'bg-red-400',
	skipped: 'bg-muted-foreground/30',
}

const statusLabelKey: Record<SubmissionStatus, string> = {
	not_started: '',
	in_progress: '进行中',
	submitted: '已提交',
	approved: '已通过',
	rejected: '已拒绝',
	failed: '失败',
	skipped: '已跳过',
}

export function SiteCard({ site, status = 'not_started', onSelect, onDelete, onResetStatus, onSave, disabled, isActive }: SiteCardProps) {
	const [editOpen, setEditOpen] = useState(false)
	const hasSubmitUrl = !!site.submit_url
	const bar = statusBar[status]
	const labelKey = statusLabelKey[status]

	const [formUrl, setFormUrl] = useState('')
	const [formCategory, setFormCategory] = useState<SiteCategory>('others')
	const [formDr, setFormDr] = useState('')
	const [formLang, setFormLang] = useState('')
	const [formNotes, setFormNotes] = useState('')

	const openEdit = () => {
		setFormUrl(site.submit_url ?? '')
		setFormCategory(site.category)
		setFormDr(site.dr != null ? String(site.dr) : '')
		setFormLang(site.lang ?? '')
		setFormNotes(site.notes ?? '')
		setEditOpen(true)
	}

	const handleSave = async () => {
		if (!onSave) return
		const data: Partial<SiteData> = {
			submit_url: formUrl.trim() || null,
			category: formCategory,
			dr: formDr.trim() && !isNaN(Number(formDr)) ? Number(formDr) : null,
			lang: formLang.trim() || undefined,
			notes: formNotes.trim() || undefined,
		}
		try {
			await onSave(site.name, data)
			setEditOpen(false)
		} catch {
			// 保存失败时保持弹窗打开，用户可重试
		}
	}

	return (
		<>
			<div
				className={`relative flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
					hasSubmitUrl
						? 'hover:border-primary/60 hover:bg-accent/30'
						: 'opacity-50'
				}`}
			>
				{/* Left status bar */}
				{bar && (
					<div className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-full ${bar}`} />
				)}

				{/* DR score */}
				<div className="shrink-0 text-center w-8">
					<div className="text-sm font-bold tabular-nums">{site.dr}</div>
					<div className="text-[9px] text-muted-foreground uppercase tracking-wide">DR</div>
				</div>

				{/* Main info */}
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-1.5">
						{hasSubmitUrl ? (
							<button
								type="button"
								className="text-xs font-medium truncate text-left hover:underline hover:text-primary transition-colors"
								onClick={(e) => {
									e.stopPropagation()
									window.open(site.submit_url!, '_blank')
								}}
								title={site.submit_url!}
							>
								{site.name}
							</button>
						) : (
							<span className="text-xs font-medium truncate">{site.name}</span>
						)}
						{!hasSubmitUrl && (
							<span className="text-[9px] text-muted-foreground shrink-0">手动</span>
						)}
					</div>
					<div className="mt-0.5">
						<span className="text-[10px] text-muted-foreground">{getCategoryLabel(site.category)}</span>
					</div>
				</div>

				{/* Right: submit + edit + reset + delete */}
				<div className="shrink-0 flex items-center gap-1">
					{onSelect && hasSubmitUrl && (
						<button
							type="button"
							className={`p-1 rounded transition-colors ${
								isActive
									? 'text-primary'
									: disabled
										? 'text-muted-foreground/20 cursor-not-allowed'
										: 'text-muted-foreground/50 hover:text-primary hover:bg-primary/10 dark:hover:bg-primary/20'
							}`}
							onClick={(e) => {
								e.stopPropagation()
								if (!disabled && !isActive) onSelect(site)
							}}
							disabled={disabled || isActive}
							title={isActive ? '提交中...' : '自动提交'}
						>
							{isActive
								? <Loader2 className="w-3.5 h-3.5 animate-spin" />
								: <Play className="w-3.5 h-3.5" />
							}
						</button>
					)}
					{onSave && (
						<button
							type="button"
							className="p-1 rounded text-muted-foreground/50 hover:text-primary hover:bg-primary/10 dark:hover:bg-primary/20 transition-colors"
							onClick={(e) => {
								e.stopPropagation()
								openEdit()
							}}
							title="编辑站点"
						>
							<Pencil className="w-3.5 h-3.5" />
						</button>
					)}
					{labelKey && onResetStatus && (
						<button
							type="button"
							className="p-1 rounded text-muted-foreground/50 hover:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-950/30 transition-colors"
							onClick={(e) => {
								e.stopPropagation()
								onResetStatus(site.name)
							}}
							title={`点击重置状态（${labelKey}）`}
						>
							<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
						</button>
					)}
					{onDelete && (
						<button
							type="button"
							className="p-1 rounded text-muted-foreground/50 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
							onClick={(e) => {
								e.stopPropagation()
								if (confirm(`确定要删除「${site.name}」吗？该站点的提交记录也将被删除。`)) {
									onDelete(site.name)
								}
							}}
							title="删除站点"
						>
							<Trash2 className="w-3.5 h-3.5" />
						</button>
					)}
				</div>
			</div>

			{/* Edit Dialog */}
			<Dialog open={editOpen} onClose={() => setEditOpen(false)}>
				<DialogHeader>
					<DialogTitle>编辑站点</DialogTitle>
					<DialogCloseButton onClose={() => setEditOpen(false)} />
				</DialogHeader>
				<DialogContent>
					<Input
						label="提交 URL"
						value={formUrl}
						onChange={(e) => setFormUrl(e.target.value)}
						placeholder="留空表示手动提交"
					/>
					<Select
						label="分类"
						options={SITE_CATEGORIES}
						value={formCategory}
						onChange={(e) => setFormCategory(e.target.value as SiteCategory)}
					/>
					<Input
						label="DR 分数"
						type="number"
						value={formDr}
						onChange={(e) => setFormDr(e.target.value)}
						placeholder="留空表示未知"
					/>
					<Input
						label="语言"
						value={formLang}
						onChange={(e) => setFormLang(e.target.value)}
						placeholder="如 en, zh, ja"
					/>
					<Textarea
						label="备注"
						value={formNotes}
						onChange={(e) => setFormNotes(e.target.value)}
						placeholder="可选备注"
					/>
				</DialogContent>
				<DialogFooter>
					<Button variant="ghost" size="sm" onClick={() => setEditOpen(false)}>取消</Button>
					<Button size="sm" onClick={handleSave}>保存</Button>
				</DialogFooter>
			</Dialog>
		</>
	)
}
