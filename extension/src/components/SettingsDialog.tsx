import { useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Dialog, DialogHeader, DialogTitle, DialogCloseButton, DialogContent, DialogFooter } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import {
	getActiveProvider,
	getLLMApiKey,
	setActiveProvider,
	setLLMApiKey,
	LLM_PROVIDERS,
	type LLMProviderId,
} from '@/lib/storage'
import { testLLMConnection, type TestResult } from '@/lib/llm-test'
import { toErrorMessage } from '@/lib/to-error-message'
import { cn } from '@/lib/cn'

const TEST_FAIL_MESSAGES: Record<Exclude<TestResult, { ok: true }>['code'], string> = {
	unreachable: '无法连接端点，请检查网络',
	unauthorized: 'API Key 无效或无权限，请核对后重试',
	not_found: '端点不存在，请检查网络或代理',
	model_not_found: '模型不可用，请稍后重试或联系维护者',
	rate_limit: '请求频率超限，请稍后重试',
	server_error: '服务端错误，请稍后重试',
	unknown: '未知错误',
}

function describeFail(result: Exclude<TestResult, { ok: true }>): string {
	const base = TEST_FAIL_MESSAGES[result.code]
	const detail = (result.detail ?? '').trim().slice(0, 200)
	return detail ? `${base}（${detail}）` : base
}

const PROVIDER_IDS = Object.keys(LLM_PROVIDERS) as LLMProviderId[]

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
	const [provider, setProvider] = useState<LLMProviderId>('deepseek')
	const [apiKey, setApiKey] = useState('')
	const [keyVisible, setKeyVisible] = useState(false)
	const [loadError, setLoadError] = useState('')
	const [saveOutcome, setSaveOutcome] = useState<{ ok: boolean; message: string } | null>(null)
	const [testing, setTesting] = useState(false)
	const [testOutcome, setTestOutcome] = useState<{ ok: boolean; message: string } | null>(null)

	useEffect(() => {
		if (!open) return
		setKeyVisible(false)
		setLoadError('')
		setSaveOutcome(null)
		setTestOutcome(null)
		getActiveProvider()
			.then(async (activeProvider) => {
				setProvider(activeProvider)
				setApiKey(await getLLMApiKey(activeProvider))
			})
			.catch((err: unknown) => setLoadError(`读取已存配置失败: ${toErrorMessage(err)}`))
	}, [open])

	/** 切换即启用，并载入该供应商已存的 Key */
	async function handleSelectProvider(next: LLMProviderId) {
		if (next === provider) return
		try {
			const nextKey = await getLLMApiKey(next)
			await setActiveProvider(next)
			setProvider(next)
			setApiKey(nextKey)
			setSaveOutcome(null)
			setTestOutcome(null)
			setLoadError('')
		} catch (err: unknown) {
			setLoadError(`切换供应商失败: ${toErrorMessage(err)}`)
		}
	}

	async function handleSave() {
		const trimmed = apiKey.trim()
		setApiKey(trimmed)
		try {
			await setLLMApiKey(provider, trimmed)
			setSaveOutcome({ ok: true, message: trimmed ? '已保存' : '已清空' })
			setTestOutcome(null)
		} catch (err: unknown) {
			setSaveOutcome({ ok: false, message: `保存失败: ${toErrorMessage(err)}` })
		}
	}

	async function handleTest() {
		const trimmed = apiKey.trim()
		setApiKey(trimmed)
		if (!trimmed) {
			setTestOutcome({ ok: false, message: '请先填写 API Key 再测试连接' })
			return
		}
		setTesting(true)
		setTestOutcome(null)
		const providerConfig = LLM_PROVIDERS[provider]
		try {
			const result = await testLLMConnection({
				apiKey: trimmed,
				baseUrl: providerConfig.baseUrl,
				model: providerConfig.model,
			})
			setTestOutcome(
				result.ok
					? { ok: true, message: `连接成功，${providerConfig.label} Key 可用` }
					: { ok: false, message: describeFail(result) },
			)
		} catch (err: unknown) {
			setTestOutcome({ ok: false, message: `测试请求异常: ${toErrorMessage(err)}` })
		} finally {
			setTesting(false)
		}
	}

	return (
		<Dialog open={open} onClose={onClose}>
			<DialogHeader>
				<DialogTitle>LLM 设置</DialogTitle>
				<DialogCloseButton onClose={onClose} />
			</DialogHeader>
			<DialogContent>
				<div className="space-y-1">
					<span className="text-sm font-medium text-foreground">供应商</span>
					<div className="flex gap-1 rounded-lg border border-border bg-muted/50 p-1">
						{PROVIDER_IDS.map((id) => (
							<button
								key={id}
								type="button"
								className={cn(
									'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
									provider === id
										? 'bg-background text-foreground shadow-sm'
										: 'text-muted-foreground hover:text-foreground',
								)}
								onClick={() => void handleSelectProvider(id)}
							>
								{LLM_PROVIDERS[id].label}
							</button>
						))}
					</div>
					<p className="text-xs text-muted-foreground">
						{LLM_PROVIDERS[provider].label} · {LLM_PROVIDERS[provider].model}（模型固定）
					</p>
				</div>

				<Input
					label="API Key"
					type={keyVisible ? 'text' : 'password'}
					placeholder={`粘贴 ${LLM_PROVIDERS[provider].label} API Key`}
					value={apiKey}
					onChange={(e) => {
						setApiKey(e.target.value)
						setSaveOutcome(null)
					}}
					autoComplete="off"
					suffix={
						<button
							type="button"
							className="p-1 rounded text-muted-foreground/60 hover:text-foreground"
							onClick={() => setKeyVisible((v) => !v)}
							aria-label={keyVisible ? '隐藏 Key' : '显示 Key'}
						>
							{keyVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
						</button>
					}
				/>
				{loadError && <p className="text-xs text-destructive">{loadError}</p>}
				{saveOutcome && (
					<p className={`text-xs ${saveOutcome.ok ? 'text-muted-foreground' : 'text-destructive'}`}>
						{saveOutcome.message}
					</p>
				)}
				{testOutcome && (
					<p className={`text-xs ${testOutcome.ok ? 'text-success' : 'text-destructive'}`}>
						{testOutcome.message}
					</p>
				)}
			</DialogContent>
			<DialogFooter>
				<Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
					{testing ? '测试中…' : '测试连接'}
				</Button>
				<Button size="sm" onClick={handleSave}>
					保存
				</Button>
			</DialogFooter>
		</Dialog>
	)
}
