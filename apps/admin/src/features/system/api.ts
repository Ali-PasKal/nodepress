import {
  readinessResponseSchema,
  systemStatusResponseSchema,
  type ReadinessResponse,
  type SystemStatusResponse,
} from '@nexora/shared';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../lib/api-client';

export const systemQueryKeys = {
  readiness: ['system', 'readiness'] as const,
  status: ['system', 'status'] as const,
};

export const READINESS_REFRESH_INTERVAL_MS = 15_000;

export function fetchReadiness(signal?: AbortSignal): Promise<ReadinessResponse> {
  // 503 carries a valid readiness payload describing what is wrong, so it is not an error here.
  return apiGet('/health/ready', readinessResponseSchema, {
    acceptStatuses: [200, 503],
    ...(signal ? { signal } : {}),
  });
}

export function fetchSystemStatus(signal?: AbortSignal): Promise<SystemStatusResponse> {
  return apiGet('/system/status', systemStatusResponseSchema, signal ? { signal } : {});
}

export function useReadiness() {
  return useQuery({
    queryKey: systemQueryKeys.readiness,
    queryFn: ({ signal }) => fetchReadiness(signal),
    refetchInterval: READINESS_REFRESH_INTERVAL_MS,
  });
}

export function useSystemStatus() {
  return useQuery({
    queryKey: systemQueryKeys.status,
    queryFn: ({ signal }) => fetchSystemStatus(signal),
  });
}
