import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn.js';

const alertVariants = cva(
  'relative flex w-full gap-3 rounded-lg border p-4 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0',
  {
    variants: {
      tone: {
        info: 'border-info/30 bg-info-soft text-foreground [&>svg]:text-info',
        success: 'border-success/30 bg-success-soft text-foreground [&>svg]:text-success',
        warning: 'border-warning/30 bg-warning-soft text-foreground [&>svg]:text-warning',
        danger: 'border-danger/30 bg-danger-soft text-foreground [&>svg]:text-danger',
      },
    },
    defaultVariants: { tone: 'info' },
  },
);

export interface AlertProps extends ComponentProps<'div'>, VariantProps<typeof alertVariants> {}

/**
 * Inline status message. Danger alerts use role="alert" (announced immediately); others use
 * role="status" so screen readers announce them politely.
 */
export function Alert({ className, tone, role, ...props }: AlertProps) {
  return (
    <div
      role={role ?? (tone === 'danger' ? 'alert' : 'status')}
      className={cn(alertVariants({ tone }), className)}
      {...props}
    />
  );
}

export function AlertTitle({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('font-semibold leading-tight', className)} {...props} />;
}

export function AlertDescription({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div className={cn('mt-1 text-muted-foreground [&_p]:leading-relaxed', className)} {...props} />
  );
}
