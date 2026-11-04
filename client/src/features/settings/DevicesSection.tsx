// client/src/features/settings/DevicesSection.tsx — "Thiết bị" (ui_ux_spec.md §3.8; GET /e2ee/devices,
// DELETE /e2ee/devices/{deviceId}; FR-E2EE-001, FR-E2EE-007). Mỗi dòng: tên dựng từ userAgent, "Đang dùng", trạng thái
// E2EE, thời điểm đăng ký, "Thu hồi" (xác nhận). Device này chưa đăng ký được vì đủ 5 → banner (FR-E2EE-001).
import type { Device } from '@hustalo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { errorMessage } from '../../i18n/errors';
import { vi } from '../../i18n/vi';
import { ApiError } from '../../lib/api/http';
import { formatDayDivider, formatClock } from '../../lib/time/format';
import { useE2eeStore } from '../../stores/e2ee.store';
import { useUiStore } from '../../stores/ui.store';
import { devicesKey, e2eeApi } from '../e2ee/e2ee.api';
import { deviceName } from './device-name';
import { SectionSkeleton } from './SectionSkeleton';

function DeviceRow({ d, onRevoke }: { d: Device; onRevoke: (d: Device) => void }) {
  const when = `${formatDayDivider(d.createdAt)} ${formatClock(d.createdAt)}`;
  return (
    <li className="flex items-center gap-3 py-2" data-testid="device-row">
      <div className="min-w-0 flex-1">
        <p className="truncate text-base">
          {deviceName(d.userAgent)}
          {d.isCurrent ? <span className="text-text-secondary"> · {vi.e2ee.inUse}</span> : null}
        </p>
        <p className={`text-sm ${d.status === 'ACTIVE' ? 'text-success' : 'text-text-secondary'}`}>
          {d.status === 'ACTIVE' ? vi.e2ee.ready : vi.e2ee.revokedStatus}
        </p>
        <p className="text-xs text-text-secondary">{vi.e2ee.registeredAt(when)}</p>
      </div>
      {d.status === 'ACTIVE' ? (
        <Button
          variant="secondary"
          onClick={() => {
            onRevoke(d);
          }}
        >
          {vi.e2ee.revoke}
        </Button>
      ) : null}
    </li>
  );
}

export function DevicesSection() {
  const queryClient = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);
  const limit = useE2eeStore((s) => s.device === 'LIMIT');
  const q = useQuery({ queryKey: devicesKey, queryFn: e2eeApi.devices });
  const [target, setTarget] = useState<Device | null>(null);
  const revoke = useMutation({
    mutationFn: (deviceId: string) => e2eeApi.revoke(deviceId),
    onSettled: () => {
      setTarget(null);
      void queryClient.invalidateQueries({ queryKey: devicesKey });
    },
    onError: (err) => {
      pushToast('error', errorMessage(err instanceof ApiError ? err.code : null));
    },
  });
  const items = q.data?.items ?? [];
  const current = items.filter((d) => d.isCurrent);
  const others = items.filter((d) => !d.isCurrent);
  return (
    <section aria-labelledby="devices-title" className="max-w-xl">
      <h2 id="devices-title" className="mb-4 text-xl font-semibold">
        {vi.settings.sections.devices}
      </h2>
      {limit ? (
        <div className="mb-4 overflow-hidden rounded-md">
          <Banner tone="warning">{vi.e2ee.deviceLimit}</Banner>
        </div>
      ) : null}
      {q.isPending ? (
        <SectionSkeleton />
      ) : items.length === 0 ? (
        <p className="text-sm text-text-secondary">{vi.e2ee.devicesEmpty}</p>
      ) : (
        <>
          {current.length > 0 ? (
            <>
              <h3 className="text-sm font-medium text-text-secondary">{vi.e2ee.thisDevice}</h3>
              <ul className="mb-4">
                {current.map((d) => (
                  <DeviceRow key={d.deviceId} d={d} onRevoke={setTarget} />
                ))}
              </ul>
            </>
          ) : null}
          {others.length > 0 ? (
            <>
              <h3 className="text-sm font-medium text-text-secondary">{vi.e2ee.otherDevices}</h3>
              <ul>
                {others.map((d) => (
                  <DeviceRow key={d.deviceId} d={d} onRevoke={setTarget} />
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
      <ConfirmDialog
        open={target !== null}
        title={vi.e2ee.confirmRevoke}
        confirmLabel={vi.e2ee.revoke}
        loading={revoke.isPending}
        onCancel={() => {
          setTarget(null);
        }}
        onConfirm={() => {
          if (target) revoke.mutate(target.deviceId);
        }}
      />
    </section>
  );
}
