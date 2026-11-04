// client/src/features/e2ee/useSecretSession.ts — trạng thái E2EE của một hội thoại SECRET (ui_ux_spec.md §4.5):
// - SETTING_UP: chưa có session với device nào của peer → "Đang thiết lập mã hóa…" (AC-122);
// - ENCRYPTED: có session với ≥ 1 device của peer → "Mã hóa đầu-cuối"; VERIFIED: mọi device peer đã xác minh;
// - changed: identity device peer đổi (banner, FR-E2EE-006); blocked: đổi ở device đã xác minh → chặn gửi (AC-113).
// Mở hội thoại lần đầu trong lần tải trang → tải lại danh bạ device của peer để phát hiện identity đổi.
import type { Conversation } from '@hustalo/shared';
import { useCallback, useEffect, useState } from 'react';
import type { SecretCrypto } from '../../lib/e2ee/envelope';
import type { KnownIdentity } from '../../lib/e2ee/signal-store';
import { useE2eeStore } from '../../stores/e2ee.store';
import { getOutbox } from '../chat/chat-runtime';
import { getSecretCrypto } from './e2ee-runtime';

export type SecretStatus = 'SETTING_UP' | 'ENCRYPTED' | 'VERIFIED';

export interface SecretSession {
  peerId: string;
  status: SecretStatus;
  /** Device của peer đã biết identity (để tính safety number). */
  peerDevices: KnownIdentity[];
  changed: KnownIdentity[];
  blocked: boolean;
  accept: () => Promise<void>;
  setVerified: (address: string, verified: boolean) => Promise<void>;
}

const refreshedThisLoad = new Set<string>();

/** SecretCrypto của phiên (null tới khi store mở xong / không có IndexedDB). */
export function useSecretCrypto(): SecretCrypto | null {
  const [crypto, setCrypto] = useState<SecretCrypto | null>(null);
  useEffect(() => {
    let alive = true;
    void getSecretCrypto().then((c) => {
      if (alive) setCrypto(c);
    });
    return () => {
      alive = false;
    };
  }, []);
  return crypto;
}

interface Snapshot {
  status: SecretStatus;
  peerDevices: KnownIdentity[];
  changed: KnownIdentity[];
}

export function useSecretSession(conversation: Conversation | undefined, meId: string): SecretSession | null {
  const peerId =
    conversation?.type === 'SECRET' ? conversation.members.find((m) => m.userId !== meId)?.userId : undefined;
  const conversationId = conversation?.id ?? '';
  const crypto = useSecretCrypto();
  const revision = useE2eeStore((s) => s.revision);
  const [snap, setSnap] = useState<Snapshot>({ status: 'SETTING_UP', peerDevices: [], changed: [] });

  useEffect(() => {
    if (!crypto || !peerId || refreshedThisLoad.has(conversationId)) return;
    refreshedThisLoad.add(conversationId);
    crypto
      .devicesOf(peerId, 'force')
      .then(() => {
        useE2eeStore.getState().bump();
      })
      .catch(() => {
        refreshedThisLoad.delete(conversationId);
      });
  }, [crypto, peerId, conversationId]);

  useEffect(() => {
    if (!crypto || !peerId) return;
    const live = { current: true };
    void (async () => {
      const [hasSession, peerDevices] = await Promise.all([
        crypto.hasSessionWith(peerId),
        crypto.store.identitiesOf(peerId),
      ]);
      const changed = peerDevices.filter((d) => d.changed);
      const allVerified = peerDevices.length > 0 && peerDevices.every((d) => d.verified);
      const status: SecretStatus = !hasSession ? 'SETTING_UP' : allVerified ? 'VERIFIED' : 'ENCRYPTED';
      if (live.current) setSnap({ status, peerDevices, changed });
    })();
    return () => {
      live.current = false;
    };
  }, [crypto, peerId, revision]);

  const accept = useCallback(async () => {
    if (!crypto) return;
    for (const d of snap.changed) await crypto.store.acceptIdentity(d.address);
    useE2eeStore.getState().bump();
    getOutbox()?.flush(); // tin đang chờ vì identity đổi
  }, [crypto, snap.changed]);

  const setVerified = useCallback(
    async (address: string, verified: boolean) => {
      if (!crypto) return;
      await crypto.store.setVerified(address, verified);
      useE2eeStore.getState().bump();
    },
    [crypto],
  );

  if (!peerId) return null;
  return {
    peerId,
    ...snap,
    blocked: snap.changed.some((d) => d.wasVerified),
    accept,
    setVerified,
  };
}
