import type { ProductProfile } from '@/lib/types'
import { useCallback, useState } from 'react'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Textarea } from './ui/Textarea'

export type FormData = Omit<ProductProfile, 'id' | 'createdAt' | 'updatedAt'>

interface ProductFormProps {
	initial?: Partial<FormData> & Pick<FormData, 'name' | 'url'>
	compact?: boolean
	onSave: (data: FormData) => Promise<void>
	onCancel?: () => void
	submitLabel?: string
}

const EMPTY_FORM: FormData = {
	name: '',
	url: '',
	description: '',
	anchorTexts: '',
	founderName: '',
	founderEmail: '',
}

export function ProductForm({ initial, compact, onSave, onCancel, submitLabel }: ProductFormProps) {
	const [form, setForm] = useState<FormData>({ ...EMPTY_FORM, ...initial })
	const [saving, setSaving] = useState(false)
	const [showMore, setShowMore] = useState(false)

	const update = useCallback(
		<K extends keyof FormData>(key: K, value: FormData[K]) => {
			setForm((prev) => ({ ...prev, [key]: value }))
		},
		[]
	)

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		setSaving(true)
		try {
			await onSave(form)
		} finally {
			setSaving(false)
		}
	}

	const textareaRows = compact ? 2 : undefined

	return (
		<form onSubmit={handleSubmit} className="space-y-3">
			{!compact && (
				<div className="text-sm font-semibold">
					{initial ? '编辑产品' : '新建产品资料'}
				</div>
			)}

			<Input
				label={'产品名称'}
				placeholder={'我的 AI 工具'}
				value={form.name}
				onChange={(e) => update('name', e.target.value)}
				required
			/>

			<Input
				label={'网站 URL'}
				placeholder="https://example.com"
				type="url"
				value={form.url}
				onChange={(e) => update('url', e.target.value)}
				required
			/>

			<Textarea
				label={'产品描述（约 150 词）'}
				placeholder={'详细的产品描述...'}
				value={form.description}
				onChange={(e) => update('description', e.target.value)}
				rows={textareaRows ?? 5}
				required
			/>

			<Textarea
				label={'锚文本列表（用英文逗号分隔）'}
				placeholder={'AI工具, 效率提升, 任务管理, 项目管理软件, team collaboration tool, ...'}
				value={form.anchorTexts}
				onChange={(e) => update('anchorTexts', e.target.value)}
				rows={textareaRows ?? 3}
			/>

			{compact ? (
				<>
					<button
						type="button"
						className="text-xs text-primary hover:underline"
						onClick={() => setShowMore((v) => !v)}
					>
						{showMore ? '隐藏额外信息' : '更多信息（创始人信息）'}
					</button>
					{showMore && <ExtraFields form={form} update={update} />}
				</>
			) : (
				<ExtraFields form={form} update={update} />
			)}

			<div className="flex gap-2 pt-2">
				<Button type="submit" disabled={saving || !form.name || !form.url} className={compact ? 'w-full' : ''}>
					{saving ? '保存中...' : submitLabel ?? (initial ? '更新' : '创建资料')}
				</Button>
				{onCancel && (
					<Button type="button" variant="outline" onClick={onCancel}>
						{'取消'}
					</Button>
				)}
			</div>
		</form>
	)
}

function ExtraFields({
	form,
	update,
}: {
	form: FormData
	update: <K extends keyof FormData>(key: K, value: FormData[K]) => void
}) {
	return (
		<>
			<div className="border-t border-border pt-4 mt-4">
				<div className="text-xs font-semibold mb-3">{'创始人信息'}</div>
				<div className="space-y-3">
					<Input
						label={'姓名'}
						placeholder="Jane Doe"
						value={form.founderName}
						onChange={(e) => update('founderName', e.target.value)}
					/>
					<Input
						label={'邮箱'}
						placeholder="jane@example.com"
						type="email"
						value={form.founderEmail}
						onChange={(e) => update('founderEmail', e.target.value)}
					/>
				</div>
			</div>
		</>
	)
}
