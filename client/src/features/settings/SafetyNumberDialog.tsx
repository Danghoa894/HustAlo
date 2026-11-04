// client/src/features/settings/SafetyNumberDialog.tsx — "Xác minh mã an toàn với {tên}" (ui_ux_spec.md §3.8,
// FR-E2EE-005): mỗi device của peer một safety number 60 chữ số (3 hàng × 4 nhóm 5 số, tabular-nums), "Đánh dấu đã
// xác minh" → ShieldCheck "Đã xác minh" (lưu IndexedDB cho cặp device peer + identity key), "Sao chép".
import { ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { vi } from '../../i18n/vi';
import { bufferToB64 } from '../../lib/e2ee/codec';
import { computeSafetyNumber, safetyNumberRows } from '../../lib/e2ee/safety-number';
import type { KnownIdentity } from '../../lib/e2ee/signal-store';
import { useSecretCrypto } from '../e2ee/useSecretSession';

function DeviceSafetyNumber({
  meId,
  myKey,
  device,
  index,
  onVerify,
}: {
  meId: string;
  myKey: string;
  device: KnownIdentity;
  index: number;
  onVerify: (address: string) => Promise<void>;
}) {
  const [digits, setDigits] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void computeSafetyNumber(
      { userId: meId, identityKey: myKey },
      { userId: device.userId, identityKey: device.identityKey },
    ).then((d) => {
      if (alive) setDigits(d);
    });
    return () => {
      alive = false;
    };
  }, [meId, myKey, device.userId, device.identityKey]);

  return (
    <li className="flex flex-col gap-2 rounded-md bg-surface-3 p-3">
      <p className="text-sm font-medium">{vi.e2ee.deviceLabel(index + 1)}</p>
      {digits ? (
        <div data-testid="safety-number" className="font-mono text-base tabular-nums">
          {safetyNumberRows(digits).map((row) => (
            <p key={row.join('')} className="flex gap-3">
              {row.map((g, i) => (
                <span key={`${String(i)}-${g}`}>{g}</span>
              ))}
            </p>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {device.verified ? (
          <span className="inline-flex items-center gap-1 text-sm text-success">
            <ShieldCheck size={16} aria-hidden="true" />
            {vi.e2ee.verified}
          </span>
        ) : (
          <Button variant="secondary" onClick={() => void onVerify(device.address)}>
            {vi.e2ee.markVerified}
          </Button>
        )}
        <Button
          variant="secondary"
          disabled={!digits}
          onClick={() => {
            if (digits && typeof navigator.clipboard === 'object') {
              void navigator.clipboard.writeText(digits).catch(() => undefined);
            }
          }}
        >
          {vi.e2ee.copy}
        </Button>
      </div>
    </li>
  );
}

export function SafetyNumberDialog({
  open,
  meId,
  peerName,
  devices,
  onVerify,
  onClose,
}: {
  open: boolean;
  meId: string;
  peerName: string;
  devices: KnownIdentity[];
  onVerify: (address: string) => Promise<void>;
  onClose: () => void;
}) {
  const crypto = useSecretCrypto();
  const [myKey, setMyKey] = useState<string | null>(null);
  useEffect(() => {
    if (!crypto || !open) return;
    void crypto.store.getMeta().then((m) => {
      setMyKey(m ? bufferToB64(m.identityKeyPair.pubKey) : null);
    });
  }, [crypto, open]);

  return (
    <Modal
      open={open}
      title={vi.e2ee.safetyTitle(peerName)}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {vi.common.close}
        </Button>
      }
    >
      <p className="mb-3 text-sm text-text-secondary">{vi.e2ee.safetyHint(peerName)}</p>
      {devices.length === 0 || !myKey ? (
        <p className="text-sm">{vi.e2ee.noPeerDevices}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {devices.map((d, i) => (
            <DeviceSafetyNumber key={d.address} meId={meId} myKey={myKey} device={d} index={i} onVerify={onVerify} />
          ))}
        </ul>
      )}
    </Modal>
  );
}
