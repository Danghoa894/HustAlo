// client/src/components/ui/Banner.tsx — trạng thái kéo dài, không tự ẩn (ui_ux_spec.md §5.2)
import type { ReactNode } from 'react';

export type BannerTone = 'warning' | 'danger' | 'info';

const TONES: Record<BannerTone, string> = {
  warning: 'bg-warning text-surface',
  danger: 'bg-danger text-danger-on',
  info: 'bg-surface-3 text-text',
};

export function Banner({ tone = 'info', children }: { tone?: BannerTone; children: ReactNode }) {
  return (
    <div
      role="status"
      className={`z-banner flex min-h-[40px] items-center gap-2 px-4 text-sm font-medium ${TONES[tone]}`}
    >
      {children}
    </div>
  );
}
