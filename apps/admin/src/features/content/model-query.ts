import { contentModelResponseSchema } from '@nexora/shared';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../lib/api-client';
import { useCapabilities } from '../auth/session';

/*
 * Kept apart from ./api so the navigation (part of the initial bundle) does not pull in every content
 * schema; the rest of the content API loads with the content pages.
 */
export const contentModelKey = ['content-model'] as const;

const CONTENT_CAPABILITIES = [
  'content.read',
  'content.create',
  'content.edit_others',
  'terms.manage',
  'content_types.manage',
] as const;

export function useHasContentAccess(): boolean {
  const capabilities = useCapabilities();
  return CONTENT_CAPABILITIES.some((capability) => capabilities.has(capability));
}

export function useContentModel() {
  const enabled = useHasContentAccess();
  return useQuery({
    queryKey: contentModelKey,
    queryFn: ({ signal }) => apiGet('/content-model', contentModelResponseSchema, { signal }),
    enabled,
    staleTime: 60_000,
  });
}
