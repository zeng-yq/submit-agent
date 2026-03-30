import { isLLMConfigured, isUsingBuiltinLLM, BUILTIN_LLM_CONFIG } from '@/agent/constants'
import type { LLMSettings } from '@/lib/types'
import { useCallback, useEffect, useState } from 'react'
import { getLLMConfig, setLLMConfig, getLanguage, setLanguage, getFloatButtonEnabled, setFloatButtonEnabled } from '@/lib/storage'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Select } from './ui/Select'

interface SettingsPanelProps {
	onClose: () => void
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
	const [llm, setLlm] = useState<LLMSettings>({ apiKey: '', baseUrl: '', model: '' })
	const [lang, setLang] = useState<'en' | 'zh'>('en')
	const [floatEnabled, setFloatEnabled] = useState(true)
	const [saving, setSaving] = useState(false)
	const [loaded, setLoaded] = useState(false)
	const [usingBuiltin, setUsingBuiltin] = useState(false)

	useEffect(() => {
		Promise.all([getLLMConfig(), getLanguage(), getFloatButtonEnabled()]).then(([llmConfig, language, floatBtn]) => {
			const builtin = isUsingBuiltinLLM(llmConfig)
			setUsingBuiltin(builtin)
			// Show empty fields when using builtin so user can fill in their own
			setLlm(builtin ? { apiKey: '', baseUrl: '', model: '' } : llmConfig)
			setLang(language)
			setFloatEnabled(floatBtn)
			setLoaded(true)
		})
	}, [])

	const handleSave = useCallback(async () => {
		setSaving(true)
		try {
			// If user cleared everything, save empty so storage fallback kicks in
			await setLLMConfig(llm)
			await setLanguage(lang)
			chrome.runtime.sendMessage({ type: 'FLOAT_BUTTON_TOGGLE', enabled: floatEnabled }).catch(() => {})
			onClose()
		} finally {
			setSaving(false)
		}
	}, [llm, lang, floatEnabled, onClose])

	const hasCustomConfig = !!(llm.baseUrl && llm.model)
	const canSave = hasCustomConfig || (!llm.baseUrl && !llm.model)

	if (!loaded) {
		return <div className="p-4 text-xs text-muted-foreground">Loading settings...</div>
	}

	return (
		<div className="flex flex-col h-full">
			<header className="flex items-center justify-between border-b px-3 py-2">
				<span className="text-sm font-semibold">Settings</span>
				<Button variant="ghost" size="sm" onClick={onClose}>
					Back
				</Button>
			</header>

			<div className="flex-1 overflow-y-auto p-3 space-y-4">
				<div className="text-xs font-semibold">LLM Configuration</div>

				{usingBuiltin && !hasCustomConfig ? (
					<div className="text-xs text-green-700 bg-green-50 dark:text-green-400 dark:bg-green-950 rounded p-2 space-y-1">
						<div className="font-medium">Using built-in AI (Groq)</div>
						<div>Ready to use — no configuration needed. Enter your own API key below to use a different provider.</div>
					</div>
				) : !hasCustomConfig ? (
					<div className="text-xs text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950 rounded p-2 space-y-1">
						<div className="font-medium">Using custom LLM</div>
						<div>
							Enter an OpenAI-compatible API endpoint and model. Works with OpenAI, DeepSeek, Groq, and others.
						</div>
					</div>
				) : null}

				<Input
					label="Base URL"
					placeholder={`${BUILTIN_LLM_CONFIG.baseUrl} (built-in default)`}
					value={llm.baseUrl}
					onChange={(e) => setLlm((prev) => ({ ...prev, baseUrl: e.target.value }))}
				/>

				<Input
					label="API Key"
					placeholder="Leave empty to use built-in default"
					type="password"
					value={llm.apiKey}
					onChange={(e) => setLlm((prev) => ({ ...prev, apiKey: e.target.value }))}
				/>

				<Input
					label="Model"
					placeholder={`${BUILTIN_LLM_CONFIG.model} (built-in default)`}
					value={llm.model}
					onChange={(e) => setLlm((prev) => ({ ...prev, model: e.target.value }))}
				/>

				<div className="border-t border-border pt-4">
					<Select
						label="Language"
						value={lang}
						onChange={(e) => setLang(e.target.value as 'en' | 'zh')}
						options={[
							{ value: 'en', label: 'English' },
							{ value: 'zh', label: '中文' },
						]}
					/>
				</div>

				<div className="border-t border-border pt-4 flex items-center justify-between">
					<span className="text-xs font-medium text-foreground">Show float button</span>
					<button
						type="button"
						role="switch"
						aria-checked={floatEnabled}
						onClick={() => setFloatEnabled((v) => !v)}
						className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
							floatEnabled ? 'bg-primary' : 'bg-muted'
						}`}
					>
						<span
							className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
								floatEnabled ? 'translate-x-4' : 'translate-x-1'
							}`}
						/>
					</button>
				</div>
			</div>

			<footer className="border-t p-3">
				<Button
					onClick={handleSave}
					disabled={saving || !canSave}
					className="w-full"
				>
					{saving ? 'Saving...' : 'Save Settings'}
				</Button>
				{llm.baseUrl && !llm.model && (
					<div className="text-xs text-amber-600 dark:text-amber-400 mt-2 text-center">
						Model name is required
					</div>
				)}
			</footer>
		</div>
	)
}
