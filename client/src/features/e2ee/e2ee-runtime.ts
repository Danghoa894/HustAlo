// client/src/features/e2ee/e2ee-runtime.ts — phần E2EE chạy suốt phiên đăng nhập (kiến trúc §7(h)):
// - Mở SignalStore `hustalo-signal-{userId}`, dựng SecretCrypto (danh bạ device, mã hóa/giải mã).
// - Đăng ký / làm mới khóa device lúc rảnh sau khi đăng nhập (FR-E2EE-001): dưới Web Lock để hai tab cùng device không
//   cùng sinh hai identity; 409 → device.LIMIT (DevicesSection, phòng SECRET hiện banner).
// - e2ee:prekeys-low cho device này → bổ sung 100 prekey (FR-E2EE-003).
import { EVENTS } from '@hustalo/shared';
import { getDeviceId } from '../../lib/device/device-id';
import { ensureDeviceKeys, topUpPreKeys } from '../../lib/e2ee/device-keys';
import { SecretCrypto } from '../../lib/e2ee/envelope';
import { SignalStore } from '../../lib/e2ee/signal-store';
import { socket } from '../../lib/socket/socket';
import { useE2eeStore } from '../../stores/e2ee.store';
import { e2eeApi } from './e2ee.api';

interface Runtime {
  userId: string;
  crypto: Promise<SecretCrypto | null>;
  /** Khóa device đã đăng ký (READY) hay chưa dùng được (LIMIT/ERROR). */
  keys: Promise<boolean>;
}

let current: Runtime | null = null;

/** SecretCrypto của phiên (null: chưa đăng nhập hoặc trình duyệt chặn IndexedDB). */
export const getSecretCrypto = (): Promise<SecretCrypto | null> => current?.crypto ?? Promise.resolve(null);

/** Chờ khóa device đăng ký xong; false nếu device không dùng được Secret Chat. */
export const whenDeviceKeysReady = (): Promise<boolean> => current?.keys ?? Promise.resolve(false);

type LockManagerLike = { request: (name: string, cb: () => Promise<unknown>) => Promise<unknown> };

function withDeviceLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks;
  if (!locks) return fn();
  return locks.request('hustalo-e2ee-device-keys', fn) as Promise<T>;
}

function idle(): Promise<void> {
  return new Promise((resolve) => {
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
      .requestIdleCallback;
    if (typeof ric === 'function') ric(() => resolve(), { timeout: 2000 });
    else setTimeout(resolve, 0);
  });
}

export interface E2eeRuntimeOptions {
  meId: string;
  /** Test: thay store (mặc định IndexedDB thật). */
  openStore?: (userId: string) => Promise<SignalStore>;
}

const openSignalStore = (userId: string) => SignalStore.open(userId);

export function startE2eeRuntime({ meId, openStore = openSignalStore }: E2eeRuntimeOptions): () => void {
  const deviceId = getDeviceId();
  const ui = useE2eeStore.getState();
  ui.reset();
  let stopped = false;

  const storePromise = openStore(meId).catch(() => null);
  const crypto = storePromise.then((store) =>
    store
      ? new SecretCrypto({
          store,
          me: { userId: meId, deviceId },
          fetchBundles: (userId) => e2eeApi.bundles(userId),
          onIdentityChanged: () => {
            useE2eeStore.getState().bump();
          },
        })
      : null,
  );
  const api = { registerKeys: e2eeApi.registerKeys, uploadPreKeys: e2eeApi.uploadPreKeys };
  const keys = storePromise.then(async (store) => {
    if (!store) {
      useE2eeStore.getState().setDevice('ERROR');
      return false;
    }
    await idle();
    if (stopped) return false;
    try {
      const status = await withDeviceLock(() => ensureDeviceKeys({ store, deviceId, api }));
      useE2eeStore.getState().setDevice(status);
      return status === 'READY';
    } catch {
      useE2eeStore.getState().setDevice('ERROR');
      return false;
    }
  });
  const runtime: Runtime = { userId: meId, crypto, keys };
  current = runtime;

  const onLow = (p: { deviceId: string; remaining: number }) => {
    if (p.deviceId !== deviceId) return;
    void storePromise.then((store) =>
      store ? withDeviceLock(() => topUpPreKeys({ store, deviceId, api })).catch(() => undefined) : undefined,
    );
  };
  socket.on(EVENTS.E2EE_PREKEYS_LOW, onLow);

  return () => {
    stopped = true;
    socket.off(EVENTS.E2EE_PREKEYS_LOW, onLow);
    if (current === runtime) current = null;
    void storePromise.then((s) => s?.close());
    useE2eeStore.getState().reset();
  };
}
