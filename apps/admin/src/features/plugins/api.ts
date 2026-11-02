import {
  pluginDetailSchema,
  pluginLogsResponseSchema,
  pluginShortcodesResponseSchema,
  pluginsResponseSchema,
  type ActivatePluginInput,
  type PluginSettingValue,
} from '@nexora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiSend, apiUpload } from '../../lib/api-client';

export const pluginKeys = {
  all: ['plugins'] as const,
  list: ['plugins', 'list'] as const,
  detail: (key: string) => ['plugins', 'detail', key] as const,
  logs: (key: string) => ['plugins', 'logs', key] as const,
  shortcodes: ['plugins', 'shortcodes'] as const,
};

export function usePlugins() {
  return useQuery({
    queryKey: pluginKeys.list,
    queryFn: ({ signal }) => apiGet('/plugins', pluginsResponseSchema, { signal }),
  });
}

export function usePlugin(key: string) {
  return useQuery({
    queryKey: pluginKeys.detail(key),
    queryFn: ({ signal }) =>
      apiGet(`/plugins/${encodeURIComponent(key)}`, pluginDetailSchema, { signal }),
  });
}

export function usePluginLogs(key: string) {
  return useQuery({
    queryKey: pluginKeys.logs(key),
    queryFn: ({ signal }) =>
      apiGet(`/plugins/${encodeURIComponent(key)}/logs`, pluginLogsResponseSchema, { signal }),
  });
}

/** Shortcodes of active plugins (editors use them to recognise plugin shortcodes). */
export function usePluginShortcodes(enabled = true) {
  return useQuery({
    queryKey: pluginKeys.shortcodes,
    queryFn: ({ signal }) =>
      apiGet('/plugin-shortcodes', pluginShortcodesResponseSchema, { signal }),
    enabled,
    staleTime: 60_000,
  });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: pluginKeys.all });
}

export function useUploadPlugin() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return apiUpload('/plugins', form, pluginDetailSchema);
    },
    onSuccess: () => invalidate(),
  });
}

export function useInstallBundled() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (key: string) =>
      apiSend('POST', `/plugins/bundled/${encodeURIComponent(key)}`, undefined, pluginDetailSchema),
    onSuccess: () => invalidate(),
  });
}

export function useActivatePlugin() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ key, input }: { key: string; input: ActivatePluginInput }) =>
      apiSend('POST', `/plugins/${encodeURIComponent(key)}/activate`, input, pluginDetailSchema),
    onSuccess: () => invalidate(),
  });
}

export function useDeactivatePlugin() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (key: string) =>
      apiSend(
        'POST',
        `/plugins/${encodeURIComponent(key)}/deactivate`,
        undefined,
        pluginDetailSchema,
      ),
    onSuccess: () => invalidate(),
  });
}

export function useUpdatePluginSettings() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ key, values }: { key: string; values: Record<string, PluginSettingValue> }) =>
      apiSend('PUT', `/plugins/${encodeURIComponent(key)}/settings`, values, pluginDetailSchema),
    onSuccess: () => invalidate(),
  });
}

export function useUninstallPlugin() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (key: string) =>
      apiSend('DELETE', `/plugins/${encodeURIComponent(key)}`, undefined, null),
    onSuccess: () => invalidate(),
  });
}
