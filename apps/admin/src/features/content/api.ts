import {
  contentTypeSchema,
  entryBulkResponseSchema,
  entryDetailSchema,
  entryListResponseSchema,
  revisionDetailSchema,
  revisionSummarySchema,
  taxonomySchema,
  termListResponseSchema,
  termSchema,
  type CreateContentTypeInput,
  type CreateEntryInput,
  type CreateTaxonomyInput,
  type CreateTermInput,
  type EntryBulkInput,
  type EntryDetail,
  type UpdateContentTypeInput,
  type UpdateEntryInput,
  type UpdateTaxonomyInput,
  type UpdateTermInput,
} from '@nexora/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { apiGet, apiSend } from '../../lib/api-client';
import { contentModelKey } from './model-query';

export const contentKeys = {
  model: contentModelKey,
  entries: ['entries'] as const,
  list: (filters: EntryFilters) => ['entries', 'list', filters] as const,
  entry: (id: string) => ['entries', 'detail', id] as const,
  revisions: (id: string) => ['entries', 'detail', id, 'revisions'] as const,
  revision: (entryId: string, id: string) =>
    ['entries', 'detail', entryId, 'revisions', id] as const,
  terms: (taxonomyId: string, search: string) => ['terms', taxonomyId, search] as const,
  allTerms: ['terms'] as const,
};

export { useContentModel, useHasContentAccess } from './model-query';

export interface EntryFilters {
  type: string;
  status: 'all' | 'draft' | 'pending' | 'scheduled' | 'published' | 'trash';
  search: string;
  termId: string;
  page: number;
  sort: 'updated' | 'published' | 'title';
}

export function useEntries(filters: EntryFilters) {
  const params = new URLSearchParams({
    type: filters.type,
    status: filters.status,
    page: String(filters.page),
    pageSize: '20',
    sort: filters.sort,
  });
  if (filters.search) params.set('search', filters.search);
  if (filters.termId) params.set('termId', filters.termId);
  return useQuery({
    queryKey: contentKeys.list(filters),
    queryFn: ({ signal }) =>
      apiGet(`/entries?${params.toString()}`, entryListResponseSchema, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useEntry(id: string | null) {
  return useQuery({
    queryKey: contentKeys.entry(id ?? ''),
    queryFn: ({ signal }) => apiGet(`/entries/${id ?? ''}`, entryDetailSchema, { signal }),
    enabled: id !== null,
    // The editor owns the form state; never replace it underneath the user.
    refetchOnWindowFocus: false,
  });
}

/** Fetches the newest version of an entry from the server, bypassing (and refreshing) the cache. */
export function useFetchLatestEntry() {
  const queryClient = useQueryClient();
  return (id: string) =>
    queryClient.query({
      queryKey: contentKeys.entry(id),
      queryFn: ({ signal }) => apiGet(`/entries/${id}`, entryDetailSchema, { signal }),
      staleTime: 0,
    });
}

export function useRevisions(entryId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: contentKeys.revisions(entryId ?? ''),
    queryFn: ({ signal }) =>
      apiGet(`/entries/${entryId ?? ''}/revisions`, z.array(revisionSummarySchema), { signal }),
    enabled: entryId !== null && enabled,
  });
}

export function useRevision(entryId: string, revisionId: string | null) {
  return useQuery({
    queryKey: contentKeys.revision(entryId, revisionId ?? ''),
    queryFn: ({ signal }) =>
      apiGet(`/entries/${entryId}/revisions/${revisionId ?? ''}`, revisionDetailSchema, { signal }),
    enabled: revisionId !== null,
  });
}

function useInvalidateEntries() {
  const queryClient = useQueryClient();
  return (entry?: EntryDetail) => {
    if (entry) queryClient.setQueryData(contentKeys.entry(entry.id), entry);
    void queryClient.invalidateQueries({ queryKey: [...contentKeys.entries, 'list'] });
    void queryClient.invalidateQueries({ queryKey: contentKeys.model });
  };
}

export function useCreateEntry() {
  const invalidate = useInvalidateEntries();
  return useMutation({
    mutationFn: (input: CreateEntryInput) => apiSend('POST', '/entries', input, entryDetailSchema),
    onSuccess: (entry) => {
      invalidate(entry);
    },
  });
}

export function useUpdateEntry() {
  const invalidate = useInvalidateEntries();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateEntryInput }) =>
      apiSend('PATCH', `/entries/${id}`, input, entryDetailSchema),
    onSuccess: (entry) => {
      invalidate(entry);
    },
  });
}

