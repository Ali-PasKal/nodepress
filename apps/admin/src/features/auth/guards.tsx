import { Alert, AlertDescription, AlertTitle, Button } from '@nexora/ui';
import { CircleX, Loader2, ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useSystemStatus } from '../system/api';
import { useCapabilities, useLogout, useSession } from './session';

export function FullPageStatus({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">{children}</div>
  );
}

export function LoadingScreen({ label = 'Loading…' }: { label?: string }) {
  return (
    <FullPageStatus>
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        {label}
      </p>
    </FullPageStatus>
  );
}

function ConnectionError({ onRetry }: { onRetry: () => void }) {
  return (
    <FullPageStatus>
      <Alert tone="danger" className="max-w-md">
        <CircleX aria-hidden="true" />
        <div className="flex flex-col gap-3">
          <div>
            <AlertTitle>Cannot reach the API</AlertTitle>
            <AlertDescription>
              Check that the API process is running, then try again.
            </AlertDescription>
          </div>
          <div>
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          </div>
        </div>
      </Alert>
    </FullPageStatus>
  );
}

/**
 * Gate for the dashboard: not installed → setup wizard; signed out → login (remembering the target);
 * no dashboard access → explanation. Server-side authorisation is the real boundary; this is UX.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useSystemStatus();
  const session = useSession();
  const location = useLocation();
  const logout = useLogout();

  if (status.isPending || session.isPending) {
    return <LoadingScreen />;
  }
  if (status.isError || session.isError) {
    return (
      <ConnectionError
        onRetry={() => {
          void status.refetch();
          void session.refetch();
        }}
      />
    );
  }
  if (!status.data.installed) {
    return <Navigate to="/setup" replace />;
  }
  if (!session.data.authenticated) {
    const next = `${location.pathname}${location.search}`;
    return (
      <Navigate to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`} replace />
    );
  }
  if (!session.data.capabilities.includes('dashboard.access')) {
    return (
      <FullPageStatus>
        <Alert tone="warning" className="max-w-md">
          <ShieldAlert aria-hidden="true" />
          <div className="flex flex-col gap-3">
            <div>
              <AlertTitle>No dashboard access</AlertTitle>
              <AlertDescription>
                Your account does not have access to the admin dashboard. Ask an administrator.
              </AlertDescription>
            </div>
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  logout.mutate();
                }}
              >
                Sign out
              </Button>
            </div>
          </div>
        </Alert>
      </FullPageStatus>
    );
  }
  return children;
}

/** Shows an access-denied message for pages the user's capabilities do not cover. */
export function RequireCapability({
  capability,
  children,
}: {
  capability: string;
  children: ReactNode;
}) {
  const capabilities = useCapabilities();
  if (!capabilities.has(capability)) {
    return (
      <Alert tone="warning">
        <ShieldAlert aria-hidden="true" />
        <div>
          <AlertTitle>Access denied</AlertTitle>
          <AlertDescription>You do not have permission to view this page.</AlertDescription>
        </div>
      </Alert>
    );
  }
  return children;
}
