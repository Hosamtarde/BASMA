import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { RouteObject } from 'react-router';
import { vi } from 'vitest';
import { createQueryClient } from '@/app/query-client';

/** Renders routes in memory with the real query client (same error policy as the app). */
export function renderRoutes(routes: RouteObject[], initialPath = '/') {
  const queryClient = createQueryClient();
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, router, queryClient };
}

export const renderPage = (element: ReactElement, path = '/') =>
  renderRoutes(
    [
      { path, element },
      { path: '*', element: <p>elsewhere</p> },
    ],
    path,
  );

export const json = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const envelope = (code: string, message: string, extra: object = {}) => ({
  error: { code, message, params: {}, correlationId: 'ref-123', ...extra },
});

/** A fetch stub routed by "METHOD /path"; unknown routes answer 404. Returns the calls made. */
export function stubApi(routes: Record<string, (req: Request) => Response | Promise<Response>>) {
  const calls: { key: string; body: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Request) => {
      const key = `${input.method} ${new URL(input.url).pathname}`;
      calls.push({ key, body: input.method === 'GET' ? '' : await input.clone().text() });
      const handler = routes[key];
      return handler ? handler(input) : json(404, envelope('error.not_found', 'not found'));
    }),
  );
  return calls;
}
