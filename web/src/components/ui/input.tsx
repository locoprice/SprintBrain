import * as React from 'react';
import { cn } from '@/lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-10 w-full rounded-[12px] border border-line bg-card px-3 text-sm text-ink',
        'placeholder:text-ink-subtle',
        'focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
