import type { QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { sessionQueryKey } from '../features/auth/session';
import { onAuthError, setCsrfToken } from '../lib/api-client';

/** When any request reports 401, the session is gone: drop cached data so the guards redirect to sign-in. */
export function useSessionExpiry(queryClient: QueryClient): void {
  useEffect(
    () =>
      onAuthError(() => {
        const current = queryClient.getQueryData<{ authenticated: boolean }>(sessionQueryKey);
        if (current?.authenticated) {
          setCsrfToken(null);
          queryClient.setQueryData(sessionQueryKey, { authenticated: false });
        }
      }),
    [queryClient],
  );
}
