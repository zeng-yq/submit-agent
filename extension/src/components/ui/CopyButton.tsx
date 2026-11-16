import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/cn'

interface CopyButtonProps {
	copied: boolean
	onCopy: () => void
	label: string
	disabled?: boolean
}

/** 复制按钮：点击后变珊瑚对勾（coral 只作 settled 信号），由父级持有 copied 状态与反馈计时 */
export function CopyButton({ copied, onCopy, label, disabled }: CopyButtonProps) {
	return (
		<button
			type="button"
			className={cn(
				'relative rounded p-1.5 cursor-pointer',
				'after:absolute after:-inset-1.5 after:content-[""]',
				'transition-colors duration-150 motion-reduce:transition-none',
				copied
					? 'text-signal-strong'
					: 'text-muted-foreground hover:bg-muted hover:text-foreground',
				'disabled:pointer-events-none disabled:opacity-40 disabled:cursor-not-allowed'
			)}
			onClick={onCopy}
			aria-label={label}
			disabled={disabled}
		>
			{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
		</button>
	)
}
