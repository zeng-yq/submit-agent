import { useState } from 'react'
import { Settings } from 'lucide-react'
import { SettingsDialog } from '@/components/SettingsDialog'

export default function App() {
	const [settingsOpen, setSettingsOpen] = useState(false)

	return (
		<div className="flex h-screen flex-col">
			<header className="flex items-center justify-between border-b border-border px-4 py-3">
				<div>
					<h1 className="text-base font-semibold">Submit Agent</h1>
					<p className="mt-0.5 text-xs text-muted-foreground">目录站提交资料生成助手</p>
				</div>
				<button
					type="button"
					className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					onClick={() => setSettingsOpen(true)}
					aria-label="打开设置"
				>
					<Settings className="h-4 w-4" />
				</button>
			</header>
			<main className="flex flex-1 items-center justify-center p-6">
				<p className="text-center text-sm text-muted-foreground">
					暂无产品。
					<br />
					产品添加与文案生成功能即将就绪。
				</p>
			</main>
			<SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
		</div>
	)
}
