// Integration E2EE (FR-E2EE-001..004, FR-E2EE-007/008, FR-CHAT-007/008 phần SECRET): REST /e2ee/* + message:send
// kind E2EE trên Mongo replset + Redis test. Server không giải mã gì: khóa/bản mã ở đây là byte ngẫu nhiên đúng định dạng.
import { randomBytes, randomUUID } from 'node:crypto';
import {
  E2EE_PREKEYS_LOW_NOTIFY_COOLDOWN_S,
  EVENTS,
  type CreateConversationResponse,
  type DeviceKeysResponse,
  type DeviceList,
  type ErrorResponse,
  type Message,
  type MessagePage,
  type PreKeyBundlesResponse,
} from '@hustalo/shared';
import { Types } from 'mongoose';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { keys } from '../../infra/redis/keys';
import { collect, emitAck, sleep } from '../../test/chat';
import { testDb } from '../../test/db';
import { createUser, login, startTestServer, type Session, type TestServer } from '../../test/factories';
import { connectAs, waitFor } from '../../test/socket-client';
import { e2eeRepository } from './e2ee.repository';
import { OneTimePreKeyModel } from './oneTimePreKey.model';
import { UserDeviceModel } from './userDevice.model';

let server: TestServer;
const sockets: Socket[] = [];

beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  await server.reset();
});
afterEach(() => {
  for (const s of sockets.splice(0)) s.close();
});

const api = () => server.http();
const bearer = (s: Session) => ({ Authorization: `Bearer ${s.accessToken}` });
const errorOf = (res: { body: unknown }) => (res.body as ErrorResponse).error;

/** Khóa công khai Curve25519 dạng Signal: 0x05 + 32 byte → 44 ký tự base64. */
const pubKey = () => Buffer.concat([Buffer.from([5]), randomBytes(32)]).toString('base64');
const signature = () => randomBytes(64).toString('base64');
const preKeys = (n: number, from = 1) =>
  Array.from({ length: n }, (_, i) => ({ keyId: from + i, publicKey: pubKey() }));
const deviceKeys = (n = 100, from = 1) => ({
  registrationId: 1 + Math.floor(Math.random() * 16000),
  identityKey: pubKey(),
  signedPreKey: { keyId: 1, publicKey: pubKey(), signature: signature() },
  ...(n > 0 ? { oneTimePreKeys: preKeys(n, from) } : {}),
});
const body = () => randomBytes(48).toString('base64');

const putKeys = (s: Session, payload: object, deviceId = s.deviceId) =>
  api().put(`/api/v1/e2ee/devices/${deviceId}/keys`).set(bearer(s)).send(payload);
const getBundles = (s: Session, userId: string) => api().get(`/api/v1/e2ee/users/${userId}/bundles`).set(bearer(s));
const bundlesOf = async (s: Session, userId: string) => {
  const res = await getBundles(s, userId);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body as PreKeyBundlesResponse).bundles;
};

interface Person {
  id: string;
  email: string;
}

async function person(username: string): Promise<Person> {
  const u = await createUser({ username, displayName: username });
  return { id: u.id, email: u.email };
}

