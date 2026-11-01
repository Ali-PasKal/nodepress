import {
  mediaDetailSchema,
  mediaLimitsSchema,
  mediaListResponseSchema,
  type MediaKind,
  type UpdateMediaInput,
} from '@nexora/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiSend, apiUpload } from '../../lib/api-client';

export interface MediaFilters {
  search: string;
  kind: '' | MediaKind;
  mine: boolean;
  page: number;
  pageSize?: number;
}

export const mediaKeys = {
  all: ['media'] as const,
  list: (filters: MediaFilters) => ['media', 'list', filters] as const,
  item: (id: string) => ['media', 'item', id] as const,
  limits: ['media', 'limits'] as const,
};

export function useMediaList(filters: MediaFilters, enabled = true) {
  const params = new URLSearchParams({
    page: String(filters.page),
    pageSize: String(filters.pageSize ?? 30),
  });
  if (filters.search) params.set('search', filters.search);
  if (filters.kind) params.set('kind', filters.kind);
  if (filters.mine) params.set('mine', 'true');
  return useQuery({
    queryKey: mediaKeys.list(filters),
    queryFn: ({ signal }) =>
      apiGet(`/media?${params.toString()}`, mediaListResponseSchema, { signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useMediaItem(id: string | null) {
  return useQuery({
    queryKey: mediaKeys.item(id ?? ''),
    queryFn: ({ signal }) => apiGet(`/media/${id ?? ''}`, mediaDetailSchema, { signal }),
    enabled: id !== null,
  });
}

export function useMediaLimits(enabled: boolean) {
  return useQuery({
    queryKey: mediaKeys.limits,
    queryFn: ({ signal }) => apiGet('/media/limits', mediaLimitsSchema, { signal }),
    enabled,
    staleTime: Infinity,
  });
}

export function uploadMedia(file: File, onProgress: (fraction: number) => void) {
  const form = new FormData();
  form.append('file', file, file.name);
  return apiUpload('/media', form, mediaDetailSchema, { onProgress });
}

export function useInvalidateMedia() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: mediaKeys.all });
  };
}

export function useUpdateMedia() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateMediaInput }) =>
      apiSend('PATCH', `/media/${id}`, input, mediaDetailSchema),
    onSuccess: (media) => {
      queryClient.setQueryData(mediaKeys.item(media.id), media);
      void queryClient.invalidateQueries({ queryKey: [...mediaKeys.all, 'list'] });
    },
  });
}

export function useDeleteMedia() {
  const invalidate = useInvalidateMedia();
  return useMutation({
    mutationFn: (id: string) => apiSend('DELETE', `/media/${id}`, undefined, null),
    onSuccess: invalidate,
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit] ?? 'GB'}`;
}
