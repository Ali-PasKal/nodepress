import { ChevronRight } from 'lucide-react';
import { useMatches } from 'react-router';

export interface RouteHandle {
  readonly breadcrumbs?: readonly string[];
}

function isRouteHandle(value: unknown): value is RouteHandle {
  return typeof value === 'object' && value !== null && 'breadcrumbs' in value;
}

/** Renders the breadcrumb trail declared by the deepest matched route's `handle.breadcrumbs`. */
export function Breadcrumbs() {
  const matches = useMatches();
  const trail = matches.flatMap((match) =>
    isRouteHandle(match.handle) ? (match.handle.breadcrumbs ?? []) : [],
  );
  if (trail.length === 0) {
    return null;
  }
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
        {trail.map((crumb, index) => {
          const isLast = index === trail.length - 1;
          return (
            <li key={`${crumb}-${String(index)}`} className="flex min-w-0 items-center gap-1.5">
              {index > 0 && <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />}
              <span
                className={isLast ? 'truncate font-medium text-foreground' : 'truncate'}
                aria-current={isLast ? 'page' : undefined}
              >
                {crumb}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
