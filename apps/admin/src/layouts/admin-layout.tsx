import {
  Button,
  cn,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@nexora/ui';
import { Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useState } from 'react';
import { Outlet } from 'react-router';
import { Brand } from '../components/brand';
import { ThemeToggle } from '../components/theme-toggle';
import { useUiStore } from '../stores/ui-store';
import { Breadcrumbs } from './breadcrumbs';
import { SidebarNav } from './sidebar-nav';

/**
 * Responsive application shell:
 * - ≥1024px: persistent sidebar that can collapse to an icon rail (preference persisted).
 * - <1024px: sidebar hidden; a menu button opens it as an accessible drawer.
 */
export function AdminLayout() {
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex min-h-dvh bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:shadow-lg"
      >
        Skip to content
      </a>

      <aside
        aria-label="Sidebar"
        className={cn(
          'sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200 lg:flex',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        <div
          className={cn('flex h-14 items-center border-b px-4', collapsed && 'justify-center px-0')}
        >
          <Brand compact={collapsed} />
        </div>
        <div className="flex-1 overflow-y-auto">
          <SidebarNav collapsed={collapsed} />
        </div>
        <div className={cn('border-t p-3', collapsed && 'flex justify-center')}>
          <Button
            variant="ghost"
            size={collapsed ? 'icon' : 'sm'}
            onClick={toggleSidebar}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            className={cn(!collapsed && 'w-full justify-start')}
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden="true" />
            ) : (
              <PanelLeftClose aria-hidden="true" />
            )}
            {!collapsed && <span>Collapse</span>}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-6">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="-ml-2 lg:hidden"
                aria-label="Open navigation"
              >
                <Menu aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" aria-describedby="mobile-nav-description">
              <div className="flex h-14 items-center border-b px-4">
                <SheetTitle asChild>
                  <span>
                    <Brand />
                  </span>
                </SheetTitle>
                <SheetDescription id="mobile-nav-description" className="sr-only">
                  Main navigation
                </SheetDescription>
              </div>
              <div className="flex-1 overflow-y-auto">
                <SidebarNav
                  onNavigate={() => {
                    setMobileNavOpen(false);
                  }}
                />
              </div>
            </SheetContent>
          </Sheet>

          <div className="min-w-0 flex-1">
            <Breadcrumbs />
          </div>
          <ThemeToggle />
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8"
        >
          <div className="mx-auto w-full max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
