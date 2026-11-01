import type { TaxonomyInfo, TermInfo } from '@nexora/shared';
import { Badge, Button, Checkbox, Input, Label, Skeleton } from '@nexora/ui';
import { Plus, X } from 'lucide-react';
import { useDeferredValue, useState, type KeyboardEvent } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../lib/forms';
import { useCapabilities } from '../auth/session';
import { useSaveTerm, useTerms } from './api';
import { orderTerms } from './term-order';

export function CategoryChecklist({
  taxonomy,
  selected,
  onChange,
  disabled,
}: {
  taxonomy: TaxonomyInfo;
  selected: readonly string[];
  onChange: (termIds: string[]) => void;
  disabled: boolean;
}) {
  const terms = useTerms(taxonomy.id);
  if (terms.isPending) return <Skeleton className="h-20" />;
  const ordered = orderTerms(terms.data?.items ?? []);
  if (ordered.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No {taxonomy.pluralName.toLowerCase()} yet.</p>
    );
  }
  return (
    <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto" aria-label={taxonomy.pluralName}>
      {ordered.map(({ term, depth }) => (
        <li key={term.id} style={{ paddingInlineStart: `${String(depth * 1.25)}rem` }}>
          <Label className="flex items-center gap-2 font-normal">
            <Checkbox
              checked={selected.includes(term.id)}
              disabled={disabled}
              onChange={(event) => {
                onChange(
                  event.target.checked
                    ? [...selected, term.id]
                    : selected.filter((id) => id !== term.id),
                );
              }}
            />
            {term.name}
          </Label>
        </li>
      ))}
    </ul>
  );
}

export function TagInput({
  taxonomy,
  selected,
  names,
  onChange,
  disabled,
}: {
  taxonomy: TaxonomyInfo;
  selected: readonly string[];
  /** Known names for selected ids (from the entry and from additions). */
  names: Readonly<Record<string, string>>;
  onChange: (termIds: string[], names: Record<string, string>) => void;
  disabled: boolean;
}) {
  const capabilities = useCapabilities();
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query.trim());
  const suggestions = useTerms(deferred ? taxonomy.id : null, deferred, 8);
  const create = useSaveTerm();
  const canCreate = capabilities.has('terms.manage');
  const matches = (suggestions.data?.items ?? []).filter((term) => !selected.includes(term.id));
  const exact = matches.find((term) => term.name.toLowerCase() === deferred.toLowerCase());

  const add = (term: TermInfo) => {
    onChange([...selected, term.id], { ...names, [term.id]: term.name });
    setQuery('');
  };
  const createAndAdd = () => {
    create.mutate(
      { taxonomyId: taxonomy.id, body: { name: query.trim() } },
      { onSuccess: add, onError: (error) => toast.error(errorMessage(error)) },
    );
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || query.trim() === '') return;
    event.preventDefault();
    if (exact) add(exact);
    else if (matches[0]) add(matches[0]);
    else if (canCreate) createAndAdd();
  };

  return (
    <div className="flex flex-col gap-2">
      {selected.length > 0 && (
        <ul
          className="flex flex-wrap gap-1.5"
          aria-label={`Selected ${taxonomy.pluralName.toLowerCase()}`}
        >
          {selected.map((id) => (
            <li key={id}>
              <Badge className="gap-1 pr-1">
                {names[id] ?? '…'}
                <button
                  type="button"
                  className="rounded-sm p-0.5 hover:bg-muted"
                  aria-label={`Remove ${names[id] ?? 'term'}`}
                  disabled={disabled}
                  onClick={() => {
                    onChange(
                      selected.filter((termId) => termId !== id),
                      names,
                    );
                  }}
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <Input
        aria-label={`Add ${taxonomy.name.toLowerCase()}`}
        placeholder={`Add ${taxonomy.name.toLowerCase()}…`}
        value={query}
        disabled={disabled}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
        onKeyDown={onKeyDown}
      />
      {deferred !== '' && (
        <ul className="flex flex-col gap-0.5" aria-label="Suggestions">
          {matches.map((term) => (
            <li key={term.id}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => {
                  add(term);
                }}
              >
                {term.name}
              </Button>
            </li>
          ))}
          {!exact && canCreate && (
            <li>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                disabled={create.isPending}
                onClick={createAndAdd}
              >
                <Plus aria-hidden="true" /> Create “{query.trim()}”
              </Button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
