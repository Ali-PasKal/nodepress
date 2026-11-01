import type { JobStatus, JobSummary } from '@nexora/shared';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Pagination,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@nexora/ui';
import { CircleX, RotateCcw, Trash2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '../../components/page-header';
import { errorMessage } from '../../lib/forms';
import { formatDateTime } from '../../lib/format';
import { useJobAction, useJobOverview, useJobs } from './api';

const STATUS_TONES = {
  pending: 'info',
  running: 'warning',
  succeeded: 'success',
  dead: 'danger',
} as const;
const STATUS_LABELS: Record<JobStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  succeeded: 'Succeeded',
  dead: 'Failed',
};
const FILTERS: { value: '' | JobStatus; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'dead', label: 'Failed' },
  { value: 'pending', label: 'Pending' },
  { value: 'running', label: 'Running' },
  { value: 'succeeded', label: 'Succeeded' },
];

export function JobsPage() {
  const overview = useJobOverview();
  const [status, setStatus] = useState<'' | JobStatus>('');
  const [page, setPage] = useState(1);
  const jobs = useJobs(status, page);
  const action = useJobAction();
  const [discarding, setDiscarding] = useState<JobSummary | null>(null);
  const activeWorkers = overview.data?.workers.filter((worker) => worker.active) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Background jobs"
        description="Emails, image processing, scheduled publishing and maintenance run here, with retries."
      />
      {overview.data && activeWorkers.length === 0 && (
        <Alert tone="warning">
          <TriangleAlert aria-hidden="true" />
          <div>
            <AlertTitle>No worker is running</AlertTitle>
            <AlertDescription>
              No worker has reported in the last 90 seconds, so emails, image variants and scheduled
              publishing are waiting. Start the API with JOBS_WORKER=embedded or run the standalone
              worker.
            </AlertDescription>
          </div>
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {(['pending', 'running', 'succeeded', 'dead'] as const).map((key) => (
          <Card key={key} className="p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {STATUS_LABELS[key]}
            </p>
            <p
              className={cn(
                'mt-1 text-2xl font-semibold tabular-nums',
                key === 'dead' && (overview.data?.counts.dead ?? 0) > 0 && 'text-danger',
              )}
            >
              {overview.data ? overview.data.counts[key] : '–'}
            </p>
          </Card>
        ))}
        <Card className="col-span-2 p-4 md:col-span-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Workers
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {overview.data ? activeWorkers.length : '–'}
          </p>
          {overview.data && overview.data.oldestDueSeconds > 60 && (
            <p className="text-xs text-warning-foreground">
              Oldest waiting job: {Math.round(overview.data.oldestDueSeconds / 60)} min
            </p>
          )}
        </Card>
      </div>
      <Card>
        <div
          className="flex flex-wrap gap-1 border-b px-2 pt-2"
          role="group"
          aria-label="Filter by status"
        >
          {FILTERS.map((filter) => (
            <button
              key={filter.value || 'all'}
              type="button"
              aria-pressed={status === filter.value}
              onClick={() => {
                setStatus(filter.value);
                setPage(1);
              }}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                status === filter.value
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
        {jobs.isPending ? (
          <div className="flex flex-col gap-2 p-4" role="status" aria-label="Loading jobs">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-10" />
            ))}
          </div>
        ) : jobs.isError ? (
          <div className="p-4">
            <Alert tone="danger">
              <CircleX aria-hidden="true" />
              <AlertDescription>{errorMessage(jobs.error)}</AlertDescription>
            </Alert>
          </div>
        ) : jobs.data.items.length === 0 ? (
          <EmptyState title="No jobs here" />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Attempts</TableHead>
                  <TableHead className="hidden lg:table-cell">Run at</TableHead>
                  <TableHead className="w-24">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.data.items.map((job) => (
                  <TableRow key={job.id} data-testid="job-row">
                    <TableCell className="min-w-0">
                      <code className="break-all text-sm">{job.name}</code>
                      {job.lastError && (
                        <p
                          className="mt-1 max-w-[11rem] truncate text-xs text-danger sm:max-w-md"
                          title={job.lastError}
                        >
                          {job.lastError}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge tone={STATUS_TONES[job.status]}>{STATUS_LABELS[job.status]}</Badge>
                    </TableCell>
                    <TableCell className="hidden tabular-nums md:table-cell">
                      {job.attempts} / {job.maxAttempts}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                      {formatDateTime(job.runAt)}
                    </TableCell>
                    <TableCell>
                      {job.status === 'dead' && (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Retry ${job.name}`}
                            disabled={action.isPending}
                            onClick={() => {
                              action.mutate(
                                { id: job.id, action: 'retry' },
                                {
                                  onSuccess: () => toast.success('The job will run again shortly.'),
                                  onError: (error) => toast.error(errorMessage(error)),
                                },
                              );
                            }}
                          >
                            <RotateCcw aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Discard ${job.name}`}
                            onClick={() => {
                              setDiscarding(job);
                            }}
                          >
                            <Trash2 aria-hidden="true" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination
              className="border-t p-4"
              page={page}
              pageSize={jobs.data.pageSize}
              total={jobs.data.total}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>
      <ConfirmDialog
        open={discarding !== null}
        onOpenChange={(open) => {
          if (!open) setDiscarding(null);
        }}
        title="Discard this failed job?"
        description="It will not run again. This is recorded in the audit log."
        confirmLabel="Discard"
        destructive
        pending={action.isPending}
        onConfirm={() => {
          if (!discarding) return;
          action.mutate(
            { id: discarding.id, action: 'discard' },
            {
              onSuccess: () => toast.success('Job discarded.'),
              onError: (error) => toast.error(errorMessage(error)),
              onSettled: () => {
                setDiscarding(null);
              },
            },
          );
        }}
      />
    </div>
  );
}
