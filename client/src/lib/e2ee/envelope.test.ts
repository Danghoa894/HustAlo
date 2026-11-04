// @vitest-environment node
// envelope.ts + device-keys.ts với thư viện D-12 thật và server giả trong RAM (đăng ký khóa, bundle tiêu thụ OTPK).
// AC-110 (phần client), AC-111, AC-113/TC-E2EE-003, AC-114, AC-115 (bổ sung), AC-117/TC-E2EE-005, AC-118/TC-E2EE-007.
import type {
  DeviceKeysResponse,
  Message,
  OneTimePreKey,
  PreKeyBundle,
  RegisterDeviceKeysRequest,
} from '@hustalo/shared';
import { describe, expect, it, vi } from 'vitest';
import { b64ToBuffer, bufferToB64 } from './codec';
import { ensureDeviceKeys, topUpPreKeys, type DeviceKeysApi } from './device-keys';
import { IdentityBlockedError, SecretCrypto, plainKey, type E2eeEnvelopeOut } from './envelope';
import { SignalStore } from './signal-store';

interface ServerDevice {
  userId: string;
  deviceId: string;
  signalDeviceId: number;
  keys: RegisterDeviceKeysRequest;
  preKeys: OneTimePreKey[];
  active: boolean;
}

/** Server giả: đủ quy tắc của PUT keys / POST prekeys / GET bundles để kiểm phía client. */
function fakeServer() {
  const devices: ServerDevice[] = [];
  const requests: unknown[] = [];
  const err = (code: string) => Object.assign(new Error(code), { code });
  const api = (userId: string): DeviceKeysApi => ({
    registerKeys(deviceId, body) {
      requests.push(body);
      let d = devices.find((x) => x.userId === userId && x.deviceId === deviceId);
      if (!d) {
        if (!body.oneTimePreKeys) return Promise.reject(err('VALIDATION_ERROR'));
        const sid = devices.filter((x) => x.userId === userId).length + 1;
        d = { userId, deviceId, signalDeviceId: sid, keys: body, preKeys: [], active: true };
        devices.push(d);
      } else if (d.keys.identityKey !== body.identityKey) {
        d.preKeys = [];
      }
      d.keys = body;
      d.active = true;
      d.preKeys.push(...(body.oneTimePreKeys ?? []));
      const res: DeviceKeysResponse = {
        deviceId,
        signalDeviceId: d.signalDeviceId,
        oneTimePreKeyCount: d.preKeys.length,
      };
      return Promise.resolve(res);
    },
    uploadPreKeys(deviceId, keys) {
      const d = devices.find((x) => x.userId === userId && x.deviceId === deviceId);
      if (!d) return Promise.reject(err('FORBIDDEN'));
      d.preKeys.push(...keys);
      return Promise.resolve({ oneTimePreKeyCount: d.preKeys.length });
    },
  });
  const fetchBundles = (userId: string): Promise<PreKeyBundle[]> =>
    Promise.resolve(
      devices
        .filter((d) => d.userId === userId && d.active)
        .map((d) => ({
          userId,
          deviceId: d.deviceId,
          signalDeviceId: d.signalDeviceId,
          registrationId: d.keys.registrationId,
          identityKey: d.keys.identityKey,
          signedPreKey: d.keys.signedPreKey,
          oneTimePreKey: d.preKeys.shift() ?? null,
        })),
    );
  return { devices, requests, api, fetchBundles };
}

let seq = 0;

async function device(server: ReturnType<typeof fakeServer>, userId: string, onIdentityChanged = vi.fn()) {
  const deviceId = crypto.randomUUID();
  const store = await SignalStore.open(`${userId}-${String(seq++)}`);
  expect(await ensureDeviceKeys({ store, deviceId, api: server.api(userId) })).toBe('READY');
  const crypto_ = new SecretCrypto({
    store,
    me: { userId, deviceId },
    fetchBundles: server.fetchBundles,
    onIdentityChanged,
  });
  return { userId, deviceId, store, crypto: crypto_, onIdentityChanged };
}

let msgSeq = 0;
/** Message như server phát cho một device: envelope chỉ còn recipient của device đó. */
function deliver(env: E2eeEnvelopeOut, senderId: string, forDeviceId: string, over: Partial<Message> = {}): Message {
  msgSeq += 1;
  return {
    id: `6720f1b2c3d4e5f6012${String(10000 + msgSeq)}`,
    conversationId: '6720b1b2c3d4e5f601234501',
    senderId,
    sender: { id: senderId, displayName: 'x' },
    senderDeviceId: env.senderDeviceId,
    clientMessageId: crypto.randomUUID(),
    type: 'TEXT',
    content: null,
    ciphertext: {
      v: 1,
      senderDeviceId: env.senderDeviceId,
      recipients: env.recipients.filter((r) => r.deviceId === forDeviceId),
    },
    system: null,
    receipt: null,
    createdAt: new Date().toISOString(),
    editedAt: null,
    deletedAt: null,
    ...over,
  };
}

