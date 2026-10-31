import type { ComponentProps } from 'react';
import { cn } from '../lib/cn.js';

/** Placeholder shown while content loads. Hidden from assistive technology; pair it with a status message. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}
