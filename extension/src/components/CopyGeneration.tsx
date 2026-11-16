import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { generateCopy, createCopyLLMCaller } from '@/lib/generate-copy'
import {
	DESCRIPTION_CHAR_LIMIT_OPTIONS,
	INTRO_CHAR_LIMIT_OPTIONS,
	type CopyCharLimits,
} from '@/lib/copy-limits'
import { updateProduct } from '@/lib/db'
import { copyText } from '@/lib/clipboard'
import { getActiveLLMConfig, getCopyCharLimits, setCopyCharLimits } from '@/lib/storage'
import { toErrorMessage } from '@/lib/to-error-message'
import { cn } from '@/lib/cn'
import type { Product } from '@/lib/types'

interface CopyGenerationProps {
	product: Product
	/** 生成成功后通知父级重载（展示缓存的新文案） */
	onChanged: () => Promise<void>
}

export function CopyGeneration({ product, onChanged }: CopyGenerationProps) {
	const [generating, setGenerating] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [copiedField, setCopiedField] = useState<'intro' | 'description' | null>(null)
	const [limits, setLimits] = useState<CopyCharLimits | null>(null)

	useEffect(() => {
		getCopyCharLimits().then(setLimits).catch((err: unknown) => setError(toErrorMessage(err)))
	}, [])

	async function handleSelectLimit(patch: Partial<CopyCharLimits>) {
		if (!limits) return
		const next = { ...limits, ...patch }
		setLimits(next)
		try {
			await setCopyCharLimits(next)
		} catch (err: unknown) {
			setError(`保存字数档位失败: ${toErrorMessage(err)}`)
		}
	}

	async function handleGenerate() {
		if (generating || !limits) return
		setGenerating(true)
		setError(null)
		try {
			const config = await getActiveLLMConfig()
			if (!config.apiKey) {
				setError('请先在设置中配置当前供应商的 API Key（右上角齿轮）')
				return
			}
			const copy = await generateCopy(product, {
				callLLM: createCopyLLMCaller(config),
				limits,
			})
			await updateProduct(product.id, { intro: copy.intro, description: copy.description })
			await onChanged()
		} catch (err: unknown) {
			setError(toErrorMessage(err))
		} finally {
			setGenerating(false)
		}
	}

	async function handleCopy(field: 'intro' | 'description') {
		const value = field === 'intro' ? product.intro : product.description
		if (!value) return
		try {
			setError(null)
			await copyText(value)
			setCopiedField(field)
			setTimeout(() => setCopiedField((current) => (current === field ? null : current)), 1500)
		} catch (err: unknown) {
			setError(`复制失败: ${toErrorMessage(err)}`)
		}
	}

	return (
		<section className="space-y-3" aria-label="提交文案">
			<div className="flex items-center justify-between gap-2">
				<h2 className="text-sm font-semibold text-foreground">提交文案</h2>
				<Button size="sm" onClick={() => void handleGenerate()} disabled={generating || !limits}>
					{generating ? '生成中…' : '生成'}
				</Button>
			</div>

			{limits && (
				<div className="space-y-2">
					<LimitGrooveRow
						label="简介字数"
						options={INTRO_CHAR_LIMIT_OPTIONS}
						selected={limits.maxIntroChars}
						onSelect={(value) => void handleSelectLimit({ maxIntroChars: value })}
					/>
					<LimitGrooveRow
						label="详述字数"
						options={DESCRIPTION_CHAR_LIMIT_OPTIONS}
						selected={limits.maxDescriptionChars}
						onSelect={(value) => void handleSelectLimit({ maxDescriptionChars: value })}
					/>
				</div>
			)}

			{generating && (
				<p className="text-xs text-muted-foreground">LLM 正在生成简介与详述（每次不同），约需 30 秒…</p>
			)}
			{error && !generating && <p className="text-xs text-destructive">{error}</p>}

			<CopyBlock
				label="简介"
				value={product.intro}
				targetChars={limits?.maxIntroChars}
				copied={copiedField === 'intro'}
				onCopy={() => void handleCopy('intro')}
			/>
			<CopyBlock
				label="详述"
				value={product.description}
				targetChars={limits?.maxDescriptionChars}
				copied={copiedField === 'description'}
				onCopy={() => void handleCopy('description')}
				mono
			/>
			<p className="text-xs text-muted-foreground">
				字数为软约束，仅用于引导 LLM；详述含 1~3 个产品链接（硬校验，违规自动重试一次）。
			</p>
		</section>
	)
}

function LimitGrooveRow({
	label,
	options,
	selected,
	onSelect,
}: {
	label: string
	options: readonly number[]
	selected: number
	onSelect: (value: number) => void
}) {
	return (
		<div className="flex items-center gap-2">
			<span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
			<div className="groove" role="group" aria-label={label}>
				{options.map((option) => (
					<button
						key={option}
						type="button"
						className="groove-choice"
						aria-pressed={selected === option}
						onClick={() => onSelect(option)}
					>
						{option}
					</button>
				))}
			</div>
		</div>
	)
}

function CopyBlock({
	label,
	value,
	targetChars,
	copied,
	onCopy,
	mono,
}: {
	label: string
	value: string | undefined
	targetChars: number | undefined
	copied: boolean
	onCopy: () => void
	/** 详述是 markdown 源码，等宽体明示「复制的就是这份源码」 */
	mono?: boolean
}) {
	return (
		<div className="space-y-1.5">
			<div className="flex items-center justify-between gap-2">
				<span className="flex min-w-0 items-baseline gap-2 text-xs font-medium text-foreground">
					{label}
					{value && (
						<span
							className={cn(
								'font-mono text-xs font-normal tabular-nums',
								targetChars && value.length > targetChars ? 'text-warning' : 'text-foreground/75',
							)}
						>
							{value.length}
							{targetChars ? ` / ≤${targetChars}` : ''} 字
						</span>
					)}
				</span>
				<CopyButton copied={copied} onCopy={onCopy} label={`复制${label}`} disabled={!value} />
			</div>
			{value ? (
				<p
					className={cn(
						'max-h-56 overflow-y-auto rounded-lg bg-card p-3 leading-relaxed shadow-stock whitespace-pre-wrap break-words',
						mono ? 'font-mono text-xs' : 'text-sm',
					)}
				>
					{value}
				</p>
			) : (
				<p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
					尚未生成，点击「生成」获得新文案
				</p>
			)}
		</div>
	)
}