/** Một device của user: đăng nhập với deviceId mới, đăng ký khóa (n prekey; 0 = không đăng ký), mở socket. */
async function device(p: Person, n = 100) {
  const s = await login(server, p.email);
  if (n > 0) {
    const res = await putKeys(s, deviceKeys(n));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
  const sock = await connectAs(server.url, { token: s.accessToken, deviceId: s.deviceId });
  sockets.push(sock);
  return { s, sock, deviceId: s.deviceId };
}

async function createSecret(s: Session, peerId: string) {
  const res = await api()
    .post('/api/v1/conversations')
    .set(bearer(s))
    .set('Idempotency-Key', randomUUID())
    .send({ type: 'SECRET', memberIds: [peerId] });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return (res.body as CreateConversationResponse).conversation.id;
}

const envelope = (senderDeviceId: string, deviceIds: string[], type: 1 | 3 = 3) => ({
  v: 1 as const,
  senderDeviceId,
  recipients: deviceIds.map((deviceId) => ({ deviceId, type, body: body() })),
});

const sendSecret = (sock: Socket, conversationId: string, ciphertext: object, clientMessageId = randomUUID()) =>
  emitAck<{ message: Message; duplicate: boolean }>(sock, EVENTS.MESSAGE_SEND, {
    kind: 'E2EE',
    conversationId,
    clientMessageId,
    ciphertext,
  });

describe('FR-E2EE-001 đăng ký thiết bị và khóa', () => {
  it('TC-AC-110 PUT keys với 100 prekey → 200; deviceId ≠ did → 403; trường khóa riêng → 400; không lưu khóa riêng', async () => {
    const alice = await person('alice');
    const s = await login(server, alice.email);
    const payload = deviceKeys(100);
    const res = await putKeys(s, payload);
    expect(res.status).toBe(200);
    expect(res.body as DeviceKeysResponse).toEqual({
      deviceId: s.deviceId,
      signalDeviceId: 1,
      oneTimePreKeyCount: 100,
    });

    const other = await putKeys(s, deviceKeys(100), randomUUID());
    expect(other.status).toBe(403);
    expect(errorOf(other).code).toBe('FORBIDDEN');

    const withPrivate = await putKeys(s, { ...payload, identityKeyPair: { privKey: pubKey() } });
    expect(withPrivate.status).toBe(400);
    expect(errorOf(withPrivate).code).toBe('VALIDATION_ERROR');

    const doc = await UserDeviceModel.findOne({ userId: alice.id, deviceId: s.deviceId }).lean();
    expect(Object.keys(doc ?? {}).sort()).toEqual(
      [
        '_id',
        'userId',
        'deviceId',
        'signalDeviceId',
        'registrationId',
        'identityKey',
        'signedPreKey',
        'status',
        'revokedAt',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
    expect(Object.keys(doc?.signedPreKey ?? {}).sort()).toEqual(['createdAt', 'keyId', 'publicKey', 'signature']);
    expect(await OneTimePreKeyModel.countDocuments({ deviceId: s.deviceId, consumedAt: null })).toBe(100);
  });

  it('lần đăng ký đầu thiếu oneTimePreKeys → 400; xoay signed prekey (không gửi prekey) giữ số prekey', async () => {
    const alice = await person('alice');
    const s = await login(server, alice.email);
    const first = deviceKeys(0);
    expect((await putKeys(s, first)).status).toBe(400);

    const full = deviceKeys(10);
    expect((await putKeys(s, full)).status).toBe(200);
    const rotated = {
      registrationId: full.registrationId,
      identityKey: full.identityKey,
      signedPreKey: { keyId: 2, publicKey: pubKey(), signature: signature() },
    };
    const res = await putKeys(s, rotated);
    expect(res.status).toBe(200);
    expect((res.body as DeviceKeysResponse).oneTimePreKeyCount).toBe(10);
    const doc = await UserDeviceModel.findOne({ deviceId: s.deviceId }).lean<{ signedPreKey: { keyId: number } }>();
    expect(doc?.signedPreKey.keyId).toBe(2);
  });

  it('TC-E2EE-006 đăng ký lại cùng deviceId với identity mới (IndexedDB bị xóa) → ghi đè, xóa prekey cũ, giữ signalDeviceId', async () => {
    const bob = await person('bob');
    await device(bob);
    const y = await device(bob);
    const before = await UserDeviceModel.findOne({ deviceId: y.deviceId }).lean();
    expect(before?.signalDeviceId).toBe(2);

    const fresh = deviceKeys(5, 1);
    const res = await putKeys(y.s, fresh);
    expect(res.status).toBe(200);
    expect(res.body as DeviceKeysResponse).toEqual({ deviceId: y.deviceId, signalDeviceId: 2, oneTimePreKeyCount: 5 });
    const after = await UserDeviceModel.findOne({ deviceId: y.deviceId }).lean();
    expect(after?.identityKey).toBe(fresh.identityKey);
    expect(await OneTimePreKeyModel.countDocuments({ deviceId: y.deviceId })).toBe(5);
  });

  it('TC-DB-017 device thứ 6 → 409 CONFLICT; đăng ký lại device REVOKED cùng deviceId được, giữ signalDeviceId', async () => {
    const bob = await person('bob');
    const devices = [];
    for (let i = 0; i < 5; i += 1) devices.push(await device(bob, 3));
    const sixth = await login(server, bob.email);
    const res = await putKeys(sixth, deviceKeys(3));
    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe('CONFLICT');
    expect(await UserDeviceModel.countDocuments({ userId: bob.id })).toBe(5);

    const [d1, d2] = devices;
    if (!d1 || !d2) throw new Error('thiếu device');
    expect((await api().delete(`/api/v1/e2ee/devices/${d2.deviceId}`).set(bearer(d1.s))).status).toBe(204);
    const again = await login(server, bob.email, d2.deviceId); // phiên mới trên device đã thu hồi
    const re = await putKeys(again, deviceKeys(3));
    expect(re.status, JSON.stringify(re.body)).toBe(200);
    expect((re.body as DeviceKeysResponse).signalDeviceId).toBe(2);
    expect((await putKeys(sixth, deviceKeys(3))).status).toBe(409); // lại đủ 5 ACTIVE
  });

  it('GET /e2ee/devices: isCurrent, userAgent của phiên gần nhất, số prekey, REVOKED có revokedAt', async () => {
    const bob = await person('bob');
    const y = await device(bob, 7);
    const z = await device(bob, 3);
    await api().delete(`/api/v1/e2ee/devices/${z.deviceId}`).set(bearer(y.s));
    const res = await api().get('/api/v1/e2ee/devices').set(bearer(y.s));
    expect(res.status).toBe(200);
    const items = (res.body as DeviceList).items;
    expect(items.map((d) => [d.signalDeviceId, d.status, d.isCurrent, d.oneTimePreKeyCount])).toEqual([
      [1, 'ACTIVE', true, 7],
      [2, 'REVOKED', false, 0],
    ]);
    expect(items[1]?.revokedAt).not.toBeNull();
    expect(typeof items[0]?.userAgent).toBe('string');
  });
});

describe('FR-E2EE-002 cấp prekey bundle', () => {
  it('TC-DB-016 consumeOneTimePreKey song song 50 lần trên 30 prekey → 30 khóa khác nhau, 20 null', async () => {
    const bob = await person('bob');
    const y = await device(bob, 30);
    const consumer = new Types.ObjectId().toHexString();
    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        e2eeRepository.consumeOneTimePreKey(new Types.ObjectId(bob.id), y.deviceId, consumer),
      ),
    );
    const got = results.filter((r) => r !== null).map((r) => r.keyId);
    expect(got).toHaveLength(30);
    expect(new Set(got).size).toBe(30);
    expect(results.filter((r) => r === null)).toHaveLength(20);
    expect(await OneTimePreKeyModel.countDocuments({ deviceId: y.deviceId, consumedAt: { $ne: null } })).toBe(30);
  });

  it('TC-AC-111 bundles cho mọi device ACTIVE; mỗi prekey cấp một lần (consumedAt) và không bao giờ cấp lại', async () => {
    const [alice, bob] = [await person('alice'), await person('bob')];
    const x = await device(alice);
    const y = await device(bob);
    const z = await device(bob);
    await createSecret(x.s, bob.id);

    const first = await bundlesOf(x.s, bob.id);
    expect(first.map((b) => b.deviceId).sort()).toEqual([y.deviceId, z.deviceId].sort());
    expect(first.map((b) => b.signalDeviceId).sort()).toEqual([1, 2]);
    const second = await bundlesOf(x.s, bob.id);
    const issued = [...first, ...second].map((b) => `${b.deviceId}:${String(b.oneTimePreKey?.keyId)}`);
    expect(new Set(issued).size).toBe(4);
    for (const b of first) {
      const doc = await OneTimePreKeyModel.findOne({ deviceId: b.deviceId, keyId: b.oneTimePreKey?.keyId }).lean<{
        consumedAt: Date | null;
        consumedBy: Types.ObjectId | null;
      }>();
      expect(doc?.consumedAt).toBeInstanceOf(Date);
      expect(doc?.consumedBy?.toHexString()).toBe(alice.id);
    }
    // Chính mình: chỉ device khác device hiện tại; alice chỉ có X → không có device nào → 422.
    const self = await getBundles(x.s, alice.id);
    expect(self.status).toBe(422);
    expect(errorOf(self).code).toBe('E2EE_KEYS_UNAVAILABLE');
  });

  it('quyền P24: không có chung SECRET → 404; bị chặn → 403 USER_BLOCKED; quá 10 lần/phút → 429', async () => {
    const [alice, bob] = [await person('alice'), await person('bob')];
    const x = await device(alice);
    await device(bob);
    const none = await getBundles(x.s, bob.id);
    expect(none.status).toBe(404);
    expect(errorOf(none).code).toBe('NOT_FOUND');

    await createSecret(x.s, bob.id);
    for (let i = 0; i < 8; i += 1) expect((await getBundles(x.s, bob.id)).status).toBe(200); // lần 2..9
    await api().post(`/api/v1/users/${bob.id}/block`).set(bearer(x.s));
    const blocked = await getBundles(x.s, bob.id);
    expect(blocked.status).toBe(403);
    expect(errorOf(blocked).code).toBe('USER_BLOCKED');
    expect((await getBundles(x.s, bob.id)).status).toBe(429); // lần thứ 11 cùng user+target
  });

  it('TC-AC-116 TC-E2EE-002 hết one-time prekey → oneTimePreKey null (X3DH vẫn chạy)', async () => {
    const [alice, bob] = [await person('alice'), await person('bob')];
    const x = await device(alice);
    await device(bob, 1);
    await createSecret(x.s, bob.id);
    expect((await bundlesOf(x.s, bob.id))[0]?.oneTimePreKey).not.toBeNull();
    const [empty] = await bundlesOf(x.s, bob.id);
    expect(empty?.oneTimePreKey).toBeNull();
    expect(empty?.signedPreKey.signature).toHaveLength(88);
  });
});

describe('FR-E2EE-003 bổ sung prekey', () => {
  it('TC-AC-115 còn 20 → lấy bundle còn 19 → e2ee:prekeys-low {remaining:19} đúng một lần; upload 100 → 119', async () => {
    const [alice, bob] = [await person('alice'), await person('bob')];
    const x = await device(alice);
    const y = await device(bob, 20);
    await createSecret(x.s, bob.id);
    const low = collect<{ deviceId: string; remaining: number }>(y.sock, EVENTS.E2EE_PREKEYS_LOW);
    await bundlesOf(x.s, bob.id);
    await sleep(200);
    expect(low.map((e) => [e.deviceId, e.remaining])).toEqual([[y.deviceId, 19]]);
    expect(await server.redis.client.ttl(keys.e2eeLowSent(y.deviceId))).toBeGreaterThan(
      E2EE_PREKEYS_LOW_NOTIFY_COOLDOWN_S - 10,
    );

    const up = await api()
      .post(`/api/v1/e2ee/devices/${y.deviceId}/prekeys`)
      .set(bearer(y.s))
      .send({ oneTimePreKeys: preKeys(100, 101) });
    expect(up.status).toBe(200);
    expect(up.body).toEqual({ oneTimePreKeyCount: 119 });

    // Trong cooldown 1 h: lại xuống dưới ngưỡng cũng không phát lần hai.
    await OneTimePreKeyModel.updateMany({ deviceId: y.deviceId, keyId: { $gt: 20 } }, { consumedAt: new Date() });
    await bundlesOf(x.s, bob.id);
    await sleep(200);
    expect(low).toHaveLength(1);
  });

  it('upload trùng keyId → 409, không thêm khóa nào; device khác did → 403', async () => {
    const bob = await person('bob');
    const y = await device(bob, 5);
    const dup = await api()
      .post(`/api/v1/e2ee/devices/${y.deviceId}/prekeys`)
      .set(bearer(y.s))
      .send({ oneTimePreKeys: [...preKeys(3, 50), { keyId: 5, publicKey: pubKey() }] });
    expect(dup.status).toBe(409);
    expect(errorOf(dup).code).toBe('CONFLICT');
    expect(await OneTimePreKeyModel.countDocuments({ deviceId: y.deviceId })).toBe(5);
    const other = await api()
      .post(`/api/v1/e2ee/devices/${randomUUID()}/prekeys`)
      .set(bearer(y.s))
      .send({ oneTimePreKeys: preKeys(1, 200) });
    expect(other.status).toBe(403);
  });
});

describe('FR-E2EE-004 gửi/nhận fan-out theo thiết bị', () => {
  it('TC-AC-112 tạo SECRET với người chưa có device ACTIVE → 422, không tạo hội thoại', async () => {
    const [alice, frank] = [await person('alice'), await person('frank')];
    const x = await device(alice);
    const res = await api()
      .post('/api/v1/conversations')
      .set(bearer(x.s))
      .set('Idempotency-Key', randomUUID())
      .send({ type: 'SECRET', memberIds: [frank.id] });
    expect(res.status).toBe(422);
    expect(errorOf(res).code).toBe('E2EE_KEYS_UNAVAILABLE');
    expect(await testDb.countSecretConversations()).toBe(0);
  });

  it('TC-AC-111 envelope 2 recipient: Y, Z chỉ nhận phần của mình; X nhận recipients rỗng; lưu nguyên, không contentEnc', async () => {
    const [alice, bob] = [await person('alice'), await person('bob')];
    const x = await device(alice);
    const y = await device(bob);
    const z = await device(bob);
    const convId = await createSecret(x.s, bob.id);
    const gotY = waitFor<{ message: Message }>(y.sock, EVENTS.MESSAGE_NEW);
    const gotZ = waitFor<{ message: Message }>(z.sock, EVENTS.MESSAGE_NEW);
    const gotX = waitFor<{ message: Message }>(x.sock, EVENTS.MESSAGE_NEW);
    const env = envelope(x.deviceId, [y.deviceId, z.deviceId]);
    const ack = await sendSecret(x.sock, convId, env);
    if (!ack.ok) throw new Error(JSON.stringify(ack));
    expect(ack.data.message.ciphertext).toEqual({ v: 1, senderDeviceId: x.deviceId, recipients: [] });
    expect(ack.data.message.content).toBeNull();

    const [my, mz, mx] = await Promise.all([gotY, gotZ, gotX]);
    expect(my.message.ciphertext?.recipients).toEqual([env.recipients[0]]);
    expect(mz.message.ciphertext?.recipients).toEqual([env.recipients[1]]);
    expect(mx.message.ciphertext?.recipients).toEqual([]);
    expect(my.message.senderDeviceId).toBe(x.deviceId);

    const doc = await testDb.findMessageRaw(ack.data.message.id);
    expect(doc?.contentEnc).toBeNull();
    expect(doc?.ciphertext?.recipients).toHaveLength(2);
  });

  it('TC-AC-118 TC-E2EE-007 lịch sử: device có recipient thấy phần của mình; device mới W thấy recipients rỗng', async () => {
    const [alice, bob] = [await person('alice'), await person('bob')];
    const x = await device(alice);
    const y = await device(bob);
    const convId = await createSecret(x.s, bob.id);
    for (let i = 0; i < 10; i += 1) {
      const ack = await sendSecret(x.sock, convId, envelope(x.deviceId, [y.deviceId], i === 0 ? 3 : 1));
      expect(ack.ok).toBe(true);
    }
    const w = await device(bob, 0); // đăng nhập device mới, chưa đăng ký khóa
    const history = async (s: Session) =>
      ((await api().get(`/api/v1/conversations/${convId}/messages`).set(bearer(s))).body as MessagePage).items;
    const forY = await history(y.s);
    expect(forY).toHaveLength(10);
    expect(forY.every((m) => m.ciphertext?.recipients.length === 1)).toBe(true);
    expect(forY.map((m) => m.ciphertext?.recipients[0]?.type)).toEqual([3, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const forW = await history(w.s);
    expect(forW).toHaveLength(10);
    expect(forW.every((m) => m.ciphertext?.recipients.length === 0)).toBe(true);
  });

  it('TC-AC-119 TC-MSG-016 kind E2EE có content / PLAINTEXT vào SECRET / E2EE vào DIRECT → VALIDATION_ERROR', async () => {
    const [alice, bob] = [await person('alice'), await person('bob')];
    const x = await device(alice);
    const y = await device(bob);
    const convId = await createSecret(x.s, bob.id);
    const withContent = await emitAck(x.sock, EVENTS.MESSAGE_SEND, {
      kind: 'E2EE',
      conversationId: convId,
      clientMessageId: randomUUID(),
      ciphertext: envelope(x.deviceId, [y.deviceId]),
      content: 'lộ',
    });
    const plain = await emitAck(x.sock, EVENTS.MESSAGE_SEND, {
      kind: 'PLAINTEXT',
      conversationId: convId,
      clientMessageId: randomUUID(),
      content: 'chào',
    });
    const direct = await api()
      .post('/api/v1/conversations')
      .set(bearer(x.s))
      .set('Idempotency-Key', randomUUID())
      .send({ type: 'DIRECT', memberIds: [bob.id] });
    const directId = (direct.body as CreateConversationResponse).conversation.id;
    const e2eeInDirect = await sendSecret(x.sock, directId, envelope(x.deviceId, [y.deviceId]));
    for (const ack of [withContent, plain, e2eeInDirect]) {
      expect(ack.ok ? null : ack.error.code).toBe('VALIDATION_ERROR');
    }
    expect(await testDb.countAllMessages()).toBe(0);
  });

  it('TC-AC-121 TC-E2EE-008 bob đăng ký device V sau khi alice lấy bundle → envelope thiếu V: CONFLICT; gửi lại có V: ok', async () => {
    const [alice, bob] = [await person('alice'), await person('bob')];
    const x = await device(alice);
    const y = await device(bob);
    const convId = await createSecret(x.s, bob.id);
    await bundlesOf(x.s, bob.id);
    const v = await device(bob);
    const clientMessageId = randomUUID();
    const stale = await sendSecret(x.sock, convId, envelope(x.deviceId, [y.deviceId]), clientMessageId);
    expect(stale.ok ? null : stale.error.code).toBe('CONFLICT');
    const extra = await sendSecret(x.sock, convId, envelope(x.deviceId, [y.deviceId, v.deviceId, randomUUID()]));
    expect(extra.ok ? null : extra.error.code).toBe('CONFLICT'); // thừa cũng lệch
    const retry = await sendSecret(x.sock, convId, envelope(x.deviceId, [y.deviceId, v.deviceId]), clientMessageId);
    expect(retry.ok).toBe(true);
    expect(await testDb.countAllMessages()).toBe(1);
  });

  it('recipients phải gồm device ACTIVE khác của người gửi; senderDeviceId ≠ device của token → FORBIDDEN', async () => {
    const [alice, bob] = [await person('alice'), await person('bob')];
    const x = await device(alice);
    const x2 = await device(alice);
    const y = await device(bob);
    const convId = await createSecret(x.s, bob.id);
    const missingOwn = await sendSecret(x.sock, convId, envelope(x.deviceId, [y.deviceId]));
    expect(missingOwn.ok ? null : missingOwn.error.code).toBe('CONFLICT');
    const spoofed = await sendSecret(x.sock, convId, envelope(x2.deviceId, [y.deviceId, x.deviceId]));
    expect(spoofed.ok ? null : spoofed.error.code).toBe('FORBIDDEN');
    const got = waitFor<{ message: Message }>(x2.sock, EVENTS.MESSAGE_NEW);
    const env = envelope(x.deviceId, [y.deviceId, x2.deviceId]);
    expect((await sendSecret(x.sock, convId, env)).ok).toBe(true);
    expect((await got).message.ciphertext?.recipients).toEqual([env.recipients[1]]);
  });

  it('device gửi chưa đăng ký khóa → FORBIDDEN; peer không còn device ACTIVE → E2EE_KEYS_UNAVAILABLE', async () => {
    const [alice, bob] = [await person('alice'), await person('bob')];
    const x = await device(alice);
    const y = await device(bob);
    const convId = await createSecret(x.s, bob.id);
    const unregistered = await device(alice, 0);
    const res = await sendSecret(unregistered.sock, convId, envelope(unregistered.deviceId, [y.deviceId, x.deviceId]));
    expect(res.ok ? null : res.error.code).toBe('FORBIDDEN');
    await api().delete(`/api/v1/e2ee/devices/${y.deviceId}`).set(bearer(y.s));
    const gone = await sendSecret(x.sock, convId, envelope(x.deviceId, [y.deviceId]));
    expect(gone.ok ? null : gone.error.code).toBe('E2EE_KEYS_UNAVAILABLE');
  });
});

describe('FR-E2EE-007 thu hồi thiết bị', () => {
  it('TC-AC-117 TC-E2EE-005 thu hồi Z từ Y: Z bị đăng xuất DEVICE_REVOKED; tin tiếp theo CONFLICT rồi gửi chỉ cho Y; gửi từ Z → FORBIDDEN', async () => {
    const [alice, bob] = [await person('alice'), await person('bob')];
    const x = await device(alice);
    const y = await device(bob);
    const z = await device(bob);
    const convId = await createSecret(x.s, bob.id);
    const revoked = waitFor<{ reason: string }>(z.sock, EVENTS.SESSION_REVOKED);

    const res = await api().delete(`/api/v1/e2ee/devices/${z.deviceId}`).set(bearer(y.s));
    expect(res.status).toBe(204);
    expect((await revoked).reason).toBe('DEVICE_REVOKED');
    expect(await OneTimePreKeyModel.countDocuments({ deviceId: z.deviceId })).toBe(0);
    expect((await UserDeviceModel.findOne({ deviceId: z.deviceId }).lean())?.status).toBe('REVOKED');
    expect((await api().get('/api/v1/e2ee/devices').set(bearer(z.s))).status).toBe(401); // phiên Z đã bị thu hồi
    expect((await api().delete(`/api/v1/e2ee/devices/${z.deviceId}`).set(bearer(y.s))).status).toBe(204); // idempotent

    const stale = await sendSecret(x.sock, convId, envelope(x.deviceId, [y.deviceId, z.deviceId]));
    expect(stale.ok ? null : stale.error.code).toBe('CONFLICT');
    expect((await bundlesOf(x.s, bob.id)).map((b) => b.deviceId)).toEqual([y.deviceId]);
    expect((await sendSecret(x.sock, convId, envelope(x.deviceId, [y.deviceId]))).ok).toBe(true);

    // Giả lập tin gửi từ Z (socket Z đã bị ngắt) — gọi thẳng service với auth của Z.
    await expect(
      server.runtime.messages.send(
        { userId: bob.id, deviceId: z.deviceId },
        {
          kind: 'E2EE',
          conversationId: convId,
          clientMessageId: randomUUID(),
          ciphertext: envelope(z.deviceId, [x.deviceId, y.deviceId]),
        },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('thu hồi device không thuộc mình hoặc không tồn tại → 404 giống hệt nhau (FR-SEC-008)', async () => {
    const [alice, bob] = [await person('alice'), await person('bob')];
    const x = await device(alice);
    const y = await device(bob);
    const notMine = await api().delete(`/api/v1/e2ee/devices/${y.deviceId}`).set(bearer(x.s));
    const missing = await api().delete(`/api/v1/e2ee/devices/${randomUUID()}`).set(bearer(x.s));
    expect([notMine.status, missing.status]).toEqual([404, 404]);
    expect(errorOf(notMine).message).toBe(errorOf(missing).message);
    expect((await UserDeviceModel.findOne({ deviceId: y.deviceId }).lean())?.status).toBe('ACTIVE');
  });
});

describe('FR-CHAT-007/008 phần SECRET', () => {
  it('TC-MSG-017 sửa tin SECRET → FORBIDDEN; thu hồi được: ciphertext bị xóa', async () => {
    const [alice, bob] = [await person('alice'), await person('bob')];
    const x = await device(alice);
    const y = await device(bob);
    const convId = await createSecret(x.s, bob.id);
    const ack = await sendSecret(x.sock, convId, envelope(x.deviceId, [y.deviceId]));
    if (!ack.ok) throw new Error(JSON.stringify(ack));
    const id = ack.data.message.id;
    const edit = await emitAck(x.sock, EVENTS.MESSAGE_EDIT, { messageId: id, content: 'sửa' });
    expect(edit.ok ? null : edit.error.code).toBe('FORBIDDEN');
    const del = await emitAck<{ message: Message }>(x.sock, EVENTS.MESSAGE_DELETE, { messageId: id });
    if (!del.ok) throw new Error(JSON.stringify(del));
    expect(del.data.message.deletedAt).not.toBeNull();
    expect(del.data.message.ciphertext).toBeNull();
    expect((await testDb.findMessageRaw(id))?.ciphertext).toBeNull();
  });
});
