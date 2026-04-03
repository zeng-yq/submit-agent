import { cn } from '@/lib/cn'
import type { InputHTMLAttributes, ReactNode } from 'react'
import { forwardRef } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
	label?: string
	error?: string
	suffix?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
	({ label, error, suffix, className, id, ...props }, ref) => {
		const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')

		return (
			<div className="flex flex-col gap-1.5">
				{label && (
					<label htmlFor={inputId} className="text-sm font-medium text-foreground">
						{label}
					</label>
				)}
				<div className="relative">
					<input
						ref={ref}
						id={inputId}
						className={cn(
							'h-11 w-full rounded-lg border border-border bg-background px-4 text-base',
							'placeholder:text-muted-foreground/60',
							'transition-shadow duration-150',
							'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/60',
							'disabled:opacity-50',
							error && 'border-destructive focus:ring-destructive/30',
							suffix && 'pr-11',
							className
						)}
						{...props}
					/>
					{suffix && (
						<div className="absolute right-0 top-0 h-full flex items-center pr-3">
							{suffix}
						</div>
					)}
				</div>
				{error && <span className="text-xs text-destructive">{error}</span>}
			</div>
		)
	}
)

Input.displayName = 'Input'
