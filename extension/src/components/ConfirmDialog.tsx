import { Dialog, DialogHeader, DialogTitle, DialogCloseButton, DialogContent, DialogFooter } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'

interface ConfirmDialogProps {
	open: boolean
	title: string
	message: string
	confirmLabel?: string
	/** 破坏性操作时确认按钮用红色 */
	destructive?: boolean
	onConfirm: () => void
	onClose: () => void
}

/** 确认弹窗：与添加产品弹窗同一 Dialog 体系，替代浏览器原生 confirm；默认焦点在取消上 */
export function ConfirmDialog({
	open,
	title,
	message,
	confirmLabel = '确认',
	destructive = false,
	onConfirm,
	onClose,
}: ConfirmDialogProps) {
	return (
		<Dialog open={open} onClose={onClose}>
			<DialogHeader>
				<DialogTitle>{title}</DialogTitle>
				<DialogCloseButton onClose={onClose} />
			</DialogHeader>
			<DialogContent>
				<p className="text-sm leading-relaxed text-muted-foreground">{message}</p>
			</DialogContent>
			<DialogFooter>
				<Button variant="outline" size="sm" autoFocus onClick={onClose}>
					取消
				</Button>
				<Button variant={destructive ? 'destructive' : 'default'} size="sm" onClick={onConfirm}>
					{confirmLabel}
				</Button>
			</DialogFooter>
		</Dialog>
	)
}
