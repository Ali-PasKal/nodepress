import type { ContentTypeInfo } from '@nexora/shared';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@nexora/ui';
import { ExternalLink, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { PageHeader } from '../../components/page-header';
import { useCapabilities, useSession } from '../auth/session';
import { useContentModel, useEntries } from '../content/api';

function TypeSummary({ type, canCreate }: { type: ContentTypeInfo; canCreate: boolean }) {
  const entries = useEntries({
    type: type.key,
    status: 'all',
    search: '',
    termId: '',
    page: 1,
    sort: 'updated',
    pageSize: 5,
  });
  const counts = entries.data?.counts;
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>
            <Link to={`/content/${type.key}`} className="hover:underline">
              {type.pluralName}
            </Link>
          </CardTitle>
          <CardDescription>
            {counts
              ? `${String(counts.published)} published · ${String(counts.draft)} drafts · ${String(counts.scheduled)} scheduled · ${String(counts.pending)} pending`
              : 'Loading…'}
          </CardDescription>
        </div>
        {canCreate && (
          <Button asChild size="sm" variant="outline">
            <Link to={`/content/${type.key}/new`} aria-label={`New ${type.name.toLowerCase()}`}>
              <Plus aria-hidden="true" />
              New
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {entries.isPending ? (
          <Skeleton className="h-24" />
        ) : (entries.data?.items.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing here yet.</p>
        ) : (
          <ul className="flex flex-col divide-y text-sm">
            {entries.data?.items.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-2 py-1.5">
                <Link
                  to={`/content/${type.key}/${entry.id}`}
                  className="min-w-0 truncate hover:underline"
                >
                  {entry.title || '(untitled)'}
                </Link>
                <span className="shrink-0 text-xs text-muted-foreground">{entry.status}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Start page: content at a glance, quick actions and the way to the public site. */
export function DashboardPage() {
  const session = useSession();
  const capabilities = useCapabilities();
  const model = useContentModel();
  const name = session.data?.authenticated ? session.data.user.displayName : '';
  const canRead = ['content.read', 'content.create', 'content.edit_others'].some((capability) =>
    capabilities.has(capability),
  );
  const shortcuts = [
    { to: '/appearance', label: 'Customise the appearance', capability: 'appearance.manage' },
    { to: '/appearance/menus', label: 'Edit menus', capability: 'appearance.manage' },
    { to: '/seo', label: 'SEO settings', capability: 'seo.manage' },
    { to: '/media', label: 'Media library', capability: 'media.upload' },
    { to: '/system/status', label: 'System status', capability: null },
  ].filter((item) => item.capability === null || capabilities.has(item.capability));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={name ? `Welcome, ${name}` : 'Dashboard'}
        description="Your content at a glance."
        actions={
          <a
            href="/"
            target="_blank"
            rel="noopener"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-muted"
          >
            <ExternalLink className="size-4" aria-hidden="true" />
            View site
          </a>
        }
      />
      {canRead && (
        <div className="grid gap-4 md:grid-cols-2">
          {model.isPending ? (
            <>
              <Skeleton className="h-48" />
              <Skeleton className="h-48" />
            </>
          ) : (
            (model.data?.contentTypes ?? [])
              .slice(0, 4)
              .map((type) => (
                <TypeSummary
                  key={type.id}
                  type={type}
                  canCreate={capabilities.has('content.create')}
                />
              ))
          )}
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Shortcuts</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-wrap gap-2">
            {shortcuts.map((item) => (
              <li key={item.to}>
                <Button asChild variant="outline" size="sm">
                  <Link to={item.to}>{item.label}</Link>
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
