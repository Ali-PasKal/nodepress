import {
  roleListResponseSchema,
  sessionSummarySchema,
  userListResponseSchema,
  userSummarySchema,
  type CreateUserRequest,
  type UpdateUserRequest,
} from '@nexora/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { apiGet, apiSend } from '../../lib/api-client';

export interface UserFilters {
  page: number;
  search: string;
  status: '' | 'active' | 'suspended';
  roleId: string;
}

export const userKeys = {
  all: ['users'] as const,
  list: (filters: UserFilters) => ['users', 'list', filters] as const,
  sessions: (id: string) => ['users', id, 'sessions'] as const,
};
export const rolesKey = ['roles'] as const;

export function useUsers(filters: UserFilters) {
  const params = new URLSearchParams({ page: String(filters.page), pageSize: '20' });
  if (filters.search) params.set('search', filters.search);
  if (filters.status) params.set('status', filters.status);
  if (filters.roleId) params.set('roleId', filters.roleId);
  return useQuery({
    queryKey: userKeys.list(filters),
    queryFn: ({ signal }) =>
      apiGet(`/users?${params.toString()}`, userListResponseSchema, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useRoles(enabled = true) {
  return useQuery({
    queryKey: rolesKey,
    queryFn: ({ signal }) => apiGet('/roles', roleListResponseSchema, { signal }),
    enabled,
  });
}

export function useUserSessions(userId: string | null) {
  return useQuery({
    queryKey: userKeys.sessions(userId ?? ''),
    queryFn: ({ signal }) =>
      apiGet(`/users/${userId ?? ''}/sessions`, z.array(sessionSummarySchema), { signal }),
    enabled: userId !== null,
  });
}

function useInvalidateUsers() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: userKeys.all });
    void queryClient.invalidateQueries({ queryKey: rolesKey });
  };
}

export function useCreateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (input: CreateUserRequest) => apiSend('POST', '/users', input, userSummarySchema),
    onSuccess: invalidate,
  });
}

export function useUpdateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateUserRequest }) =>
      apiSend('PATCH', `/users/${id}`, input, userSummarySchema),
    onSuccess: invalidate,
  });
}

export function useSetUserPassword() {
  return useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      apiSend('POST', `/users/${id}/password`, { password }, null),
  });
}

export function useRevokeUserSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiSend(
        'POST',
        `/users/${id}/sessions/revoke-all`,
        undefined,
        z.object({ revoked: z.number() }),
      ),
    onSuccess: (_result, id) => {
      void queryClient.invalidateQueries({ queryKey: userKeys.sessions(id) });
    },
  });
}
