import { auditListResponseSchema } from '@nexora/shared';
import {
  Alert,
  AlertDescription,
  Card,
  EmptyState,
  NativeSelect,
  Pagination,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@nexora/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CircleX } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../../components/page-header';
import { apiGet } from '../../lib/api-client';
import { errorMessage } from '../../lib/forms';
import { formatDateTime } from '../../lib/format';

const ACTION_FILTERS = [
  { value: '', label: 'All events' },
  { value: 'auth.', label: 'Sign-in and passwords' },
  { value: 'user.', label: 'User changes' },
  { value: 'role.', label: 'Role changes' },
  { value: 'session.', label: 'Sessions' },
  { value: 'account.', label: 'Own account changes' },
  { value: 'settings.', label: 'Settings' },
  { value: 'setup.', label: 'Setup' },
];

export function AuditPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const params = new URLSearchParams({
    page: String(page),
    pageSize: '25',
    ...(action ? { action } : {}),
  });
  const events = useQuery({
    queryKey: ['audit', page, action],
    queryFn: ({ signal }) =>
      apiGet(`/audit-events?${params.toString()}`, auditListResponseSchema, { signal }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit log"
        description="Security-relevant actions, newest first. Entries cannot be edited or deleted."
      />
      <Card>
        <div className="flex border-b p-4">
          <NativeSelect
            aria-label="Filter events"
            className="sm:w-64"
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setPage(1);
            }}
          >
            {ACTION_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        {events.isPending ? (
          <div className="flex flex-col gap-2 p-4" role="status" aria-label="Loading audit events">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-10" />
            ))}
          </div>
        ) : events.isError ? (
          <div className="p-4">
            <Alert tone="danger">
              <CircleX aria-hidden="true" />
              <AlertDescription>{errorMessage(events.error)}</AlertDescription>
            </Alert>
          </div>
        ) : events.data.items.length === 0 ? (
          <EmptyState title="No events" description="Nothing matches this filter yet." />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>When</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead className="hidden lg:table-cell">Details</TableHead>
                  <TableHead className="hidden md:table-cell">IP address</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.data.items.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(event.occurredAt)}
                    </TableCell>
                    <TableCell>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{event.action}</code>
                    </TableCell>
                    <TableCell className="min-w-0">
                      {event.actor ? (
                        <span className="block truncate" title={event.actor.email}>
                          {event.actor.displayName}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Anonymous</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden max-w-xs lg:table-cell">
                      <span
                        className="block truncate font-mono text-xs text-muted-foreground"
                        title={JSON.stringify(event.metadata)}
                      >
                        {[
                          event.targetType &&
                            `${event.targetType}:${(event.targetId ?? '').slice(0, 8)}`,
                          Object.keys(event.metadata).length > 0
                            ? JSON.stringify(event.metadata)
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      </span>
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap font-mono text-xs text-muted-foreground md:table-cell">
                      {event.ipAddress ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination
              className="border-t p-4"
              page={events.data.page}
              pageSize={events.data.pageSize}
              total={events.data.total}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>
    </div>
  );
}
