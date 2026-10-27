// client/src/components/layout/AppShell.tsx — khung 2 cột theo breakpoint (ui_ux_spec.md §2, §3.0).
// Cột trái (ChatListPane | SettingsNav) và ConnectionBanner được gắn vào từ M1/M2 qua prop `sidebar` / `banner`.
import type { ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { vi } from '../../i18n/vi';

export interface AppShellProps {
  sidebar?: ReactNode;
  banner?: ReactNode;
  /** Mobile: chỉ hiện một cột — true khi đang ở trang chi tiết (phòng chat, mục cài đặt). */
  detailActive?: boolean;
}

export const MAIN_CONTENT_ID = 'main-content';

export function AppShell({ sidebar, banner, detailActive = false }: AppShellProps) {
  return (
    <div className="flex h-full bg-surface text-text">
      <a
        href={`#${MAIN_CONTENT_ID}`}
        className="sr-only z-skiplink rounded-md bg-primary px-4 py-2 text-primary-on focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        {vi.app.skipToContent}
      </a>
      {sidebar ? (
        <aside
          className={`${detailActive ? 'hidden md:flex' : 'flex'} w-full flex-col border-r border-border bg-surface-2 md:w-[320px] lg:w-[360px]`}
        >
          {sidebar}
        </aside>
      ) : null}
      <div className={`${sidebar && !detailActive ? 'hidden md:flex' : 'flex'} min-w-0 flex-1 flex-col`}>
        {banner}
        <main id={MAIN_CONTENT_ID} tabIndex={-1} className="min-h-0 flex-1 outline-none">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
