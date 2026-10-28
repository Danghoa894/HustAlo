// client/src/features/auth/AuthCard.tsx — logo + tiêu đề + nội dung, rộng tối đa 420 px (ui_ux_spec.md §3.1)
import type { ReactNode } from 'react';
import { vi } from '../../i18n/vi';

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-full items-start justify-center bg-surface px-4 py-8 md:items-center md:bg-surface-2">
      <div className="w-full max-w-[420px] rounded-lg bg-surface p-0 md:p-8 md:shadow-md">
        <p className="mb-6 flex items-center gap-2 text-lg font-bold text-primary">
          <span
            aria-hidden="true"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm text-primary-on"
          >
            H
          </span>
          {vi.app.name}
        </p>
        <h1 className="mb-6 text-2xl font-semibold text-text">{title}</h1>
        {children}
      </div>
    </main>
  );
}
