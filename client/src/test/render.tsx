// client/src/test/render.tsx — render một trang trong QueryClientProvider + MemoryRouter; route khác hiện đường dẫn
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

export const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{`${loc.pathname}${loc.search}`}</p>;
}

export function renderPage(element: ReactElement, opts: { path: string; at?: string }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[opts.at ?? opts.path]} future={ROUTER_FUTURE}>
        <Routes>
          <Route path={opts.path} element={element} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, client };
}

export const currentPath = () => screen.queryByTestId('where')?.textContent ?? null;
