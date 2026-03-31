import { isUsingBuiltinLLM, BUILTIN_LLM_CONFIG } from '@/agent/constants'
import type { LLMSettings } from '@/lib/types'
import { useCallback, useEffect, useState } from 'react'
import { getLLMConfig, setLLMConfig, getFloatButtonEnabled, setFloatButtonEnabled } from '@/lib/storage'
import { useLocale, useT } from '@/hooks/useLanguage'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Select } from './ui/Select'

interface SettingsPanelProps {
	onClose: () => void
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
	const t = useT()
	const { locale, setLocale } = useLocale()
	const [llm, setLlm] = useState<LLMSettings>({ apiKey: '', baseUrl: '', model: '' })
	const [lang, setLang] = useState(locale)
	const [floatEnabled, setFloatEnabled] = useState(true)
	const [saving, setSaving] = useState(false)
	const [loaded, setLoaded] = useState(false)
	const [usingBuiltin, setUsingBuiltin] = useState(false)

	useEffect(() => {
		Promise.all([getLLMConfig(), getFloatButtonEnabled()]).then(([llmConfig, floatBtn]) => {
			const builtin = isUsingBuiltinLLM(llmConfig)
			setUsingBuiltin(builtin)
			setLlm(builtin ? { apiKey: '', baseUrl: '', model: '' } : llmConfig)
			setFloatEnabled(floatBtn)
			setLoaded(true)
		})
	}, [])

	const handleSave = useCallback(async () => {
		setSaving(true)
		try {
			await setLLMConfig(llm)
			setLocale(lang)
			chrome.runtime.sendMessage({ type: 'FLOAT_BUTTON_TOGGLE', enabled: floatEnabled }).catch(() => {})
			onClose()
		} finally {
			setSaving(false)
		}
	}, [llm, lang, floatEnabled, onClose, setLocale])

	const hasCustomConfig = !!(llm.baseUrl && llm.model)
	const canSave = hasCustomConfig || (!llm.baseUrl && !llm.model)

	if (!loaded) {
		return <div className="p-4 text-xs text-muted-foreground">{t('common.loading')}</div>
	}

	return (
		<div className="flex flex-col h-full">
			<header className="flex items-center justify-between border-b px-3 py-2">
				<span className="text-sm font-semibold">{t('settings.title')}</span>
				<Button variant="ghost" size="sm" onClick={onClose}>
					{t('common.back')}
				</Button>
			</header>

			<div className="flex-1 overflow-y-auto p-3 space-y-4">
				<div className="text-xs font-semibold">{t('settings.llmConfig')}</div>

				{usingBuiltin && !hasCustomConfig ? (
					<div className="text-xs text-green-700 bg-green-50 dark:text-green-400 dark:bg-green-950 rounded p-2 space-y-1">
						<div className="font-medium">{t('settings.builtinTitle')}</div>
						<div>{t('settings.builtinDesc')}</div>
					</div>
				) : !hasCustomConfig ? (
					<div className="text-xs text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950 rounded p-2 space-y-1">
						<div className="font-medium">{t('settings.customTitle')}</div>
						<div>{t('settings.customDesc')}</div>
					</div>
				) : null}

				<Input
					label={t('settings.baseUrl')}
					placeholder={`${BUILTIN_LLM_CONFIG.baseUrl} ${t('settings.builtinDefault')}`}
					value={llm.baseUrl}
					onChange={(e) => setLlm((prev) => ({ ...prev, baseUrl: e.target.value }))}
				/>

				<Input
					label={t('settings.apiKey')}
					placeholder={t('settings.apiKeyPlaceholder')}
					type="password"
					value={llm.apiKey}
					onChange={(e) => setLlm((prev) => ({ ...prev, apiKey: e.target.value }))}
				/>

				<Input
					label={t('settings.model')}
					placeholder={`${BUILTIN_LLM_CONFIG.model} ${t('settings.builtinDefault')}`}
					value={llm.model}
					onChange={(e) => setLlm((prev) => ({ ...prev, model: e.target.value }))}
				/>

				<div className="border-t border-border pt-4">
					<Select
						label={t('settings.language')}
						value={lang}
						onChange={(e) => setLang(e.target.value as 'en' | 'zh')}
						options={[
							{ value: 'en', label: 'English' },
							{ value: 'zh', label: '中文' },
						]}
					/>
				</div>

				<div className="border-t border-border pt-4 flex items-center justify-between">
					<span className="text-xs font-medium text-foreground">{t('settings.showFloatButton')}</span>
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
					{saving ? t('common.saving') : t('settings.saveSettings')}
				</Button>
				{llm.baseUrl && !llm.model && (
					<div className="text-xs text-amber-600 dark:text-amber-400 mt-2 text-center">
						{t('settings.modelRequired')}
					</div>
				)}
			</footer>
		</div>
	)
}
