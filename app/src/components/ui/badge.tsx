import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        primary: 'border-primary/20 bg-primary-light text-primary',
        neutral: 'border-line bg-bg-alt text-ink-muted',
        success: 'border-success/20 bg-success/10 text-success',
        warning: 'border-warning/30 bg-warning/10 text-[#9a6b00]',
        danger: 'border-danger/20 bg-danger/10 text-danger',
        outline: 'border-line bg-transparent text-ink-muted',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