export function useEntryAction() {
  const invalidate = useInvalidateEntries();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'trash' | 'restore' | 'delete' }) =>
      action === 'delete'
        ? apiSend('DELETE', `/entries/${id}`, undefined, null)
        : apiSend('POST', `/entries/${id}/${action}`, undefined, entryDetailSchema),
    onSuccess: (entry, { id, action }) => {
      if (action === 'delete') queryClient.removeQueries({ queryKey: contentKeys.entry(id) });
      invalidate(entry ?? undefined);
    },
  });
}

export function useBulkEntries() {
  const invalidate = useInvalidateEntries();
  return useMutation({
    mutationFn: (input: EntryBulkInput) =>
      apiSend('POST', '/entries/bulk', input, entryBulkResponseSchema),
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useRestoreRevision(entryId: string) {
  const invalidate = useInvalidateEntries();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ revisionId, version }: { revisionId: string; version: number }) =>
      apiSend(
        'POST',
        `/entries/${entryId}/revisions/${revisionId}/restore`,
        { version },
        entryDetailSchema,
      ),
    onSuccess: (entry) => {
      invalidate(entry);
      void queryClient.invalidateQueries({ queryKey: contentKeys.revisions(entryId) });
    },
  });
}

// ------------------------------------------------------------------ terms

export function useTerms(taxonomyId: string | null, search = '', pageSize = 500) {
  const params = new URLSearchParams({ pageSize: String(pageSize) });
  if (search) params.set('search', search);
  return useQuery({
    queryKey: contentKeys.terms(taxonomyId ?? '', `${search}|${String(pageSize)}`),
    queryFn: ({ signal }) =>
      apiGet(`/taxonomies/${taxonomyId ?? ''}/terms?${params.toString()}`, termListResponseSchema, {
        signal,
      }),
    enabled: taxonomyId !== null,
    placeholderData: keepPreviousData,
  });
}

function useInvalidateTerms() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: contentKeys.allTerms });
    void queryClient.invalidateQueries({ queryKey: contentKeys.model });
  };
}

export function useSaveTerm() {
  const invalidate = useInvalidateTerms();
  return useMutation({
    mutationFn: (
      input:
        | { taxonomyId: string; id?: undefined; body: CreateTermInput }
        | { id: string; body: UpdateTermInput },
    ) =>
      input.id === undefined
        ? apiSend('POST', `/taxonomies/${input.taxonomyId}/terms`, input.body, termSchema)
        : apiSend('PATCH', `/terms/${input.id}`, input.body, termSchema),
    onSuccess: invalidate,
  });
}

export function useDeleteTerm() {
  const invalidate = useInvalidateTerms();
  return useMutation({
    mutationFn: (id: string) => apiSend('DELETE', `/terms/${id}`, undefined, null),
    onSuccess: invalidate,
  });
}

// ------------------------------------------------------------------ content types and taxonomies

function useInvalidateModel() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: contentKeys.model });
  };
}

export function useSaveContentType() {
  const invalidate = useInvalidateModel();
  return useMutation({
    mutationFn: (
      input:
        | { id?: undefined; body: CreateContentTypeInput }
        | { id: string; body: UpdateContentTypeInput },
    ) =>
      input.id === undefined
        ? apiSend('POST', '/content-types', input.body, contentTypeSchema)
        : apiSend('PATCH', `/content-types/${input.id}`, input.body, contentTypeSchema),
    onSuccess: invalidate,
  });
}

export function useDeleteContentType() {
  const invalidate = useInvalidateModel();
  return useMutation({
    mutationFn: (id: string) => apiSend('DELETE', `/content-types/${id}`, undefined, null),
    onSuccess: invalidate,
  });
}

export function useSaveTaxonomy() {
  const invalidate = useInvalidateModel();
  return useMutation({
    mutationFn: (
      input:
        { id?: undefined; body: CreateTaxonomyInput } | { id: string; body: UpdateTaxonomyInput },
    ) =>
      input.id === undefined
        ? apiSend('POST', '/taxonomies', input.body, taxonomySchema)
        : apiSend('PATCH', `/taxonomies/${input.id}`, input.body, taxonomySchema),
    onSuccess: invalidate,
  });
}

export function useDeleteTaxonomy() {
  const invalidate = useInvalidateModel();
  return useMutation({
    mutationFn: (id: string) => apiSend('DELETE', `/taxonomies/${id}`, undefined, null),
    onSuccess: invalidate,
  });
}
