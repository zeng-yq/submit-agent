import { useRef, useState } from 'react'
import { Dialog, DialogHeader, DialogTitle, DialogCloseButton, DialogContent } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import {
	addProduct,
	fetchHomepageHtml,
	fetchImageAsDataUrl,
	type AddProductStage,
} from '@/lib/add-product'
import { callLLM } from '@/lib/llm-utils'
import { getActiveLLMConfig } from '@/lib/storage'
import { toErrorMessage } from '@/lib/to-error-message'
import type { Product } from '@/lib/types'

interface AddProductDialogProps {
	open: boolean
	onClose: () => void
	/** 添加成功后由父级重载产品列表并选中新产品 */
	onAdded: (product: Product) => Promise<void>
}

function describeStage(stage: AddProductStage): string {
	switch (stage.type) {
		case 'domain-normalized':
			return `✓ 域名已规范化：${stage.domain}`
		case 'homepage-fetching':
			return `抓取首页中…（${stage.url}）`
		case 'homepage-fetched':
			return `✓ 首页抓取完成（${stage.htmlLength} 字符）`
		case 'basics-parsed':
			return `✓ 基本信息解析：网站名「${stage.siteName ?? '无，回退域名'}」；logo ${stage.logoFound ? '✓' : '✗'}；og 图 ${stage.ogFound ? '✓' : '✗'}`
		case 'images-fetched':
			return `✓ 图片处理完成（logo ${stage.logoSaved ? '已存' : '留空'} / og 图 ${stage.ogSaved ? '已存' : '留空'}）`
		case 'analysis-starting':
			return '调用 LLM 生成产品分析中…（约 20~40 秒）'
		case 'analysis-done':
			return `✓ 产品分析完成（${stage.analysisLength} 字符）`
		case 'saved':
			return '✓ 产品已保存入库'
	}
}

/** 添加产品弹窗：域名输入 + 实时进度日志；关闭即清空输入、日志与错误，不跨会话残留 */
export function AddProductDialog({ open, onClose, onAdded }: AddProductDialogProps) {
	const [domainInput, setDomainInput] = useState('')
	const [adding, setAdding] = useState(false)
	const [addError, setAddError] = useState<string | null>(null)
	const [addLogs, setAddLogs] = useState<string[]>([])
	const logBoxRef = useRef<HTMLDivElement>(null)

	function appendAddLog(line: string) {
		setAddLogs((current) => {
			const next = [...current, line]
			requestAnimationFrame(() => {
				if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight
			})
			return next
		})
	}

	function handleClose() {
		onClose()
		setDomainInput('')
		setAddError(null)
		setAddLogs([])
	}

	async function handleAddProduct() {
		if (adding || !domainInput.trim()) return
		setAdding(true)
		setAddError(null)
		setAddLogs([])
		try {
			const config = await getActiveLLMConfig()
			const product = await addProduct(domainInput, {
				llmConfig: config,
				fetchHomepageHtml,
				fetchImageAsDataUrl,
				callLLM: (options) => callLLM({ ...options, config }),
				onProgress: (stage) => appendAddLog(describeStage(stage)),
			})
			setDomainInput('')
			await onAdded(product)
		} catch (err: unknown) {
			appendAddLog(`✗ 失败：${toErrorMessage(err)}`)
			setAddError(toErrorMessage(err))
		} finally {
			setAdding(false)
		}
	}

	return (
		<Dialog open={open} onClose={handleClose}>
			<DialogHeader>
				<DialogTitle>添加产品</DialogTitle>
				<DialogCloseButton onClose={handleClose} />
			</DialogHeader>
			<DialogContent>
				<Input
					label="网站域名"
					placeholder="输入网站域名，如 example.com"
					value={domainInput}
					onChange={(e) => {
						setDomainInput(e.target.value)
						setAddError(null)
					}}
					onKeyDown={(e) => {
						if (e.key === 'Enter') void handleAddProduct()
					}}
					disabled={adding}
				/>
				<Button className="w-full" onClick={() => void handleAddProduct()} disabled={adding || !domainInput.trim()}>
					{adding ? '添加中…' : '开始添加'}
				</Button>
				{addLogs.length > 0 && (
					<div
						ref={logBoxRef}
						className="max-h-40 space-y-0.5 overflow-y-auto rounded-lg bg-muted p-2.5 font-mono text-xs leading-relaxed text-muted-foreground"
					>
						{addLogs.map((line, index) => (
							<p key={index} className={line.startsWith('✗') ? 'text-destructive' : undefined}>
								{line}
							</p>
						))}
						{adding && <p className="animate-pulse motion-reduce:animate-none">▌</p>}
					</div>
				)}
				{addError && !adding && <p className="text-xs text-destructive">{addError}</p>}
			</DialogContent>
		</Dialog>
	)
}
