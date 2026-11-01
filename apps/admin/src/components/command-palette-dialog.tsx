import { entryListResponseSchema, type ContentTypeInfo } from '@nexora/shared';
import { Dialog, DialogContent, DialogDescription, DialogTitle, cn } from '@nexora/ui';
import { useQuery } from '@tanstack/react-query';
import { CornerDownLeft, FileText, Plus, Search } from 'lucide-react';
import { useDeferredValue, useMemo, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { useCapabilities } from '../features/auth/session';
import { useContentModel } from '../features/content/model-query';
import { visibleNavigation } from '../layouts/navigation';
import { apiGet } from '../lib/api-client';

interface Command {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly to: string;
  readonly icon: typeof Search;
}

function useEntrySearch(query: string, types: readonly ContentTypeInfo[], enabled: boolean) {
  return useQuery({
    queryKey: ['command-search', query, types.map((type) => type.key)],
    enabled: enabled && query.length >= 2,
    queryFn: async ({ signal }) => {
      const results = await Promise.all(
        types.map(async (type) => {
          const params = new URLSearchParams({ type: type.key, search: query, pageSize: '5' });
          const list = await apiGet(`/entries?${params.toString()}`, entryListResponseSchema, {
            signal,
          });
          return list.items.map((entry): Command => ({
            id: `entry-${entry.id}`,
            label: entry.title || '(no title)',
            group: type.pluralName,
            to: `/content/${type.key}/${entry.id}`,
            icon: FileText,
          }));
        }),
      );
      return results.flat();
    },
    staleTime: 10_000,
  });
}

export default function CommandPaletteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const capabilities = useCapabilities();
  const model = useContentModel();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const deferred = useDeferredValue(query.trim());
  const canSearch = ['content.read', 'content.create', 'content.edit_others'].some((key) =>
    capabilities.has(key),
  );
  const search = useEntrySearch(deferred, model.data?.contentTypes ?? [], open && canSearch);

  const commands = useMemo(() => {
    const pages: Command[] = visibleNavigation(capabilities, model.data).flatMap((group) =>
      group.items.map((item) => ({
        id: `nav-${item.to}`,
        label: item.label,
        group: 'Go to',
        to: item.to,
        icon: item.icon,
      })),
    );
    const create: Command[] = capabilities.has('content.create')
      ? (model.data?.contentTypes ?? []).map((type) => ({
          id: `new-${type.key}`,
          label: `New ${type.name.toLowerCase()}`,
          group: 'Create',
          to: `/content/${type.key}/new`,
          icon: Plus,
        }))
      : [];
    // Static commands filter on the live input, so Enter always acts on what is on screen; only the
    // network search uses the deferred value (and only shows results for the current query).
    const needle = query.trim().toLowerCase();
    const matches = [...create, ...pages].filter((command) =>
      command.label.toLowerCase().includes(needle),
    );
    const results =
      needle.length >= 2 && deferred.toLowerCase() === needle ? (search.data ?? []) : [];
    return [...matches, ...results];
  }, [capabilities, model.data, query, deferred, search.data]);

  const run = (command: Command) => {
    onOpenChange(false);
    setQuery('');
    void navigate(command.to);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, commands.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const command = commands[active];
      if (command) run(command);
    }
  };

  let lastGroup = '';
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setQuery('');
      }}
    >
      <DialogContent className="top-[20%] max-w-xl translate-y-0 gap-0 p-0">
        <DialogTitle className="sr-only">Search and commands</DialogTitle>
        <DialogDescription className="sr-only">
          Type to find pages, actions and content. Use the arrow keys and Enter.
        </DialogDescription>
        <div className="flex items-center gap-2 border-b px-4">
          <Search className="size-4 text-muted-foreground" aria-hidden="true" />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="command-list"
            aria-activedescendant={commands[active] ? `command-${commands[active].id}` : undefined}
            aria-label="Search pages, actions and content"
            placeholder="Search pages, actions and content…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        <ul
          id="command-list"
          role="listbox"
          aria-label="Results"
          className="max-h-80 overflow-y-auto p-2"
        >
          {commands.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              {search.isFetching ? 'Searching…' : 'No results.'}
            </li>
          )}
          {commands.map((command, index) => {
            const heading = command.group !== lastGroup ? command.group : null;
            lastGroup = command.group;
            const Icon = command.icon;
            return (
              <li key={command.id} role="presentation">
                {heading && (
                  <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {heading}
                  </p>
                )}
                <div
                  id={`command-${command.id}`}
                  role="option"
                  aria-selected={index === active}
                  tabIndex={-1}
                  onMouseEnter={() => {
                    setActive(index);
                  }}
                  onClick={() => {
                    run(command);
                  }}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm',
                    index === active && 'bg-muted',
                  )}
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{command.label}</span>
                  {index === active && (
                    <CornerDownLeft className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
