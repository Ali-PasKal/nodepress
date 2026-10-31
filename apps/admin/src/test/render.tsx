import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { adminRoutes } from '../app/routes';

/** Renders the real admin route tree at `path` with a fresh, non-retrying query client. */
export function renderAdmin(path: string): RenderResult & { queryClient: QueryClient } {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchInterval: false, refetchOnWindowFocus: false },
    },
  });
  const router = createMemoryRouter(adminRoutes, { initialEntries: [path] });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

type Responder = (url: string) => Response | Promise<Response>;

/** Replaces global fetch with a router keyed by URL path. Unknown paths fail the test loudly. */
export function mockFetch(routes: Record<string, Responder>) {
  const calls: string[] = [];
  const fetchMock = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const responder = routes[url];
    if (!responder) {
      throw new Error(`Unexpected fetch: ${url}`);
    }
    return responder(url);
  };
  globalThis.fetch = fetchMock;
  return calls;
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
