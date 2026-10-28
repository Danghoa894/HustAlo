// client/src/features/settings/SectionSkeleton.tsx — loading skeleton của một mục cài đặt (ui_ux_spec.md §3.8)
import { vi } from '../../i18n/vi';

export function SectionSkeleton() {
  return (
    <div role="status" aria-label={vi.app.loading} className="flex flex-col gap-4">
      {[0, 1, 2].map((i) => (
        <div key={i} aria-hidden="true" className="h-[68px] animate-pulse rounded-md bg-surface-3" />
      ))}
    </div>
  );
}
