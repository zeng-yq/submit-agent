import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
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

  return createPortal(
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-foreground/45 p-4">
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-xl bg-card text-card-foreground shadow-cast-lift"
      >
        {children}
      </div>
    </div>,
    document.body
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
  return <h3 className={cn('text-base font-semibold text-foreground', className)}>{children}</h3>
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
      className="relative rounded-md p-1.5 cursor-pointer text-muted-foreground hover:bg-accent hover:text-foreground transition-colors duration-150 motion-reduce:transition-none after:absolute after:-inset-1 after:content-['']"
      onClick={onClose}
    >
      <X className="h-4 w-4" aria-hidden="true" />
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
