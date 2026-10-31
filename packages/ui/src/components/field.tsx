import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';

const controlBase =
  'w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground shadow-xs transition-colors ' +
  'placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring ' +
  'disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(controlBase, 'h-9', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(controlBase, 'min-h-20 py-2', className)} {...props} />;
}

/** Native <select>: fully keyboard and screen-reader accessible on every platform. */
export function NativeSelect({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select className={cn(controlBase, 'h-9 appearance-auto pr-8', className)} {...props}>
      {children}
    </select>
  );
}

export function Checkbox({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <input
      type="checkbox"
      className={cn(
        'size-4 shrink-0 rounded border-input accent-primary disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('text-sm font-medium leading-none', className)} {...props} />;
}

interface FieldProps {
  label: string;
  /** Validation message; also marks the control invalid for assistive technology. */
  error?: string | undefined;
  description?: ReactNode;
  className?: string;
  /** Receives the ids to wire onto the control (id, aria-describedby, aria-invalid). */
  children: (control: {
    id: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean;
  }) => ReactNode;
}

/** Label + control + description + error, with correct id/aria wiring. */
export function Field({ label, error, description, className, children }: FieldProps) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        ...(error ? { 'aria-invalid': true } : {}),
      })}
      {description && (
        <p id={descriptionId} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
