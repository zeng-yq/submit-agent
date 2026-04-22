import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { X } from 'lucide-react'

interface DialogProps {
  open: boolean
  onClose: () => void
  children: ReactNode
}

export function Dialog({ open, onClose, children }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        ref={dialogRef}
        className="w-full max-w-md bg-popover border border-border rounded-lg shadow-xl mx-4"
      >
        {children}
      </div>
    </div>
  )
}

export function DialogHeader({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('flex items-center justify-between px-4 pt-4 pb-2', className)}>
      {children}
    </div>
  )
}

export function DialogTitle({ className, children }: { className?: string; children: ReactNode }) {
  return <h3 className={cn('text-sm font-semibold text-foreground', className)}>{children}</h3>
}

export function DialogDescription({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cn('text-xs text-muted-foreground mt-0.5', className)}>{children}</p>
}

interface DialogCloseButtonProps {
  onClose: () => void
}

export function DialogCloseButton({ onClose }: DialogCloseButtonProps) {
  return (
    <button
      type="button"
      className="p-1 rounded text-muted-foreground/50 hover:text-foreground hover:bg-accent transition-colors"
      onClick={onClose}
    >
      <X className="w-4 h-4" />
    </button>
  )
}

export function DialogContent({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('px-4 py-3 space-y-3', className)}>{children}</div>
}

export function DialogFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('flex items-center justify-end gap-2 px-4 pb-4 pt-2', className)}>
      {children}
    </div>
  )
}
