// client/src/features/calls/CallTopBar.tsx — tên · đồng hồ (từ connectedAt server, bù lệch giờ) + NetworkQualityBadge (§3.7)
import { useEffect, useState } from 'react';
import { vi } from '../../i18n/vi';
import { formatCallClock } from '../../lib/time/format';
import { serverNow } from '../../lib/time/server-clock';
import { useCallStore } from '../../stores/call.store';

function useClock(connectedAt: string | null): string | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!connectedAt) return;
    const t = setInterval(() => {
      tick((n) => n + 1);
    }, 1000);
    return () => {
      clearInterval(t);
    };
  }, [connectedAt]);
  if (!connectedAt) return null;
  return formatCallClock((serverNow() - Date.parse(connectedAt)) / 1000);
}

function NetworkQualityBadge() {
  const poor = useCallStore((s) => s.networkQuality === 'poor' && s.call?.status === 'CONNECTED');
  if (!poor) return null;
  return (
    <span className="rounded-pill bg-warning px-2 py-0.5 text-xs font-semibold text-black">{vi.calls.poorNetwork}</span>
  );
}

export function CallTopBar({ name, connectedAt }: { name: string; connectedAt: string | null }) {
  const clock = useClock(connectedAt);
  return (
    <div className="flex items-center justify-between gap-3 px-4 pt-[max(12px,var(--safe-top))] text-white">
      <p className="truncate text-md font-semibold" dir="auto">
        {name}
        {clock ? (
          <>
            {' · '}
            <span className="font-normal text-white/80">{clock}</span>
          </>
        ) : null}
      </p>
      <NetworkQualityBadge />
    </div>
  );
}