const ALICE = '6720a1b2c3d4e5f601234561';
const BOB = '6720a1b2c3d4e5f601234562';

describe('device-keys (FR-E2EE-001, FR-E2EE-003)', () => {
  it('TC-AC-110 đăng ký lần đầu: 100 prekey, request không có trường khóa riêng; khởi động lại không sinh khóa mới', async () => {
    const server = fakeServer();
    const x = await device(server, ALICE);
    const first = server.requests[0] as RegisterDeviceKeysRequest;
    expect(first.oneTimePreKeys).toHaveLength(100);
    expect(Object.keys(first).sort()).toEqual(['identityKey', 'oneTimePreKeys', 'registrationId', 'signedPreKey']);
    expect(Object.keys(first.signedPreKey).sort()).toEqual(['keyId', 'publicKey', 'signature']);
    expect(JSON.stringify(first)).not.toMatch(/priv/i);
    expect(await x.store.countPreKeys()).toBe(100);

    await ensureDeviceKeys({ store: x.store, deviceId: x.deviceId, api: server.api(ALICE) });
    const second = server.requests[1] as RegisterDeviceKeysRequest;
    expect(second.identityKey).toBe(first.identityKey);
    expect(second.oneTimePreKeys).toBeUndefined();
  });

  it('server không có device (VALIDATION_ERROR) → gửi lại kèm lô prekey keyId tiếp nối; 409 → LIMIT', async () => {
    const server = fakeServer();
    const x = await device(server, ALICE);
    server.devices.length = 0;
    expect(await ensureDeviceKeys({ store: x.store, deviceId: x.deviceId, api: server.api(ALICE) })).toBe('READY');
    expect(server.devices[0]?.preKeys[0]?.keyId).toBe(101);

    const conflict: DeviceKeysApi = {
      registerKeys: () => Promise.reject(Object.assign(new Error('x'), { code: 'CONFLICT' })),
      uploadPreKeys: () => Promise.reject(new Error('không gọi')),
    };
    const store = await SignalStore.open(`limit-${String(seq++)}`);
    expect(await ensureDeviceKeys({ store, deviceId: crypto.randomUUID(), api: conflict })).toBe('LIMIT');
  });

  it('TC-AC-115 bổ sung 100 prekey keyId tiếp nối; khởi động thấy < 20 → tự bổ sung; xoay signed prekey sau 7 ngày', async () => {
    const server = fakeServer();
    const x = await device(server, ALICE);
    const d = server.devices[0];
    if (!d) throw new Error('thiếu device');
    d.preKeys.splice(0, 81); // còn 19
    expect(await topUpPreKeys({ store: x.store, deviceId: x.deviceId, api: server.api(ALICE) })).toBe(119);
    expect(d.preKeys.at(-1)?.keyId).toBe(200);

    d.preKeys.splice(0, 110); // còn 9
    const later = Date.now() + 8 * 24 * 60 * 60 * 1000;
    await ensureDeviceKeys({ store: x.store, deviceId: x.deviceId, api: server.api(ALICE), now: () => later });
    expect(d.preKeys).toHaveLength(109);
    expect(d.keys.signedPreKey.keyId).toBe(2);
    expect(await x.store.getSignedPreKeyRow(1)).toBeDefined(); // giữ bản cũ thêm một chu kỳ
  });
});

