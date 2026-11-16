import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { createCopyLLMCaller, generateCopy } from '@/lib/generate-copy'
import { updateProduct } from '@/lib/db'
import { copyText } from '@/lib/clipboard'
import { getActiveLLMConfig } from '@/lib/storage'
import { toErrorMessage } from '@/lib/to-error-message'
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

	async function handleGenerate() {
		if (generating) return
		setGenerating(true)
		setError(null)
		try {
			const config = await getActiveLLMConfig()
			if (!config.apiKey) {
				setError('请先在设置中配置当前供应商的 API Key（右上角齿轮）')
				return
			}
			const copy = await generateCopy(product, { callLLM: createCopyLLMCaller(config) })
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
				<Button size="sm" onClick={() => void handleGenerate()} disabled={generating}>
					<Sparkles className="h-3.5 w-3.5" />
					{generating ? '生成中…' : '生成'}
				</Button>
			</div>

			{generating && (
				<p className="text-xs text-muted-foreground">DeepSeek 正在生成简介与详述（每次不同），约需 30 秒…</p>
			)}
			{error && !generating && <p className="text-xs text-destructive">{error}</p>}

			<CopyBlock
				label="简介（≤300 字符）"
				value={product.intro}
				copied={copiedField === 'intro'}
				onCopy={() => void handleCopy('intro')}
				emptyHint="尚未生成"
			/>
			<CopyBlock
				label="详述（markdown，≤1000 字符，含 1~3 个产品链接）"
				value={product.description}
				copied={copiedField === 'description'}
				onCopy={() => void handleCopy('description')}
				emptyHint="尚未生成"
				mono
			/>
		</section>
	)
}

function CopyBlock({
	label,
	value,
	copied,
	onCopy,
	emptyHint,
	mono,
}: {
	label: string
	value: string | undefined
	copied: boolean
	onCopy: () => void
	emptyHint: string
	mono?: boolean
}) {
	return (
		<div className="space-y-1">
			<div className="flex items-center justify-between">
				<span className="text-xs font-medium text-foreground">{label}</span>
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
					{emptyHint}，点击「生成」获得新文案
				</p>
			)}
		</div>
	)
}
