import type { ReadinessResponse } from '@nexora/shared';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  Skeleton,
} from '@nexora/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import {
  CircleAlert,
  CircleCheck,
  CircleX,
  Database,
  GitBranch,
  Layers,
  RefreshCw,
  Server,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '../../components/page-header';
import { ApiError } from '../../lib/api-client';
import { useReadiness } from './api';
import { describeComponents, describeOverall, type ComponentView, type Tone } from './status-model';

const TONE_ICON: Record<Tone, LucideIcon> = {
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleX,
  neutral: CircleAlert,
};

const TONE_TEXT: Record<Tone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  neutral: 'text-muted-foreground',
};

const COMPONENT_ICON: Record<ComponentView['id'], LucideIcon> = {
  database: Database,
  migrations: GitBranch,
  cache: Layers,
  process: Server,
};

export function SystemStatusPage() {
  const readiness = useReadiness();
  const refreshing = readiness.isFetching;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="System status"
        description="Live health of this NEXORA instance and its dependencies. Refreshes every 15 seconds."
        actions={
          <Button
            variant="outline"
            onClick={() => {
              void readiness.refetch();
            }}
            disabled={refreshing}
          >
            <RefreshCw className={cn(refreshing && 'animate-spin')} aria-hidden="true" />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        }
      />
      <ReadinessSection query={readiness} />
    </div>
  );
}

function ReadinessSection({ query }: { query: UseQueryResult<ReadinessResponse> }) {
  if (query.isPending) {
    return <ReadinessSkeleton />;
  }
  if (query.isError && query.data === undefined) {
    return (
      <ReadinessError
        error={query.error}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  }
  const data = query.data;
  return (
    <div className="flex flex-col gap-6">
      {query.isError && (
        <Alert tone="warning">
          <TriangleAlert aria-hidden="true" />
          <div>
            <AlertTitle>Showing the last known status</AlertTitle>
            <AlertDescription>
              The most recent refresh failed. Retrying automatically.
            </AlertDescription>
          </div>
        </Alert>
      )}
      <OverallStatus readiness={data} />
      <section aria-labelledby="components-heading" className="flex flex-col gap-3">
        <h2 id="components-heading" className="text-sm font-semibold text-muted-foreground">
          Components
        </h2>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {describeComponents(data.checks).map((component) => (
            <li key={component.id}>
              <ComponentCard component={component} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function OverallStatus({ readiness }: { readiness: ReadinessResponse }) {
  const view = describeOverall(readiness.status);
  const Icon = TONE_ICON[view.tone];
  const checkedAt = new Date(readiness.checkedAt);
  return (
    <Card
      aria-labelledby="overall-status-heading"
      data-testid="overall-status"
      data-status={readiness.status}
    >
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <span
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-full',
            view.tone === 'success' && 'bg-success-soft',
            view.tone === 'warning' && 'bg-warning-soft',
            view.tone === 'danger' && 'bg-danger-soft',
          )}
        >
          <Icon className={cn('size-6', TONE_TEXT[view.tone])} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="overall-status-heading" className="text-lg font-semibold tracking-tight">
            {view.label}
          </h2>
          <p className="text-sm text-muted-foreground">{view.description}</p>
        </div>
        <p className="text-xs text-muted-foreground sm:text-right">
          Last checked{' '}
          <time dateTime={readiness.checkedAt} className="font-medium text-foreground tabular-nums">
            {checkedAt.toLocaleTimeString()}
          </time>
        </p>
      </div>
    </Card>
  );
}

function ComponentCard({ component }: { component: ComponentView }) {
  const Icon = COMPONENT_ICON[component.id];
  return (
    <Card className="h-full" data-testid={`component-${component.id}`}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <CardTitle className="truncate text-sm">{component.name}</CardTitle>
        </div>
        <Badge tone={component.tone}>{component.statusLabel}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <CardDescription>{component.description}</CardDescription>
        {component.detail && (
          <p className="text-xs text-muted-foreground tabular-nums">{component.detail}</p>
        )}
      </CardContent>
    </Card>
  );
}

function ReadinessSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <p role="status" className="sr-only">
        Checking system status…
      </p>
      <Skeleton className="h-[84px] w-full rounded-xl" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-[116px] rounded-xl" />
        ))}
      </div>
    </div>
  );
}

function ReadinessError({
  error,
  onRetry,
  retrying,
}: {
  error: Error;
  onRetry: () => void;
  retrying: boolean;
}) {
  const apiError = error instanceof ApiError ? error : null;
  const unreachable =
    apiError?.code === 'NETWORK_ERROR' || apiError?.status === 502 || apiError?.status === 504;
  return (
    <Alert tone="danger">
      <CircleX aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div>
          <AlertTitle>
            {unreachable ? 'Cannot reach the API' : 'System status is unavailable'}
          </AlertTitle>
          <AlertDescription>
            <p>
              {unreachable
                ? 'The NEXORA API did not respond. Check that the API process is running and reachable from this page.'
                : error.message}
            </p>
            {apiError?.requestId && (
              <p className="mt-1 text-xs">
                Request ID: <code className="font-mono break-all">{apiError.requestId}</code>
              </p>
            )}
          </AlertDescription>
        </div>
        <div>
          <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
            <RefreshCw className={cn(retrying && 'animate-spin')} aria-hidden="true" />
            Try again
          </Button>
        </div>
      </div>
    </Alert>
  );
}