describe('encryptFanout / decryptForThisDevice (FR-E2EE-004)', () => {
  it('TC-AC-111 alice X → bob Y, Z: 2 recipient type 3, cả hai giải mã "chào"; trả lời của bob type 1', async () => {
    const server = fakeServer();
    const x = await device(server, ALICE);
    const y = await device(server, BOB);
    const z = await device(server, BOB);
    const env = await x.crypto.encryptFanout(BOB, crypto.randomUUID(), 'chào');
    expect(env.senderDeviceId).toBe(x.deviceId);
    expect(env.recipients.map((r) => [r.deviceId, r.type])).toEqual([
      [y.deviceId, 3],
      [z.deviceId, 3],
    ]);
    expect(await y.crypto.decryptForThisDevice(deliver(env, ALICE, y.deviceId))).toEqual({
      kind: 'TEXT',
      text: 'chào',
    });
    expect(await z.crypto.decryptForThisDevice(deliver(env, ALICE, z.deviceId))).toEqual({
      kind: 'TEXT',
      text: 'chào',
    });
    expect(await y.crypto.hasSessionWith(ALICE)).toBe(true);
    expect(await x.crypto.hasSessionWith(BOB)).toBe(true);

    const reply = await y.crypto.encryptFanout(ALICE, crypto.randomUUID(), 'chào alice');
    // recipients = X (peer) + Z (device khác của bob)
    expect(reply.recipients.map((r) => r.deviceId).sort()).toEqual([x.deviceId, z.deviceId].sort());
    expect(reply.recipients.find((r) => r.deviceId === x.deviceId)?.type).toBe(1);
    expect(await x.crypto.decryptForThisDevice(deliver(reply, BOB, x.deviceId))).toEqual({
      kind: 'TEXT',
      text: 'chào alice',
    });
    expect(await z.crypto.decryptForThisDevice(deliver(reply, BOB, z.deviceId))).toEqual({
      kind: 'TEXT',
      text: 'chào alice',
    });
  });

  it('bản rõ cục bộ: tin của mình hiển thị từ clientMessageId rồi chuyển sang messageId; tải lại không giải mã lần hai', async () => {
    const server = fakeServer();
    const x = await device(server, ALICE);
    const y = await device(server, BOB);
    const cmid = crypto.randomUUID();
    const env = await x.crypto.encryptFanout(BOB, cmid, 'của tôi');
    const own = deliver(env, ALICE, x.deviceId, { clientMessageId: cmid });
    expect(own.ciphertext?.recipients).toEqual([]);
    expect(await x.crypto.decryptForThisDevice(own)).toEqual({ kind: 'TEXT', text: 'của tôi' });
    expect(await x.store.getPlaintext(plainKey.message(own.id))).toBe('của tôi');
    expect(await x.store.getPlaintext(plainKey.pending(cmid))).toBeUndefined();

    const forY = deliver(env, ALICE, y.deviceId);
    expect(await y.crypto.decryptForThisDevice(forY)).toEqual({ kind: 'TEXT', text: 'của tôi' });
    expect(await y.crypto.decryptForThisDevice(forY)).toEqual({ kind: 'TEXT', text: 'của tôi' }); // từ bản rõ cục bộ
    await y.crypto.forget(forY.id);
    expect(await y.crypto.decryptForThisDevice(forY)).toEqual({ kind: 'DECRYPT_FAILED' }); // ratchet đã tiêu khóa
  });

  it('TC-AC-118 TC-E2EE-007 device W đăng ký sau khi tin được gửi → NOT_FOR_DEVICE; tin mới sau đó đọc được', async () => {
    const server = fakeServer();
    const x = await device(server, ALICE);
    await device(server, BOB);
    const old = await x.crypto.encryptFanout(BOB, crypto.randomUUID(), 'cũ');
    const w = await device(server, BOB);
    expect(await w.crypto.decryptForThisDevice(deliver(old, ALICE, w.deviceId))).toEqual({ kind: 'NOT_FOR_DEVICE' });
    const fresh = await x.crypto.encryptFanout(BOB, crypto.randomUUID(), 'mới', true);
    expect(await w.crypto.decryptForThisDevice(deliver(fresh, ALICE, w.deviceId))).toEqual({
      kind: 'TEXT',
      text: 'mới',
    });
  });

  it('TC-AC-114 TC-E2EE-004 bản mã bị sửa 1 byte → DECRYPT_FAILED, tin khác không ảnh hưởng', async () => {
    const server = fakeServer();
    const x = await device(server, ALICE);
    const y = await device(server, BOB);
    const a = await x.crypto.encryptFanout(BOB, crypto.randomUUID(), 'một');
    const b = await x.crypto.encryptFanout(BOB, crypto.randomUUID(), 'hai');
    const c = await x.crypto.encryptFanout(BOB, crypto.randomUUID(), 'ba');
    expect(await y.crypto.decryptForThisDevice(deliver(a, ALICE, y.deviceId))).toEqual({ kind: 'TEXT', text: 'một' });
    const tampered = deliver(b, ALICE, y.deviceId);
    const r = tampered.ciphertext?.recipients[0];
    if (!r) throw new Error('thiếu recipient');
    const bytes = new Uint8Array(b64ToBuffer(r.body));
    bytes[bytes.length - 12] = (bytes[bytes.length - 12] ?? 0) ^ 0x01;
    r.body = bufferToB64(bytes);
    expect(await y.crypto.decryptForThisDevice(tampered)).toEqual({ kind: 'DECRYPT_FAILED' });
    expect(await y.crypto.decryptForThisDevice(deliver(c, ALICE, y.deviceId))).toEqual({ kind: 'TEXT', text: 'ba' });
  });

  it('TC-AC-117 TC-E2EE-005 device gửi không còn trong danh bạ (đã thu hồi) → REVOKED_DEVICE', async () => {
    const server = fakeServer();
    const x = await device(server, ALICE);
    const y = await device(server, BOB);
    const z = await device(server, BOB);
    await x.crypto.encryptFanout(BOB, crypto.randomUUID(), 'thiết lập');
    const fromZ = await z.crypto.encryptFanout(ALICE, crypto.randomUUID(), 'từ Z');
    const zd = server.devices.find((d) => d.deviceId === z.deviceId);
    if (zd) zd.active = false;
    // alice chưa biết Z qua bản rõ; danh bạ mới nhất của bob không còn Z.
    const now = Date.now() + 60_000;
    const later = new SecretCrypto({
      store: x.store,
      me: { userId: ALICE, deviceId: x.deviceId },
      fetchBundles: server.fetchBundles,
      now: () => now,
    });
    expect(await later.decryptForThisDevice(deliver(fromZ, BOB, x.deviceId))).toEqual({ kind: 'REVOKED_DEVICE' });
    // Gửi tiếp chỉ còn Y.
    const next = await later.encryptFanout(BOB, crypto.randomUUID(), 'chỉ Y', true);
    expect(next.recipients.map((r) => r.deviceId)).toEqual([y.deviceId]);
  });
});

