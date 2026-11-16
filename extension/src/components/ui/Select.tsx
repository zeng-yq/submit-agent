import { cn } from '@/lib/cn'
import type { SelectHTMLAttributes } from 'react'
import { forwardRef } from 'react'
import { ChevronDown } from 'lucide-react'

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
	label?: string
	options: { value: string; label: string }[]
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
	({ label, options, className, id, ...props }, ref) => {
		const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-')

		return (
			<div className="flex flex-col gap-1">
				{label && (
					<label htmlFor={selectId} className="text-xs font-medium text-foreground">
						{label}
					</label>
				)}
				<div className="relative">
					<select
						ref={ref}
						id={selectId}
						className={cn(
							'h-9 w-full appearance-none rounded-md border border-field-edge bg-card pl-3 pr-8 text-sm text-foreground',
							'transition-colors duration-200 motion-reduce:transition-none',
							'hover:bg-muted',
							'disabled:opacity-55 disabled:cursor-not-allowed',
							className
						)}
						{...props}
					>
						{options.map((opt) => (
							<option key={opt.value} value={opt.value}>
								{opt.label}
							</option>
						))}
					</select>
					<ChevronDown
						className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
						aria-hidden="true"
					/>
				</div>
			</div>
		)
	}
)

Select.displayName = 'Select'
