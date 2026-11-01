import { cn } from '@nexora/ui';
import { NavLink } from 'react-router';
import { useCapabilities } from '../features/auth/session';
import { useContentModel } from '../features/content/model-query';
import { visibleNavigation } from './navigation';

interface SidebarNavProps {
  collapsed?: boolean;
  onNavigate?: () => void;
}

export function SidebarNav({ collapsed = false, onNavigate }: SidebarNavProps) {
  const capabilities = useCapabilities();
  const model = useContentModel();
  return (
    <nav aria-label="Main" className="flex flex-col gap-6 px-3 py-4">
      {visibleNavigation(capabilities, model.data).map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <p
            className={cn(
              'px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground',
              collapsed && 'sr-only',
            )}
          >
            {group.label}
          </p>
          <ul className="flex flex-col gap-0.5">
            {group.items.map(({ to, label, icon: Icon, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end === true}
                  onClick={onNavigate}
                  title={collapsed ? label : undefined}
                  className={({ isActive }) =>
                    cn(
                      'flex h-9 items-center gap-3 rounded-md px-2 text-sm font-medium transition-colors',
                      'hover:bg-muted hover:text-foreground',
                      isActive &&
                        'bg-sidebar-active text-sidebar-active-foreground hover:bg-sidebar-active',
                      collapsed && 'justify-center px-0',
                    )
                  }
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className={cn(collapsed && 'sr-only')}>{label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
