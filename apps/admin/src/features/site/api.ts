import {
  generalSettingsSchema,
  menuDetailSchema,
  menusResponseSchema,
  redirectListResponseSchema,
  redirectSchema,
  seoSettingsResponseSchema,
  themeSettingsResponseSchema,
  themesResponseSchema,
  type CreateMenuInput,
  type CreateRedirectInput,
  type SaveMenuInput,
  type UpdateGeneralSettingsInput,
  type UpdateRedirectInput,
  type UpdateSeoSettingsInput,
} from '@nexora/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiSend } from '../../lib/api-client';

export const siteKeys = {
  general: ['site', 'general'] as const,
  seo: ['site', 'seo'] as const,
  themes: ['site', 'themes'] as const,
  themeSettings: (key: string) => ['site', 'theme-settings', key] as const,
  menus: ['site', 'menus'] as const,
  menu: (id: string) => ['site', 'menus', id] as const,
  redirects: ['site', 'redirects'] as const,
  redirectList: (filters: RedirectFilters) => ['site', 'redirects', filters] as const,
};

export function useGeneralSettings(enabled = true) {
  return useQuery({
    queryKey: siteKeys.general,
    queryFn: ({ signal }) => apiGet('/settings/general', generalSettingsSchema, { signal }),
    enabled,
  });
}

export function useSaveGeneralSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateGeneralSettingsInput) =>
      apiSend('PUT', '/settings/general', input, generalSettingsSchema),
    onSuccess: (saved) => {
      queryClient.setQueryData(siteKeys.general, saved);
    },
  });
}

export function useSeoSettings() {
  return useQuery({
    queryKey: siteKeys.seo,
    queryFn: ({ signal }) => apiGet('/settings/seo', seoSettingsResponseSchema, { signal }),
  });
}

export function useSaveSeoSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSeoSettingsInput) =>
      apiSend('PUT', '/settings/seo', input, seoSettingsResponseSchema),
    onSuccess: (saved) => {
      queryClient.setQueryData(siteKeys.seo, saved);
    },
  });
}

export function useThemes() {
  return useQuery({
    queryKey: siteKeys.themes,
    queryFn: ({ signal }) => apiGet('/appearance/themes', themesResponseSchema, { signal }),
  });
}

export function useActivateTheme() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (theme: string) =>
      apiSend('PUT', '/appearance/theme', { theme }, themesResponseSchema),
    onSuccess: (saved) => {
      queryClient.setQueryData(siteKeys.themes, saved);
      void queryClient.invalidateQueries({ queryKey: siteKeys.menus });
    },
  });
}

export function useThemeSettings(key: string | null) {
  return useQuery({
    queryKey: siteKeys.themeSettings(key ?? ''),
    queryFn: ({ signal }) =>
      apiGet(
        `/appearance/themes/${encodeURIComponent(key ?? '')}/settings`,
        themeSettingsResponseSchema,
        { signal },
      ),
    enabled: key !== null,
  });
}

export function useSaveThemeSettings(key: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      apiSend(
        'PUT',
        `/appearance/themes/${encodeURIComponent(key)}/settings`,
        { values },
        themeSettingsResponseSchema,
      ),
    onSuccess: (saved) => {
      queryClient.setQueryData(siteKeys.themeSettings(key), saved);
    },
  });
}

export function useMenus() {
  return useQuery({
    queryKey: siteKeys.menus,
    queryFn: ({ signal }) => apiGet('/menus', menusResponseSchema, { signal }),
  });
}

export function useMenu(id: string | null) {
  return useQuery({
    queryKey: siteKeys.menu(id ?? ''),
    queryFn: ({ signal }) =>
      apiGet(`/menus/${encodeURIComponent(id ?? '')}`, menuDetailSchema, { signal }),
    enabled: id !== null,
  });
}

export function useCreateMenu() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMenuInput) => apiSend('POST', '/menus', input, menuDetailSchema),
    onSuccess: (menu) => {
      queryClient.setQueryData(siteKeys.menu(menu.id), menu);
      void queryClient.invalidateQueries({ queryKey: siteKeys.menus, exact: true });
    },
  });
}

export function useSaveMenu(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveMenuInput) =>
      apiSend('PUT', `/menus/${encodeURIComponent(id)}`, input, menuDetailSchema),
    onSuccess: (menu) => {
      queryClient.setQueryData(siteKeys.menu(menu.id), menu);
      void queryClient.invalidateQueries({ queryKey: siteKeys.menus, exact: true });
    },
  });
}

export function useDeleteMenu() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiSend('DELETE', `/menus/${encodeURIComponent(id)}`, null, null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: siteKeys.menus });
    },
  });
}

export interface RedirectFilters {
  search: string;
  source: '' | 'auto' | 'manual';
  page: number;
}

export function useRedirects(filters: RedirectFilters) {
  const params = new URLSearchParams({ page: String(filters.page), pageSize: '25' });
  if (filters.search) params.set('search', filters.search);
  if (filters.source) params.set('source', filters.source);
  return useQuery({
    queryKey: siteKeys.redirectList(filters),
    queryFn: ({ signal }) =>
      apiGet(`/redirects?${params.toString()}`, redirectListResponseSchema, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useSaveRedirect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (
      input:
        { id?: undefined; body: CreateRedirectInput } | { id: string; body: UpdateRedirectInput },
    ) =>
      input.id === undefined
        ? apiSend('POST', '/redirects', input.body, redirectSchema)
        : apiSend(
            'PATCH',
            `/redirects/${encodeURIComponent(input.id)}`,
            input.body,
            redirectSchema,
          ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: siteKeys.redirects });
    },
  });
}

export function useDeleteRedirect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiSend('DELETE', `/redirects/${encodeURIComponent(id)}`, null, null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: siteKeys.redirects });
    },
  });
}
