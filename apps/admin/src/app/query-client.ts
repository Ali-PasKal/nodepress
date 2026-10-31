import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../lib/api-client';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        // Client errors (4xx) are deterministic; only retry network/server failures, at most twice.
        retry: (failureCount, error) =>
          !(error instanceof ApiError && error.isClientError) && failureCount < 2,
        refetchOnWindowFocus: true,
      },
    },
  });
}
