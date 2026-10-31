import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { Toaster } from 'sonner';
import { ThemeSync } from '../components/theme-sync';
import { resolveTheme, useThemeStore } from '../stores/theme-store';
import { createQueryClient } from './query-client';
import { adminRoutes, ROUTER_BASENAME } from './routes';
import { useSessionExpiry } from './use-session-expiry';

function ThemedToaster() {
  const preference = useThemeStore((state) => state.preference);
  const prefersDark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return (
    <Toaster
      theme={resolveTheme(preference, prefersDark)}
      position="bottom-right"
      richColors
      closeButton
    />
  );
}

export function App() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() => createBrowserRouter(adminRoutes, { basename: ROUTER_BASENAME }));
  useSessionExpiry(queryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeSync />
      <ThemedToaster />
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
