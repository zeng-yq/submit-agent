import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
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
		<section className="space-y-3 border-t border-border pt-4">
			<div className="flex items-center justify-between">
				<h2 className="text-xs font-semibold text-foreground">提交文案</h2>
				<Button size="sm" onClick={() => void handleGenerate()} disabled={generating || !limits}>
					<Sparkles className="h-3.5 w-3.5" />
					{generating ? '生成中…' : '生成'}
				</Button>
			</div>

			{limits && (
				<div className="space-y-1.5">
					<LimitChipRow
						label="简介字数"
						options={INTRO_CHAR_LIMIT_OPTIONS}
						selected={limits.maxIntroChars}
						onSelect={(value) => void handleSelectLimit({ maxIntroChars: value })}
					/>
					<LimitChipRow
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
			<p className="text-[11px] text-muted-foreground/70">
				字数为软约束，仅用于引导 LLM；详述含 1~3 个产品链接（硬校验，违规自动重试一次）。
			</p>
		</section>
	)
}

function LimitChipRow({
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
			<span className="w-14 shrink-0 text-xs text-muted-foreground">{label}</span>
			<div className="flex gap-1">
				{options.map((option) => (
					<button
						key={option}
						type="button"
						className={cn(
							'rounded-full border px-2.5 py-0.5 text-[11px] transition-colors',
							selected === option
								? 'border-primary bg-accent font-medium text-foreground'
								: 'border-border text-muted-foreground hover:text-foreground',
						)}
						onClick={() => onSelect(option)}
						aria-pressed={selected === option}
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
	mono?: boolean
}) {
	return (
		<div className="space-y-1">
			<div className="flex items-center justify-between">
				<span className="text-xs font-medium text-foreground">
					{label}
					{value && (
						<span
							className={cn(
								'ml-1.5 font-normal',
								targetChars && value.length > targetChars ? 'text-warning' : 'text-muted-foreground',
							)}
						>
							{value.length} 字符{targetChars ? ` / 目标 ≤${targetChars}` : ''}
						</span>
					)}
				</span>
				<CopyButton copied={copied} onCopy={onCopy} label={`复制${label}`} disabled={!value} />
			</div>
			{value ? (
				<p
					className={`max-h-56 overflow-y-auto rounded-md border border-border bg-muted/50 p-2 text-xs leading-relaxed ${
						mono ? 'whitespace-pre-wrap break-words font-mono' : ''
					}`}
				>
					{value}
				</p>
			) : (
				<p className="rounded-md border border-dashed border-border p-2 text-xs text-muted-foreground/60">
					尚未生成，点击「生成」获得新文案
				</p>
			)}
		</div>
	)
}
