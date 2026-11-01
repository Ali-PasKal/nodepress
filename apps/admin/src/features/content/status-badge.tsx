import type { EntryStatus } from '@nexora/shared';
import { Badge } from '@nexora/ui';

const LABELS: Record<EntryStatus, string> = {
  draft: 'Draft',
  pending: 'Pending review',
  scheduled: 'Scheduled',
  published: 'Published',
};
const TONES = {
  draft: 'neutral',
  pending: 'warning',
  scheduled: 'info',
  published: 'success',
} as const;

export function EntryStatusBadge({
  status,
  trashed = false,
}: {
  status: EntryStatus;
  trashed?: boolean;
}) {
  if (trashed) return <Badge tone="danger">In trash</Badge>;
  return <Badge tone={TONES[status]}>{LABELS[status]}</Badge>;
}
