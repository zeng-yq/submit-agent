import { useState, useCallback, useRef, useEffect } from 'react'
import { getLLMConfig } from '@/lib/storage'
import { generateProfile, type GeneratedProfile, type GenerateProgressStep } from '@/lib/profile-generator'
import { ProductForm, type FormData } from './ProductForm'
import { Button } from './ui/Button'
import { Input } from './ui/Input'

interface QuickCreateProps {
	onSave: (data: FormData) => Promise<void>
	onSkip: () => void
	onOpenSettings?: () => void
}

type Step = 'input' | 'generating' | 'review' | 'error'

const PROGRESS_STEP_LABELS: Record<GenerateProgressStep, string> = {
	fetching: '正在获取网页内容...',
	parsing: '正在解析页面结构...',
	analyzing: '正在用 AI 分析产品...',
	generating: '正在生成目录资料...',
	done: '资料已就绪！',
}

const PROGRESS_STEP_ORDER: GenerateProgressStep[] = ['fetching', 'parsing', 'analyzing', 'generating', 'done']

function StepIndicator({ current }: { current: 1 | 2 }) {
	return (
		<div className="flex items-center gap-3">
			<div className="flex items-center gap-2">
				<div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${
					current >= 1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
				}`}>1</div>
				<span className={`text-sm ${ current === 1 ? 'font-medium text-foreground' : 'text-muted-foreground' }`}>
					{'你的产品'}
				</span>
			</div>
			<div className="flex-1 h-px bg-border" />
			<div className="flex items-center gap-2">
				<div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${
					current >= 2 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
				}`}>2</div>
				<span className={`text-sm ${ current === 2 ? 'font-medium text-foreground' : 'text-muted-foreground' }`}>
					{'确认资料'}
				</span>
			</div>
		</div>
	)
}

function GeneratingView({ currentStep, onCancel }: { currentStep: GenerateProgressStep | null; onCancel: () => void }) {
	const currentIndex = PROGRESS_STEP_ORDER.findIndex((s) => s === currentStep)

	return (
		<div className="flex flex-col pt-16 px-6">
			<div className="text-lg font-semibold tracking-tight text-foreground mb-6">
				{'正在分析你的产品...'}
			</div>
			<div className="flex flex-col gap-3.5">
				{PROGRESS_STEP_ORDER.filter((s) => s !== 'done').map((key, i) => {
					const isDone = currentIndex > i
					const isActive = currentIndex === i
					return (
						<div key={key} className={`flex items-center gap-3 text-sm transition-colors duration-200 ${
							isDone ? 'text-success'
							: isActive ? 'text-foreground font-medium'
							: 'text-muted-foreground/50'
						}`}>
							{isDone ? (
								<svg className="w-4.5 h-4.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
									<path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
								</svg>
							) : isActive ? (
								<span className="w-4.5 flex justify-center shrink-0">
									<SpinnerIcon />
								</span>
							) : (
								<span className="w-4.5 text-center shrink-0 text-muted-foreground/30">
									<svg className="w-1.5 h-1.5 mx-auto" viewBox="0 0 6 6" fill="currentColor">
										<circle cx="3" cy="3" r="3" />
									</svg>
								</span>
							)}
							<span>{PROGRESS_STEP_LABELS[key]}</span>
						</div>
					)
				})}
			</div>
			<div className="mt-10">
				<Button variant="ghost" size="sm" onClick={onCancel} className="w-full text-muted-foreground">
					{'取消'}
				</Button>
			</div>
		</div>
	)
}

function SpinnerIcon() {
	return (
		<svg className="animate-spin h-4 w-4 text-primary" viewBox="0 0 24 24" fill="none">
			<circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
			<path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
		</svg>
	)
}

export function QuickCreate({ onSave, onSkip, onOpenSettings }: QuickCreateProps) {
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
			setError((err as Error)?.message ?? '错误')
			setStep('error')
		}
	}, [url])

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
				<header className="border-b border-border/60 px-5 py-3">
					<StepIndicator current={2} />
				</header>
				<div className="flex-1 overflow-y-auto p-5">
					<ProductForm
						initial={initial}
						compact
						onSave={onSave}
						submitLabel={'保存并开始提交'}
					/>
				</div>
			</div>
		)
	}

	if (step === 'generating') {
		return (
			<div className="flex flex-col h-full">
				<GeneratingView currentStep={progressStep} onCancel={handleCancel} />
			</div>
		)
	}

	return (
		<div className="flex flex-col h-full">
			<div className="flex-1 overflow-y-auto">
				<div className="flex flex-col pt-16 px-6">
					<h1 className="text-xl font-semibold tracking-tight text-foreground">
						{'添加你的产品'}
					</h1>
					<p className="text-sm text-muted-foreground mt-2 mb-10">
						{'输入产品 URL，AI 将自动分析页面并创建提交资料。'}
					</p>

					{llmReady === false && (
						<div className="text-sm text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/50 rounded-lg p-4 mb-6 space-y-2">
							<div className="font-medium">{'LLM 未配置'}</div>
							<div className="text-amber-600 dark:text-amber-400 text-xs">{'请先在设置中配置 LLM 才能使用 AI 功能。'}</div>
							{onOpenSettings && (
								<Button size="sm" className="w-full mt-1" onClick={onOpenSettings}>
									{'打开设置'}
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
						<div className="text-sm text-destructive bg-destructive/8 rounded-lg px-4 py-3 mt-4">
							{error}
						</div>
					)}

					<Button
						className="w-full mt-5 rounded-xl"
						size="lg"
						onClick={handleGenerate}
						disabled={!url.trim() || llmReady === false}
					>
						{'生成资料'}
					</Button>

					<button
						type="button"
						className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors mt-6 cursor-pointer"
						onClick={onSkip}
					>
						{'或手动创建资料'}
					</button>
				</div>
			</div>
		</div>
	)
}
