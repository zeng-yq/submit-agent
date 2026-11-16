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
					<label htmlFor={inputId} className="text-xs font-medium text-foreground">
						{label}
					</label>
				)}
				<div className="relative">
					<input
						ref={ref}
						id={inputId}
						className={cn(
							'h-9 w-full rounded-md border border-field-edge bg-card px-3 text-sm text-foreground',
							'placeholder:text-muted-foreground',
							'transition-colors duration-200 motion-reduce:transition-none',
							'hover:bg-muted',
							'disabled:opacity-55 disabled:cursor-not-allowed',
							'aria-[invalid=true]:border-destructive',
							suffix && 'pr-10',
							className
						)}
						{...props}
					/>
					{suffix && (
						<div className="absolute right-0 top-0 h-full flex items-center pr-2.5">
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
