import type { ProductProfile } from '@/lib/types'
import { useCallback, useState } from 'react'
import { useT } from '@/hooks/useLanguage'
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
	tagline: '',
	shortDesc: '',
	longDesc: '',
	categories: [],
	screenshots: [],
	founderName: '',
	founderEmail: '',
	socialLinks: {},
}

export function ProductForm({ initial, compact, onSave, onCancel, submitLabel }: ProductFormProps) {
	const t = useT()
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
					{initial ? t('productForm.editProduct') : t('productForm.newProduct')}
				</div>
			)}

			<Input
				label={t('productForm.productName')}
				placeholder={t('productForm.productNamePlaceholder')}
				value={form.name}
				onChange={(e) => update('name', e.target.value)}
				required
			/>

			<Input
				label={t('productForm.websiteUrl')}
				placeholder="https://example.com"
				type="url"
				value={form.url}
				onChange={(e) => update('url', e.target.value)}
				required
			/>

			<Input
				label={t('productForm.tagline')}
				placeholder={t('productForm.taglinePlaceholder')}
				value={form.tagline}
				onChange={(e) => update('tagline', e.target.value)}
				required
			/>

			<Textarea
				label={t('productForm.shortDesc')}
				placeholder={t('productForm.shortDescPlaceholder')}
				value={form.shortDesc}
				onChange={(e) => update('shortDesc', e.target.value)}
				rows={textareaRows ?? 3}
				required
			/>

			<Textarea
				label={t('productForm.longDesc')}
				placeholder={t('productForm.longDescPlaceholder')}
				value={form.longDesc}
				onChange={(e) => update('longDesc', e.target.value)}
				rows={textareaRows ?? 5}
				required
			/>

			<Input
				label={t('productForm.categories')}
				placeholder={t('productForm.categoriesPlaceholder')}
				value={form.categories.join(', ')}
				onChange={(e) =>
					update(
						'categories',
						e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
					)
				}
			/>

			{compact ? (
				<>
					<button
						type="button"
						className="text-xs text-primary hover:underline"
						onClick={() => setShowMore((v) => !v)}
					>
						{showMore ? t('productForm.hideExtra') : t('productForm.moreDetails')}
					</button>
					{showMore && <ExtraFields form={form} update={update} />}
				</>
			) : (
				<ExtraFields form={form} update={update} />
			)}

			<div className="flex gap-2 pt-2">
				<Button type="submit" disabled={saving || !form.name || !form.url} className={compact ? 'w-full' : ''}>
					{saving ? t('common.saving') : submitLabel ?? (initial ? t('productForm.update') : t('productForm.createProfile'))}
				</Button>
				{onCancel && (
					<Button type="button" variant="outline" onClick={onCancel}>
						{t('common.cancel')}
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
	const t = useT()
	return (
		<>
			<div className="border-t border-border pt-4 mt-4">
				<div className="text-xs font-semibold mb-3">{t('productForm.founderInfo')}</div>
				<div className="space-y-3">
					<Input
						label={t('productForm.fullName')}
						placeholder="Jane Doe"
						value={form.founderName}
						onChange={(e) => update('founderName', e.target.value)}
					/>
					<Input
						label={t('productForm.email')}
						placeholder="jane@example.com"
						type="email"
						value={form.founderEmail}
						onChange={(e) => update('founderEmail', e.target.value)}
					/>
				</div>
			</div>

			<div className="border-t border-border pt-4 mt-4">
				<div className="text-xs font-semibold mb-3">{t('productForm.socialLinks')}</div>
				<div className="space-y-3">
					{['twitter', 'github', 'linkedin', 'producthunt'].map((platform) => (
						<Input
							key={platform}
							label={platform.charAt(0).toUpperCase() + platform.slice(1)}
							placeholder={`https://${platform}.com/...`}
							value={form.socialLinks[platform] ?? ''}
							onChange={(e) =>
								update('socialLinks', { ...form.socialLinks, [platform]: e.target.value })
							}
						/>
					))}
				</div>
			</div>
		</>
	)
}
