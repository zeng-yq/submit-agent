import { useState, useCallback, useRef, useEffect } from 'react'
import { isLLMConfigured } from '@/agent/constants'
import { getLLMConfig } from '@/lib/storage'
import { generateProfile, type GeneratedProfile } from '@/lib/profile-generator'
import { ProductForm, type FormData } from './ProductForm'
import { Button } from './ui/Button'
import { Input } from './ui/Input'

interface QuickCreateProps {
	onSave: (data: FormData) => Promise<void>
	onSkip: () => void
	onOpenSettings?: () => void
}

type Step = 'input' | 'generating' | 'review' | 'error'

export function QuickCreate({ onSave, onSkip, onOpenSettings }: QuickCreateProps) {
	const [url, setUrl] = useState('')
	const [step, setStep] = useState<Step>('input')
	const [profile, setProfile] = useState<GeneratedProfile | null>(null)
	const [error, setError] = useState('')
	const [llmReady, setLlmReady] = useState<boolean | null>(null)
	const abortRef = useRef<AbortController | null>(null)

	useEffect(() => {
		getLLMConfig().then((config) => setLlmReady(isLLMConfigured(config)))
	}, [])

	const handleGenerate = useCallback(async () => {
		const trimmed = url.trim()
		if (!trimmed) return

		let normalized = trimmed
		if (!/^https?:\/\//i.test(normalized)) {
			normalized = `https://${normalized}`
		}

		abortRef.current?.abort()
		const controller = new AbortController()
		abortRef.current = controller

		setStep('generating')
		setError('')

		try {
			const result = await generateProfile(normalized, controller.signal)
			if (!result.name) {
				result.name = new URL(normalized).hostname.replace(/^www\./, '')
			}
			result.url = normalized
			setProfile(result)
			setStep('review')
		} catch (err) {
			if ((err as Error).name === 'AbortError') return
			setError((err as Error).message || 'Generation failed')
			setStep('error')
		}
	}, [url])

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault()
				handleGenerate()
			}
		},
		[handleGenerate]
	)

	if (step === 'review' && profile) {
		return (
			<div className="space-y-3">
				<div className="text-xs text-muted-foreground">
					Review the AI-generated profile and edit as needed.
				</div>
				<ProductForm
					initial={profile as FormData}
					compact
					onSave={onSave}
					onCancel={() => {
						setStep('input')
						setProfile(null)
					}}
					submitLabel="Save & Continue"
				/>
			</div>
		)
	}

	return (
		<div className="flex flex-col items-center justify-center h-full gap-4 px-4">
			<div className="text-center space-y-1">
				<div className="text-sm font-semibold">Welcome to Submit Agent</div>
				<div className="text-xs text-muted-foreground">
					{llmReady === false
						? 'Configure your LLM API first, then paste your product URL to auto-generate a profile.'
						: 'Paste your product URL and AI will generate a profile for directory submissions.'}
				</div>
			</div>

			{llmReady === false && (
				<div className="w-full max-w-sm">
					<div className="text-xs text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950 rounded p-3 space-y-2">
						<div className="font-medium">LLM API required</div>
						<div>
							To use AI features, configure an OpenAI-compatible API endpoint
							(OpenAI, DeepSeek, Qwen, etc.) in Settings.
						</div>
						{onOpenSettings && (
							<Button size="sm" className="w-full" onClick={onOpenSettings}>
								Open Settings
							</Button>
						)}
					</div>
				</div>
			)}

			<div className="w-full max-w-sm space-y-3">
				<Input
					placeholder="https://your-product.com"
					value={url}
					onChange={(e) => setUrl(e.target.value)}
					onKeyDown={handleKeyDown}
					disabled={step === 'generating' || llmReady === false}
				/>

				{step === 'error' && (
					<div className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1.5">
						{error}
					</div>
				)}

				<Button
					className="w-full"
					onClick={handleGenerate}
					disabled={!url.trim() || step === 'generating' || llmReady === false}
				>
					{step === 'generating' ? 'Analyzing your product...' : 'Generate Profile'}
				</Button>

				<button
					type="button"
					className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
					onClick={onSkip}
				>
					or create a profile manually
				</button>
			</div>
		</div>
	)
}
