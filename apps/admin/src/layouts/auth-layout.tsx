import { Card } from '@nexora/ui';
import type { ReactNode } from 'react';
import { Brand } from '../components/brand';
import { ThemeToggle } from '../components/theme-toggle';

/** Centered card layout for sign-in, password reset and setup. */
export function AuthLayout({
  title,
  description,
  children,
  wide = false,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-14 items-center justify-between px-4 sm:px-6">
        <Brand />
        <ThemeToggle />
      </header>
      <main
        id="main-content"
        className="flex flex-1 items-start justify-center px-4 pb-12 pt-6 sm:items-center sm:pt-0"
      >
        <Card className={wide ? 'w-full max-w-2xl' : 'w-full max-w-md'}>
          <div className="flex flex-col gap-1 p-6 pb-2">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          <div className="p-6 pt-4">{children}</div>
        </Card>
      </main>
    </div>
  );
}
