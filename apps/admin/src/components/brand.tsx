import { cn } from '@nexora/ui';

export function Brand({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden="true">
        <rect width="32" height="32" rx="8" className="fill-primary" />
        <path
          d="M9 23V9h2.6l7.8 9.6V9H22v14h-2.6l-7.8-9.6V23z"
          className="fill-primary-foreground"
        />
      </svg>
      <span className={cn('text-sm font-semibold tracking-tight', compact && 'sr-only')}>
        NEXORA CMS
      </span>
    </span>
  );
}
