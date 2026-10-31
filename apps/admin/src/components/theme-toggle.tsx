import { cn } from '@nexora/ui';
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useId } from 'react';
import { useThemeStore, type ThemePreference } from '../stores/theme-store';

const OPTIONS: readonly { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

/**
 * Segmented theme control built from native radio inputs, so keyboard behaviour (arrow keys,
 * focus) and screen-reader semantics come from the browser rather than custom code.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const preference = useThemeStore((state) => state.preference);
  const setPreference = useThemeStore((state) => state.setPreference);
  const name = useId();

  return (
    <fieldset className={cn('inline-flex rounded-lg border bg-surface p-0.5', className)}>
      <legend className="sr-only">Colour theme</legend>
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <label
          key={value}
          title={label}
          className={cn(
            'relative flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors',
            'hover:text-foreground has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring',
            preference === value && 'bg-muted text-foreground',
          )}
        >
          <input
            type="radio"
            name={name}
            value={value}
            checked={preference === value}
            onChange={() => {
              setPreference(value);
            }}
            className="sr-only"
          />
          <Icon className="size-4" aria-hidden="true" />
          <span className="sr-only">{label}</span>
        </label>
      ))}
    </fieldset>
  );
}
