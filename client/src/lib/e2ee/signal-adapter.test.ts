// @vitest-environment node
// signal-adapter + signal-store với thư viện D-12 thật, hai device giả lập trong cùng process (fake-indexeddb):
// X3DH, Double Ratchet, sửa 1 byte → giải mã lỗi (TC-AC-114 phần U), không OTPK (EC-E2EE-002), safety number (FR-E2EE-005).
import type { PreKeyBundle } from '@hustalo/shared';
import { describe, expect, it } from 'vitest';
import { b64ToBuffer, bufferToB64 } from './codec';
import {
  addressOf,
  decryptFrom,
  encryptFor,
  fingerprint,
  generateIdentity,
  generatePreKeys,
  generateSignedPreKey,
  hasSession,
  processBundle,
} from './signal-adapter';
import { SignalStore } from './signal-store';

let seq = 0;
const userId = () => `6720a1b2c3d4e5f6012345${String(10 + (seq++ % 89))}`;

/** Device có khóa đầy đủ trong store + bundle công khai (như server trả). */
async function makeDevice(uid: string, signalDeviceId: number, withOtpk = true) {
  const store = await SignalStore.open(`${uid}-${String(signalDeviceId)}-${String(seq++)}`);
  const { identityKeyPair, registrationId } = await generateIdentity();
  const spk = await generateSignedPreKey(identityKeyPair, 1);
  const [otpk] = await generatePreKeys(1, 1);
  await store.setMeta({
    identityKeyPair,
    registrationId,
    nextPreKeyId: 2,
    signedPreKeyId: 1,
    signedPreKeyCreatedAt: 0,
  });
  await store.storeSignedPreKeyRow({ keyId: 1, keyPair: spk.keyPair, signature: spk.signature, createdAt: Date.now() });
  if (otpk) await store.storePreKey(otpk.keyId, otpk.keyPair);
  const bundle: PreKeyBundle = {
    userId: uid,
    deviceId: crypto.randomUUID(),
    signalDeviceId,
    registrationId,
    identityKey: bufferToB64(identityKeyPair.pubKey),
    signedPreKey: { keyId: 1, publicKey: spk.publicKey, signature: spk.signatureB64 },
    oneTimePreKey: withOtpk && otpk ? { keyId: otpk.keyId, publicKey: otpk.publicKey } : null,
  };
  return { uid, store, bundle, address: addressOf(uid, signalDeviceId) };
}

