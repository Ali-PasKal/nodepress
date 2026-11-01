import { Button } from '@nexora/ui';
import { Search } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';

const CommandPaletteDialog = lazy(() => import('./command-palette-dialog'));

/** Header trigger and Ctrl/⌘+K shortcut; the palette itself loads on first use. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setLoaded(true);
        setOpen((current) => !current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="hidden gap-2 text-muted-foreground sm:inline-flex"
        aria-label="Search and commands"
        aria-keyshortcuts="Control+K Meta+K"
        onClick={() => {
          setLoaded(true);
          setOpen(true);
        }}
      >
        <Search aria-hidden="true" />
        <span>Search…</span>
        <kbd className="rounded border px-1.5 font-mono text-[10px]">Ctrl K</kbd>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="sm:hidden"
        aria-label="Search and commands"
        onClick={() => {
          setLoaded(true);
          setOpen(true);
        }}
      >
        <Search aria-hidden="true" />
      </Button>
      {loaded && (
        <Suspense fallback={null}>
          <CommandPaletteDialog open={open} onOpenChange={setOpen} />
        </Suspense>
      )}
    </>
  );
}
