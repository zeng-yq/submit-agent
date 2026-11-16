import { useRef, useState } from 'react'
import { Check, Download, ImagePlus, Pencil, X } from 'lucide-react'
import { CopyButton } from '@/components/ui/CopyButton'
import { updateProduct } from '@/lib/db'
import { copyImageAsPng, copyText } from '@/lib/clipboard'
import { readBlobAsDataUrl } from '@/lib/data-url'
import { toErrorMessage } from '@/lib/to-error-message'
import type { Product } from '@/lib/types'

const MAX_UPLOAD_IMAGE_BYTES = 2 * 1024 * 1024
/** 上传白名单：createImageBitmap 可解码的位图格式（SVG 不支持，复制图片时会失败） */
const UPLOAD_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp']

type TextFieldName = 'name' | 'url' | 'email'
type ImageFieldName = 'logoDataUrl' | 'ogDataUrl'

interface ProductBasicsProps {
	product: Product
	/** 保存后通知父级重载产品列表 */
	onChanged: () => Promise<void>
}

/** 行内编辑小按钮：视觉 28px，伪元素扩到 44px 命中区 */
const rowIconButtonClass =
	'relative rounded p-1.5 cursor-pointer transition-colors duration-150 motion-reduce:transition-none after:absolute after:-inset-1.5 after:content-[""]'

const IMAGE_EXTENSIONS: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp',
	'image/gif': 'gif',
	'image/bmp': 'bmp',
}

/** 把已存的 dataURL 图片存为本地文件（有的目标站表单收不了粘贴图片，只收文件上传） */
function downloadDataUrlImage(dataUrl: string, baseName: string): void {
	const mime = /^data:(image\/[a-z+-]+)/.exec(dataUrl)?.[1] ?? 'image/png'
	const link = document.createElement('a')
	link.href = dataUrl
	link.download = `${baseName}.${IMAGE_EXTENSIONS[mime] ?? 'png'}`
	document.body.appendChild(link)
	link.click()
	link.remove()
}

