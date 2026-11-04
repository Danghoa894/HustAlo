// client/src/lib/e2ee/device-keys.ts — sinh & đăng ký khóa device, bổ sung prekey, xoay signed prekey
// (FR-E2EE-001, FR-E2EE-003, kiến trúc §7(h), §9.3). Khóa riêng chỉ ghi vào SignalStore (IndexedDB); request chỉ có
// phần công khai (AC-110). Gọi mỗi lần khởi động phiên: response đăng ký trả số prekey còn lại → bổ sung khi thấp.
import {
  E2EE_ONE_TIME_PREKEY_BATCH,
  E2EE_PREKEY_LOW_THRESHOLD,
  E2EE_SIGNED_PREKEY_ROTATION_MS,
  type DeviceKeysResponse,
  type OneTimePreKey,
  type PreKeyCountResponse,
  type RegisterDeviceKeysRequest,
} from '@hustalo/shared';
import { bufferToB64 } from './codec';
import { generateIdentity, generatePreKeys, generateSignedPreKey } from './signal-adapter';
import type { LocalMeta, SignalStore } from './signal-store';

/** Port REST (features/e2ee/e2ee.api.ts); lỗi HTTP ném kèm `code` (ApiError). */
export interface DeviceKeysApi {
  registerKeys(deviceId: string, body: RegisterDeviceKeysRequest): Promise<DeviceKeysResponse>;
  uploadPreKeys(deviceId: string, keys: OneTimePreKey[]): Promise<PreKeyCountResponse>;
}

/** READY: dùng được Secret Chat; LIMIT: đã đủ 5 device ACTIVE khác (409) — chat thường vẫn bình thường. */
export type DeviceKeysStatus = 'READY' | 'LIMIT';

const codeOf = (err: unknown) => (err as { code?: unknown } | null)?.code;

async function newPreKeys(store: SignalStore, meta: LocalMeta, count = E2EE_ONE_TIME_PREKEY_BATCH) {
  const keys = await generatePreKeys(meta.nextPreKeyId, count);
  for (const k of keys) await store.storePreKey(k.keyId, k.keyPair);
  const next = { ...meta, nextPreKeyId: meta.nextPreKeyId + count };
  await store.setMeta(next);
  return { meta: next, publicKeys: keys.map((k) => ({ keyId: k.keyId, publicKey: k.publicKey })) };
}

async function createLocalKeys(store: SignalStore, now: number): Promise<LocalMeta> {
  await store.resetLocalKeys();
  const { identityKeyPair, registrationId } = await generateIdentity();
  const spk = await generateSignedPreKey(identityKeyPair, 1);
  await store.storeSignedPreKeyRow({ keyId: 1, keyPair: spk.keyPair, signature: spk.signature, createdAt: now });
  const meta: LocalMeta = {
    identityKeyPair,
    registrationId,
    nextPreKeyId: 1,
    signedPreKeyId: 1,
    signedPreKeyCreatedAt: now,
  };
  await store.setMeta(meta);
  return meta;
}

/** Xoay signed prekey khi quá E2EE_SIGNED_PREKEY_ROTATION_MS; giữ bản cũ thêm một chu kỳ rồi xóa. */
async function rotateIfDue(store: SignalStore, meta: LocalMeta, now: number): Promise<LocalMeta> {
  if (now - meta.signedPreKeyCreatedAt < E2EE_SIGNED_PREKEY_ROTATION_MS) return meta;
  const keyId = meta.signedPreKeyId + 1;
  const spk = await generateSignedPreKey(meta.identityKeyPair, keyId);
  await store.storeSignedPreKeyRow({ keyId, keyPair: spk.keyPair, signature: spk.signature, createdAt: now });
  await store.pruneSignedPreKeys([keyId, meta.signedPreKeyId], now - E2EE_SIGNED_PREKEY_ROTATION_MS);
  const next = { ...meta, signedPreKeyId: keyId, signedPreKeyCreatedAt: now };
  await store.setMeta(next);
  return next;
}

async function publicKeysOf(store: SignalStore, meta: LocalMeta): Promise<RegisterDeviceKeysRequest> {
  const spk = await store.getSignedPreKeyRow(meta.signedPreKeyId);
  if (!spk) throw new Error('Thiếu signed prekey hiện hành');
  return {
    registrationId: meta.registrationId,
    identityKey: bufferToB64(meta.identityKeyPair.pubKey),
    signedPreKey: {
      keyId: spk.keyId,
      publicKey: bufferToB64(spk.keyPair.pubKey),
      signature: bufferToB64(spk.signature),
    },
  };
}

export interface EnsureOptions {
  store: SignalStore;
  deviceId: string;
  api: DeviceKeysApi;
  now?: () => number;
}

/**
 * Khởi động phiên (FR-E2EE-001): chưa có khóa → sinh identity + signed prekey + 100 prekey và đăng ký; đã có → PUT lại
 * phần công khai (xoay signed prekey nếu đến hạn) để biết số prekey còn lại, server không có device (DB bị xóa,
 * VALIDATION_ERROR) → kèm lô prekey mới. Còn < 20 → bổ sung 100 (FR-E2EE-003). 409 → LIMIT.
 */
export async function ensureDeviceKeys({
  store,
  deviceId,
  api,
  now = Date.now,
}: EnsureOptions): Promise<DeviceKeysStatus> {
  let meta = await store.getMeta();
  let fresh: OneTimePreKey[] | undefined;
  if (!meta) {
    const created = await newPreKeys(store, await createLocalKeys(store, now()));
    meta = created.meta;
    fresh = created.publicKeys;
  } else {
    meta = await rotateIfDue(store, meta, now());
  }

  let res: DeviceKeysResponse;
  try {
    const body = await publicKeysOf(store, meta);
    try {
      res = await api.registerKeys(deviceId, fresh ? { ...body, oneTimePreKeys: fresh } : body);
    } catch (err) {
      if (fresh || codeOf(err) !== 'VALIDATION_ERROR') throw err;
      const batch = await newPreKeys(store, meta); // server chưa có device này → lần đăng ký đầu cần prekey
      meta = batch.meta;
      res = await api.registerKeys(deviceId, { ...body, oneTimePreKeys: batch.publicKeys });
    }
  } catch (err) {
    if (codeOf(err) === 'CONFLICT') return 'LIMIT';
    throw err;
  }
  if (res.oneTimePreKeyCount < E2EE_PREKEY_LOW_THRESHOLD) await topUpPreKeys({ store, deviceId, api });
  return 'READY';
}

/** e2ee:prekeys-low hoặc khởi động thấy còn ít: sinh 100 prekey keyId tiếp nối và upload (FR-E2EE-003, AC-115). */
export async function topUpPreKeys({ store, deviceId, api }: Omit<EnsureOptions, 'now'>): Promise<number> {
  const meta = await store.getMeta();
  if (!meta) return 0;
  const { publicKeys } = await newPreKeys(store, meta);
  return (await api.uploadPreKeys(deviceId, publicKeys)).oneTimePreKeyCount;
}
