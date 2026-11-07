import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] font-bold transition-[filter,background-color] disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:size-[18px] [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-brand text-white hover:brightness-110',
        secondary: 'border border-control bg-card text-ink hover:bg-hover',
        ghost: 'bg-transparent text-ink hover:bg-hover',
        danger: 'border border-danger bg-card text-danger hover:bg-danger-bg',
        link: 'h-auto px-0 text-cyan-ink underline-offset-4 hover:underline',
      },
      size: {
        md: 'h-10 px-4',
        sm: 'h-8 rounded-lg px-2.5 text-[13.5px]',
        icon: 'size-10',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Render the child element (e.g. a router Link) with the button styles. */
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      // A plain <button> defaults to submit inside forms; make that explicit.
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
