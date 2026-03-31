import { useState, useCallback, useRef, useEffect } from 'react'
import { getLLMConfig } from '@/lib/storage'
import { generateProfile, type GeneratedProfile, type GenerateProgressStep } from '@/lib/profile-generator'
import { useT } from '@/hooks/useLanguage'
import type { TranslationKey } from '@/lib/i18n'
import { ProductForm, type FormData } from './ProductForm'
import { Button } from './ui/Button'
import { Input } from './ui/Input'

interface QuickCreateProps {
	onSave: (data: FormData) => Promise<void>
	onSkip: () => void
	onOpenSettings?: () => void
}

type Step = 'input' | 'generating' | 'review' | 'error'

const PROGRESS_STEP_KEYS: { key: GenerateProgressStep; labelKey: TranslationKey }[] = [
	{ key: 'fetching', labelKey: 'quickCreate.fetching' },
	{ key: 'parsing', labelKey: 'quickCreate.parsing' },
	{ key: 'analyzing', labelKey: 'quickCreate.aiAnalyzing' },
	{ key: 'generating', labelKey: 'quickCreate.building' },
	{ key: 'done', labelKey: 'quickCreate.profileReady' },
]

function StepIndicator({ current }: { current: 1 | 2 }) {
	const t = useT()
	return (
		<div className="flex items-center gap-2">
			<div className="flex items-center gap-1.5">
				<div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
					current >= 1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
				}`}>1</div>
				<span className={`text-xs ${ current === 1 ? 'font-medium text-foreground' : 'text-muted-foreground' }`}>
					{t('quickCreate.step1')}
				</span>
			</div>
			<div className="flex-1 h-px bg-border mx-1" />
			<div className="flex items-center gap-1.5">
				<div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
					current >= 2 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
				}`}>2</div>
				<span className={`text-xs ${ current === 2 ? 'font-medium text-foreground' : 'text-muted-foreground' }`}>
					{t('quickCreate.step2')}
				</span>
			</div>
		</div>
	)
}

function GeneratingView({ currentStep }: { currentStep: GenerateProgressStep | null }) {
	const t = useT()
	const currentIndex = PROGRESS_STEP_KEYS.findIndex((s) => s.key === currentStep)

	return (
		<div className="flex flex-col gap-3 py-2">
			<div className="text-xs font-medium text-foreground">{t('quickCreate.analyzing')}</div>
			<div className="flex flex-col gap-2">
				{PROGRESS_STEP_KEYS.filter((s) => s.key !== 'done').map((s, i) => {
					const isDone = currentIndex > i
					const isActive = currentIndex === i
					return (
						<div key={s.key} className={`flex items-center gap-2 text-xs transition-colors ${
							isDone ? 'text-green-600 dark:text-green-400'
							: isActive ? 'text-foreground font-medium'
							: 'text-muted-foreground'
						}`}>
							{isDone ? (
								<span className="w-4 text-center">✓</span>
							) : isActive ? (
								<span className="w-4 flex justify-center">
									<SpinnerIcon />
								</span>
							) : (
								<span className="w-4 text-center text-muted-foreground/40">·</span>
							)}
							<span>{t(s.labelKey)}</span>
						</div>
					)
				})}
			</div>
		</div>
	)
}

function SpinnerIcon() {
	return (
		<svg className="animate-spin h-3 w-3 text-primary" viewBox="0 0 24 24" fill="none">
			<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
			<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4l-3 3-3-3h4z" />
		</svg>
	)
}

export function QuickCreate({ onSave, onSkip, onOpenSettings }: QuickCreateProps) {
	const t = useT()
	const [url, setUrl] = useState('')
	const [step, setStep] = useState<Step>('input')
	const [profile, setProfile] = useState<GeneratedProfile | null>(null)
	const [error, setError] = useState('')
	const [llmReady, setLlmReady] = useState<boolean | null>(null)
	const [progressStep, setProgressStep] = useState<GenerateProgressStep | null>(null)
	const abortRef = useRef<AbortController | null>(null)

	useEffect(() => {
		getLLMConfig().then((config) => setLlmReady(!!(config.baseUrl && config.model)))
	}, [])

	const handleGenerate = useCallback(async () => {
		if (!url.trim()) return
		abortRef.current?.abort()
		const ac = new AbortController()
		abortRef.current = ac
		setStep('generating')
		setError('')
		setProgressStep('fetching')
		try {
			const result = await generateProfile(
				url.trim(),
				ac.signal,
				undefined,
				(s) => setProgressStep(s),
			)
			setProfile(result)
			setStep('review')
		} catch (err) {
			if ((err as Error)?.name === 'AbortError') return
			setError((err as Error)?.message ?? t('common.error'))
			setStep('error')
		}
	}, [url, t])

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === 'Enter') handleGenerate()
		},
		[handleGenerate],
	)

	const handleCancel = useCallback(() => {
		abortRef.current?.abort()
		setStep('input')
		setProgressStep(null)
	}, [])

	if (step === 'review' && profile) {
		const initial = {
			name: profile.name,
			url: profile.url || url,
			tagline: profile.tagline,
			shortDesc: profile.shortDesc,
			longDesc: profile.longDesc,
			categories: profile.categories,
			screenshots: [],
			founderName: '',
			founderEmail: '',
			socialLinks: {},
		}
		return (
			<div className="flex flex-col h-full">
				<header className="border-b px-3 py-2">
					<StepIndicator current={2} />
				</header>
				<div className="flex-1 overflow-y-auto p-3">
					<ProductForm
						initial={initial}
						compact
						onSave={onSave}
						submitLabel={t('quickCreate.saveAndStart')}
					/>
				</div>
			</div>
		)
	}

	return (
		<div className="flex flex-col h-full">
			<header className="border-b px-3 py-2">
				<StepIndicator current={1} />
			</header>
			<div className="flex-1 overflow-y-auto p-3">
				{step === 'generating' ? (
					<div className="flex flex-col gap-4">
						<GeneratingView currentStep={progressStep} />
						<Button variant="ghost" size="sm" onClick={handleCancel} className="w-full text-muted-foreground">
							{t('common.cancel')}
						</Button>
					</div>
				) : (
					<div className="flex flex-col gap-3">
						<div className="text-sm font-semibold">{t('quickCreate.addProduct')}</div>
						<div className="text-xs text-muted-foreground">
							{t('quickCreate.addProductDesc')}
						</div>

						{llmReady === false && (
							<div className="text-xs text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950 rounded p-2 space-y-1">
								<div className="font-medium">{t('quickCreate.llmNotConfigured')}</div>
								<div>{t('quickCreate.llmNotConfiguredDesc')}</div>
								{onOpenSettings && (
									<Button size="sm" className="w-full" onClick={onOpenSettings}>
										{t('quickCreate.openSettings')}
									</Button>
								)}
							</div>
						)}

						<Input
							placeholder="https://your-product.com"
							value={url}
							onChange={(e) => setUrl(e.target.value)}
							onKeyDown={handleKeyDown}
							disabled={llmReady === false}
							autoFocus
						/>

						{step === 'error' && (
							<div className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1.5">
								{error}
							</div>
						)}

						<Button
							className="w-full"
							onClick={handleGenerate}
							disabled={!url.trim() || llmReady === false}
						>
							{t('quickCreate.generateProfile')}
						</Button>

						<button
							type="button"
							className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
							onClick={onSkip}
						>
							{t('quickCreate.orManually')}
						</button>
					</div>
				)}
			</div>
		</div>
	)
}
