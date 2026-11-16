import { cn } from '@/lib/cn'
import type { ButtonHTMLAttributes } from 'react'

type Variant = 'default' | 'outline' | 'ghost' | 'destructive' | 'success'
type Size = 'xs' | 'sm' | 'md' | 'lg' | 'icon'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: Variant
	size?: Size
}

/** letterpress 控件（Coral）：default 是 ink board 压印，outline 是棉纸卡 */
const variantStyles: Record<Variant, string> = {
	default:
		'bg-primary text-primary-foreground shadow-deck [text-shadow:0_-0.5px_0_oklch(7%_0.01_40_/_0.55)] hover:bg-foreground active:translate-y-px',
	outline: 'bg-card text-foreground shadow-stock hover:shadow-cast-lift active:translate-y-px',
	ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
	destructive:
		'bg-destructive text-destructive-foreground hover:brightness-110 active:translate-y-px',
	success: 'bg-success text-success-foreground hover:brightness-110 active:translate-y-px',
}

const sizeStyles: Record<Size, string> = {
	xs: 'h-7 px-2.5 text-xs',
	sm: 'h-8 px-3 text-xs',
	md: 'h-9 px-4 text-sm',
	lg: 'h-10 px-5 text-base',
	icon: 'h-8 w-8',
}

export function Button({ variant = 'default', size = 'md', className, ...props }: ButtonProps) {
	return (
		<button
			className={cn(
				'inline-flex items-center justify-center gap-1.5 rounded-md font-medium',
				'transition-[background-color,color,transform,box-shadow,filter] duration-200',
				'motion-reduce:transition-none',
				'disabled:pointer-events-none disabled:opacity-55 disabled:cursor-not-allowed',
				'cursor-pointer',
				variantStyles[variant],
				sizeStyles[size],
				className
			)}
			{...props}
		/>
	)
}
