import { Check, Copy } from 'lucide-react'

interface CopyButtonProps {
	copied: boolean
	onCopy: () => void
	label: string
	disabled?: boolean
}

/** 复制按钮：点击后图标变绿勾，由父级持有 copied 状态与反馈计时 */
export function CopyButton({ copied, onCopy, label, disabled }: CopyButtonProps) {
	return (
		<button
			type="button"
			className={`rounded p-1 transition-colors ${
				copied ? 'text-success' : 'text-muted-foreground/60 hover:bg-muted hover:text-foreground'
			} disabled:pointer-events-none disabled:opacity-40`}
			onClick={onCopy}
			aria-label={label}
			disabled={disabled}
		>
			{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
		</button>
	)
}
