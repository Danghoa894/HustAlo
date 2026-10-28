// client/src/components/layout/ConnectionBanner.tsx — banner trạng thái kết nối (ui_ux_spec.md §3.0, §4.1):
// connecting/reconnecting/expired chỉ hiện sau BANNER_DELAY_MS (EC-NET-002, EC-AUTH-002); offline hiện ngay; connected ẩn.
import { useEffect, useState } from 'react';
import { Banner } from '../ui/Banner';
import { Spinner } from '../ui/Spinner';
import { vi } from '../../i18n/vi';
import { useSocketStore } from '../../stores/socket.store';

export const BANNER_DELAY_MS = 2000;

export function ConnectionBanner() {
  const state = useSocketStore((s) => s.connectionState);
  const pending = state === 'connecting' || state === 'reconnecting' || state === 'expired';
  const [delayed, setDelayed] = useState(false);

  useEffect(() => {
    if (!pending) {
      setDelayed(false);
      return;
    }
    const timer = setTimeout(() => {
      setDelayed(true);
    }, BANNER_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [pending]);

  if (state === 'offline') return <Banner tone="danger">{vi.connection.offline}</Banner>;
  if (pending && delayed) {
    return (
      <Banner tone="warning">
        <Spinner size={16} />
        {vi.connection.reconnecting}
      </Banner>
    );
  }
  return null;
}