describe('Signal X3DH + Double Ratchet (FR-E2EE-004)', () => {
  it('khóa công khai đúng định dạng server: 33 byte (0x05) → 44 ký tự; chữ ký 64 byte → 88 ký tự', async () => {
    const { bundle } = await makeDevice(userId(), 1);
    expect(bundle.identityKey).toHaveLength(44);
    expect(new Uint8Array(b64ToBuffer(bundle.identityKey))[0]).toBe(5);
    expect(bundle.signedPreKey.publicKey).toHaveLength(44);
    expect(bundle.signedPreKey.signature).toMatch(/^[A-Za-z0-9+/]{86}==$/);
  });

  it('TC-AC-111 tin đầu type 3 (PREKEY), bên nhận giải mã và lập session; tin sau type 1; trả lời ngược lại được', async () => {
    const alice = await makeDevice(userId(), 1);
    const bob = await makeDevice(userId(), 1);
    await processBundle(alice.store, bob.bundle);
    expect(await hasSession(alice.store, bob.address)).toBe(true);

    const first = await encryptFor(alice.store, bob.address, 'chào');
    expect(first.type).toBe(3);
    expect(await decryptFrom(bob.store, alice.address, 3, first.body)).toBe('chào');
    expect(await hasSession(bob.store, alice.address)).toBe(true);

    const reply = await encryptFor(bob.store, alice.address, 'chào bạn 👋');
    expect(reply.type).toBe(1);
    expect(await decryptFrom(alice.store, bob.address, 1, reply.body)).toBe('chào bạn 👋');
    const next = await encryptFor(alice.store, bob.address, 'tin thứ hai');
    expect(next.type).toBe(1);
    expect(await decryptFrom(bob.store, alice.address, 1, next.body)).toBe('tin thứ hai');
  });

  it('TC-AC-116 bundle không có one-time prekey → vẫn thiết lập và giải mã được', async () => {
    const alice = await makeDevice(userId(), 1);
    const bob = await makeDevice(userId(), 1, false);
    await processBundle(alice.store, bob.bundle);
    const m = await encryptFor(alice.store, bob.address, 'không OTPK');
    expect(await decryptFrom(bob.store, alice.address, m.type, m.body)).toBe('không OTPK');
  });

  it('TC-AC-114 TC-E2EE-004 sửa 1 byte ciphertext → giải mã lỗi; tin sau đó vẫn giải mã được', async () => {
    const alice = await makeDevice(userId(), 1);
    const bob = await makeDevice(userId(), 1);
    await processBundle(alice.store, bob.bundle);
    const first = await encryptFor(alice.store, bob.address, 'một');
    await decryptFrom(bob.store, alice.address, first.type, first.body);

    // Chưa nhận trả lời → alice vẫn gửi PreKey message (type 3) cho tới khi bob trả lời.
    const second = await encryptFor(alice.store, bob.address, 'hai');
    const bytes = new Uint8Array(b64ToBuffer(second.body));
    bytes[bytes.length - 12] = (bytes[bytes.length - 12] ?? 0) ^ 0x01;
    await expect(decryptFrom(bob.store, alice.address, second.type, bufferToB64(bytes))).rejects.toThrow();

    const third = await encryptFor(alice.store, bob.address, 'ba');
    expect(await decryptFrom(bob.store, alice.address, third.type, third.body)).toBe('ba');
  });

  it('giải mã lại cùng một bản mã lần hai → lỗi (lý do phải lưu bản rõ cục bộ, kiến trúc §9.3)', async () => {
    const alice = await makeDevice(userId(), 1);
    const bob = await makeDevice(userId(), 1);
    await processBundle(alice.store, bob.bundle);
    const m = await encryptFor(alice.store, bob.address, 'một lần');
    await decryptFrom(bob.store, alice.address, m.type, m.body);
    await expect(decryptFrom(bob.store, alice.address, m.type, m.body)).rejects.toThrow();
  });

  it('chữ ký signed prekey sai → processBundle lỗi', async () => {
    const alice = await makeDevice(userId(), 1);
    const bob = await makeDevice(userId(), 1);
    const forged = { ...bob.bundle, signedPreKey: { ...bob.bundle.signedPreKey, signature: `${'A'.repeat(86)}==` } };
    await expect(processBundle(alice.store, forged)).rejects.toThrow();
  });
});

describe('safety number (FR-E2EE-005)', () => {
  it('TC-AC-120 hai bên ra cùng 60 chữ số; đổi identity → chuỗi khác', async () => {
    const a = await makeDevice(userId(), 1);
    const b = await makeDevice(userId(), 1);
    const fromA = await fingerprint(a.uid, a.bundle.identityKey, b.uid, b.bundle.identityKey);
    const fromB = await fingerprint(b.uid, b.bundle.identityKey, a.uid, a.bundle.identityKey);
    expect(fromA).toMatch(/^\d{60}$/);
    expect(fromA).toBe(fromB);
    const b2 = await makeDevice(b.uid, 1);
    expect(await fingerprint(a.uid, a.bundle.identityKey, b.uid, b2.bundle.identityKey)).not.toBe(fromA);
  });
});

describe('SignalStore identity theo device (FR-E2EE-006)', () => {
  it('saveIdentity lần đầu → không đổi; khóa khác → changed, wasVerified giữ cờ verified cũ; accept xóa verified', async () => {
    const store = await SignalStore.open(`identity-${String(seq++)}`);
    const uid = userId();
    const addr = addressOf(uid, 2);
    const k1 = (await generateIdentity()).identityKeyPair.pubKey;
    const k2 = (await generateIdentity()).identityKeyPair.pubKey;
    expect(await store.saveIdentity(addr, k1)).toBe(false);
    expect(await store.saveIdentity(addr, k1)).toBe(false);
    await store.setVerified(addr, true);
    expect(await store.saveIdentity(addr, k2)).toBe(true);
    expect(await store.getIdentity(addr)).toMatchObject({
      userId: uid,
      changed: true,
      wasVerified: true,
      verified: false,
    });
    await store.acceptIdentity(addr);
    expect(await store.getIdentity(addr)).toMatchObject({ changed: false, wasVerified: false, verified: false });
    expect((await store.identitiesOf(uid)).map((r) => r.address)).toEqual([addr]);
  });

  it('bản rõ cục bộ: put/get/delete', async () => {
    const store = await SignalStore.open(`plain-${String(seq++)}`);
    await store.putPlaintext('m:1', 'xin chào');
    expect(await store.getPlaintext('m:1')).toBe('xin chào');
    await store.deletePlaintext('m:1');
    expect(await store.getPlaintext('m:1')).toBeUndefined();
  });
});
