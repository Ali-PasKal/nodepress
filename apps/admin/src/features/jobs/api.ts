import {
  jobListResponseSchema,
  jobOverviewSchema,
  jobSummarySchema,
  type JobStatus,
} from '@nexora/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiSend } from '../../lib/api-client';

export const jobKeys = {
  all: ['jobs'] as const,
  overview: ['jobs', 'overview'] as const,
  list: (status: '' | JobStatus, page: number) => ['jobs', 'list', status, page] as const,
};

export function useJobOverview() {
  return useQuery({
    queryKey: jobKeys.overview,
    queryFn: ({ signal }) => apiGet('/jobs/overview', jobOverviewSchema, { signal }),
    refetchInterval: 15_000,
  });
}

export function useJobs(status: '' | JobStatus, page: number) {
  const params = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (status) params.set('status', status);
  return useQuery({
    queryKey: jobKeys.list(status, page),
    queryFn: ({ signal }) =>
      apiGet(`/jobs?${params.toString()}`, jobListResponseSchema, { signal }),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
}

export function useJobAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'retry' | 'discard' }) =>
      action === 'retry'
        ? apiSend('POST', `/jobs/${id}/retry`, undefined, jobSummarySchema)
        : apiSend('DELETE', `/jobs/${id}`, undefined, null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: jobKeys.all });
    },
  });
}
