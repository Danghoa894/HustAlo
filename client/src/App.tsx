// client/src/App.tsx — providers: ThemeProvider, QueryClientProvider, RouterProvider; ToastViewport (ui_ux_spec.md §3.0)
import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useMemo, type ReactNode } from 'react';
import { RouterProvider } from 'react-router-dom';
import { ToastViewport } from './components/ui/Toast';
import { queryClient } from './lib/api/queryClient';
import { createAppRouter } from './routes/router';

export type ThemePreference = 'system' | 'light' | 'dark';
export const THEME_STORAGE_KEY = 'hustalo.theme';

function readThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Đặt data-theme theo lựa chọn; 'system' theo dõi prefers-color-scheme (ui_ux_spec.md §1.5). */
export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const pref = readThemePreference();
      const dark = pref === 'dark' || (pref === 'system' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1E293B' : '#F7F8FA');
    };
    apply();
    media.addEventListener('change', apply);
    return () => {
      media.removeEventListener('change', apply);
    };
  }, []);
  return <>{children}</>;
}

export function App() {
  const router = useMemo(() => createAppRouter(), []);
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <ToastViewport />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
