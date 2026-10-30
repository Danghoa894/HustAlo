// client/src/components/layout/LiveRegions.tsx — vùng aria-live polite/assertive dùng chung (ui_ux_spec.md §6.2)
import { useUiStore } from '../../stores/ui.store';

export function LiveRegions() {
  const live = useUiStore((s) => s.live);
  return (
    <>
      <div className="sr-only" aria-live="polite" data-testid="live-polite">
        {live.polite}
      </div>
      <div className="sr-only" aria-live="assertive" data-testid="live-assertive">
        {live.assertive}
      </div>
    </>
  );
}