export function ProductBasics({ product, onChanged }: ProductBasicsProps) {
	const [copiedLabel, setCopiedLabel] = useState<string | null>(null)
	const [actionError, setActionError] = useState<string | null>(null)
	const [editingField, setEditingField] = useState<TextFieldName | null>(null)
	const [draftValue, setDraftValue] = useState('')
	const logoFileRef = useRef<HTMLInputElement>(null)
	const ogFileRef = useRef<HTMLInputElement>(null)

	async function runCopyAction(label: string, action: () => Promise<void>) {
		try {
			setActionError(null)
			await action()
			setCopiedLabel(label)
			setTimeout(() => setCopiedLabel((current) => (current === label ? null : current)), 1500)
		} catch (err: unknown) {
			setActionError(toErrorMessage(err))
		}
	}

	function startEdit(field: TextFieldName) {
		setEditingField(field)
		setDraftValue(product[field])
		setActionError(null)
	}

	async function saveEdit(field: TextFieldName) {
		const trimmed = draftValue.trim()
		if (!trimmed) {
			setActionError(`${FIELD_LABELS[field]}不能为空`)
			return
		}
		if (trimmed === product[field]) {
			setEditingField(null)
			return
		}
		try {
			await updateProduct(product.id, { [field]: trimmed })
			setEditingField(null)
			setActionError(null)
			await onChanged()
		} catch (err: unknown) {
			setActionError(`保存${FIELD_LABELS[field]}失败: ${toErrorMessage(err)}`)
		}
	}

	async function uploadImage(field: ImageFieldName, file: File | undefined) {
		if (!file) return
		if (!UPLOAD_IMAGE_TYPES.includes(file.type)) {
			setActionError(`不支持的图片格式: ${file.type || '未知'}（${file.name}），请上传 PNG/JPG/WebP/GIF/BMP`)
			return
		}
		if (file.size > MAX_UPLOAD_IMAGE_BYTES) {
			setActionError(`图片过大 (${(file.size / 1024 / 1024).toFixed(1)}MB)，请上传 2MB 以内的图片`)
			return
		}
		try {
			setActionError(null)
			const dataUrl = await readBlobAsDataUrl(file)
			await updateProduct(product.id, { [field]: dataUrl })
			await onChanged()
		} catch (err: unknown) {
			setActionError(`上传${IMAGE_FIELD_LABELS[field]}失败: ${toErrorMessage(err)}`)
		}
	}

	return (
		<section className="space-y-1.5" aria-label="产品资料">
			<h2 className="text-sm font-semibold text-foreground">产品资料</h2>
			<div>
				{(['name', 'url', 'email'] as const).map((field) => (
					<div
						key={field}
						className="flex items-center gap-2 border-b border-border py-1.5 last:border-b-0"
					>
						<span className="w-16 shrink-0 text-xs text-muted-foreground">{FIELD_LABELS[field]}</span>
						{editingField === field ? (
							<>
								<input
									className="h-7 min-w-0 flex-1 rounded-md border border-field-edge bg-card px-2 text-sm focus-visible:outline-offset-0"
									value={draftValue}
									autoFocus
									onChange={(e) => setDraftValue(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === 'Enter') void saveEdit(field)
										if (e.key === 'Escape') setEditingField(null)
									}}
								/>
								<button
									type="button"
									className={`${rowIconButtonClass} text-muted-foreground hover:bg-muted hover:text-foreground`}
									aria-label="保存"
									onClick={() => void saveEdit(field)}
								>
									<Check className="h-4 w-4" aria-hidden="true" />
								</button>
								<button
									type="button"
									className={`${rowIconButtonClass} text-muted-foreground hover:bg-muted hover:text-foreground`}
									aria-label="取消"
									onClick={() => setEditingField(null)}
								>
									<X className="h-4 w-4" aria-hidden="true" />
								</button>
							</>
						) : (
							<>
								<span className="min-w-0 flex-1 truncate text-sm" title={product[field]}>
									{product[field]}
								</span>
								<CopyButton
									copied={copiedLabel === field}
									onCopy={() => void runCopyAction(field, () => copyText(product[field]))}
									label={`复制${FIELD_LABELS[field]}`}
								/>
								<button
									type="button"
									className={`${rowIconButtonClass} text-muted-foreground hover:bg-muted hover:text-foreground`}
									onClick={() => startEdit(field)}
									aria-label={`编辑${FIELD_LABELS[field]}`}
								>
									<Pencil className="h-4 w-4" aria-hidden="true" />
								</button>
							</>
						)}
					</div>
				))}

				{(
					[
						{ field: 'logoDataUrl', fileRef: logoFileRef },
						{ field: 'ogDataUrl', fileRef: ogFileRef },
					] as const
				).map(({ field, fileRef }) => (
					<div key={field} className="flex items-center gap-2 border-b border-border py-1.5">
						<span className="w-16 shrink-0 text-xs text-muted-foreground">{IMAGE_FIELD_LABELS[field]}</span>
						<div className="flex min-w-0 flex-1 items-center gap-2">
							{product[field] ? (
								<img
									src={product[field]}
									alt={IMAGE_FIELD_LABELS[field]}
									className="h-10 w-16 rounded-md border border-border object-cover"
								/>
							) : (
								<span className="text-sm text-muted-foreground">未设置</span>
							)}
						</div>
						<CopyButton
							copied={copiedLabel === field}
							disabled={!product[field]}
							onCopy={() =>
								product[field] && void runCopyAction(field, () => copyImageAsPng(product[field] as string))
							}
							label={`复制${IMAGE_FIELD_LABELS[field]}图片`}
						/>
						<input
							ref={fileRef}
							type="file"
							accept={UPLOAD_IMAGE_TYPES.join(',')}
							className="hidden"
							onChange={(e) => {
								void uploadImage(field, e.target.files?.[0])
								e.target.value = ''
							}}
						/>
						<button
							type="button"
							className={`${rowIconButtonClass} text-muted-foreground hover:bg-muted hover:text-foreground`}
							onClick={() => fileRef.current?.click()}
							aria-label={`${product[field] ? '更换' : '上传'}${IMAGE_FIELD_LABELS[field]}`}
						>
							<ImagePlus className="h-4 w-4" aria-hidden="true" />
						</button>
						<button
							type="button"
							className={`${rowIconButtonClass} text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40`}
							onClick={() =>
								product[field] &&
								downloadDataUrlImage(
									product[field] as string,
									`${field === 'logoDataUrl' ? 'logo' : 'og'}-${product.domain}`,
								)
							}
							disabled={!product[field]}
							aria-label={`下载${IMAGE_FIELD_LABELS[field]}`}
						>
							<Download className="h-4 w-4" aria-hidden="true" />
						</button>
					</div>
				))}
			</div>

			{actionError && <p className="pt-1 text-xs text-destructive">{actionError}</p>}
		</section>
	)
}

const FIELD_LABELS: Record<TextFieldName, string> = {
	name: '网站名',
	url: 'URL',
	email: '邮箱',
}

const IMAGE_FIELD_LABELS: Record<ImageFieldName, string> = {
	logoDataUrl: 'Logo',
	ogDataUrl: 'OG 封面图',
}