describe('identity đổi (FR-E2EE-006)', () => {
  it('TC-AC-113 TC-E2EE-003 bob Y đăng ký lại (identity mới): device đã xác minh → chặn gửi tới khi "Chấp nhận"; sau đó gửi được, verified bị xóa', async () => {
    const server = fakeServer();
    const x = await device(server, ALICE);
    const y = await device(server, BOB);
    const first = await x.crypto.encryptFanout(BOB, crypto.randomUUID(), 'một');
    await y.crypto.decryptForThisDevice(deliver(first, ALICE, y.deviceId));
    const [known] = await x.store.identitiesOf(BOB);
    if (!known) throw new Error('thiếu identity');
    await x.store.setVerified(known.address, true);

    // Bob xóa IndexedDB trên Y: store mới, cùng deviceId → server giữ signalDeviceId.
    const yStore = await SignalStore.open(`${BOB}-wiped-${String(seq++)}`);
    await ensureDeviceKeys({ store: yStore, deviceId: y.deviceId, api: server.api(BOB) });
    const y2 = new SecretCrypto({
      store: yStore,
      me: { userId: BOB, deviceId: y.deviceId },
      fetchBundles: server.fetchBundles,
    });

    const later = Date.now() + 60_000;
    const xLater = new SecretCrypto({
      store: x.store,
      me: { userId: ALICE, deviceId: x.deviceId },
      fetchBundles: server.fetchBundles,
      now: () => later,
      onIdentityChanged: x.onIdentityChanged,
    });
    await expect(xLater.encryptFanout(BOB, crypto.randomUUID(), 'bị chặn', true)).rejects.toBeInstanceOf(
      IdentityBlockedError,
    );
    expect(x.onIdentityChanged).toHaveBeenCalledWith(BOB);
    expect(await xLater.changedIdentities(BOB)).toHaveLength(1);

    await x.store.acceptIdentity(known.address);
    expect(await x.store.getIdentity(known.address)).toMatchObject({ verified: false, changed: false });
    const after = await xLater.encryptFanout(BOB, crypto.randomUUID(), 'sau khi chấp nhận');
    expect(after.recipients[0]?.type).toBe(3); // X3DH lại với identity mới
    expect(await y2.decryptForThisDevice(deliver(after, ALICE, y.deviceId))).toEqual({
      kind: 'TEXT',
      text: 'sau khi chấp nhận',
    });
  });

  it('identity đổi nhưng chưa xác minh → chỉ cảnh báo, vẫn gửi được', async () => {
    const server = fakeServer();
    const x = await device(server, ALICE);
    const y = await device(server, BOB);
    await x.crypto.encryptFanout(BOB, crypto.randomUUID(), 'một');
    const yStore = await SignalStore.open(`${BOB}-wiped-${String(seq++)}`);
    await ensureDeviceKeys({ store: yStore, deviceId: y.deviceId, api: server.api(BOB) });
    const later = Date.now() + 60_000;
    const xLater = new SecretCrypto({
      store: x.store,
      me: { userId: ALICE, deviceId: x.deviceId },
      fetchBundles: server.fetchBundles,
      now: () => later,
    });
    const env = await xLater.encryptFanout(BOB, crypto.randomUUID(), 'vẫn gửi', true);
    expect(env.recipients).toHaveLength(1);
    expect(await xLater.changedIdentities(BOB)).toHaveLength(1);
  });
});
