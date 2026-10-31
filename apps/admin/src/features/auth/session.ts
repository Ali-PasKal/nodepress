import { sessionResponseSchema, type LoginRequest, type SessionResponse } from '@nexora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiSend, setCsrfToken } from '../../lib/api-client';

export const sessionQueryKey = ['auth', 'session'] as const;

export async function fetchSession(signal?: AbortSignal): Promise<SessionResponse> {
  const session = await apiGet('/auth/session', sessionResponseSchema, signal ? { signal } : {});
  setCsrfToken(session.authenticated ? session.csrfToken : null);
  return session;
}

export function useSession() {
  return useQuery({
    queryKey: sessionQueryKey,
    queryFn: ({ signal }) => fetchSession(signal),
    staleTime: 60_000,
    retry: false,
  });
}

/** Capabilities of the signed-in user (empty when signed out). For UI hints only; the API enforces. */
export function useCapabilities(): ReadonlySet<string> {
  const session = useSession();
  return new Set(session.data?.authenticated ? session.data.capabilities : []);
}

/** Stores a fresh session (login, password change) in the cache and the CSRF holder. */
export function useStoreSession() {
  const queryClient = useQueryClient();
  return (session: SessionResponse) => {
    setCsrfToken(session.authenticated ? session.csrfToken : null);
    queryClient.setQueryData(sessionQueryKey, session);
  };
}

export function useLogin() {
  const store = useStoreSession();
  return useMutation({
    mutationFn: (input: LoginRequest) =>
      apiSend('POST', '/auth/login', input, sessionResponseSchema),
    onSuccess: store,
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiSend('POST', '/auth/logout', undefined, null),
    onSettled: () => {
      setCsrfToken(null);
      // Update the session entry in place (mounted guards observe it), then drop every other cached
      // response that belonged to the signed-in user. queryClient.clear() would detach observers.
      queryClient.setQueryData(sessionQueryKey, { authenticated: false });
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== 'auth' && query.queryKey[0] !== 'system',
      });
    },
  });
}

/** Only same-app relative paths are accepted as post-login destinations (no open redirects). */
export function safeNextPath(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')
    ? next
    : '/';
}
