// client/src/lib/e2ee/signal-adapter.ts — cô lập thư viện D-12 (@privacyresearch/libsignal-protocol-typescript, ghim
// 0.0.16; review mã nguồn: docs/SIGNAL_LIBRARY_REVIEW.md). Chỉ file này import thư viện, và chỉ bằng import() động →
// thư viện nằm ở chunk riêng, không vào bundle khởi tạo (NFR-05). Mọi thao tác mật mã chạy tuần tự qua một hàng đợi để
// ratchet của cùng một session không bị ghi đè khi hai tin đến cùng lúc.
import type { PreKeyBundle } from '@hustalo/shared';
import type { KeyPairType } from '@privacyresearch/libsignal-protocol-typescript';
import { b64ToBinary, b64ToBuffer, binaryToB64, bufferToB64, bufferToText, textToBuffer } from './codec';
import type { SignalStore } from './signal-store';

type SignalLib = typeof import('@privacyresearch/libsignal-protocol-typescript');

/**
 * Cảnh báo của thư viện kèm dữ liệu nhạy cảm: `session-cipher.js` in cả object session (root key, chain key) khi
 * "no chain found for key"; `curve.js` in khóa công khai sai định dạng. Không để chúng ra console (docs/SIGNAL_LIBRARY_REVIEW.md).
 */
const LIBRARY_WARNINGS = ['no chain found for key', 'Invalid public key'];

export function isLibraryWarning(args: readonly unknown[]): boolean {
  const first = args[0];
  return typeof first === 'string' && LIBRARY_WARNINGS.some((w) => first.startsWith(w));
}

function muteLibraryWarnings(): void {
  /* eslint-disable no-console -- bọc console.warn để lọc cảnh báo chứa khóa của thư viện D-12, không tự log gì */
  const warn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    if (!isLibraryWarning(args)) warn(...args);
  };
  /* eslint-enable no-console */
}

let lib: Promise<SignalLib> | null = null;
export const loadSignal = (): Promise<SignalLib> =>
  (lib ??= import('@privacyresearch/libsignal-protocol-typescript').then((m) => {
    muteLibraryWarnings();
    return m;
  }));

/** Số vòng SHA-512 của safety number (NumericFingerprint của Signal). */
const FINGERPRINT_ITERATIONS = 5200;

let queue: Promise<unknown> = Promise.resolve();
/** Chạy `fn` sau mọi thao tác mật mã trước đó (lỗi của thao tác trước không chặn thao tác sau). */
export function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

/** Địa chỉ Signal `(userId, signalDeviceId)` (DB §2.9). */
export const addressOf = (userId: string, signalDeviceId: number) => `${userId}.${String(signalDeviceId)}`;

export interface PublicPreKey {
  keyId: number;
  publicKey: string;
}

export async function generateIdentity(): Promise<{ identityKeyPair: KeyPairType; registrationId: number }> {
  const { KeyHelper } = await loadSignal();
  return {
    identityKeyPair: await KeyHelper.generateIdentityKeyPair(),
    registrationId: KeyHelper.generateRegistrationId(),
  };
}

/** `count` one-time prekey keyId `startId…`; trả cặp khóa (lưu IndexedDB) và phần công khai (gửi server). */
export async function generatePreKeys(startId: number, count: number) {
  const { KeyHelper } = await loadSignal();
  const pairs = await Promise.all(Array.from({ length: count }, (_, i) => KeyHelper.generatePreKey(startId + i)));
  return pairs.map((p) => ({ keyId: p.keyId, keyPair: p.keyPair, publicKey: bufferToB64(p.keyPair.pubKey) }));
}

export async function generateSignedPreKey(identityKeyPair: KeyPairType, keyId: number) {
  const { KeyHelper } = await loadSignal();
  const spk = await KeyHelper.generateSignedPreKey(identityKeyPair, keyId);
  return {
    keyId,
    keyPair: spk.keyPair,
    signature: spk.signature,
    publicKey: bufferToB64(spk.keyPair.pubKey),
    signatureB64: bufferToB64(spk.signature),
  };
}

/** X3DH phía gửi (SessionBuilder.processPreKey — thư viện verify chữ ký signed prekey; sai → throw). */
export function processBundle(store: SignalStore, bundle: PreKeyBundle): Promise<void> {
  return serial(async () => {
    const { SessionBuilder, SignalProtocolAddress } = await loadSignal();
    const builder = new SessionBuilder(store, new SignalProtocolAddress(bundle.userId, bundle.signalDeviceId));
    await builder.processPreKey({
      identityKey: b64ToBuffer(bundle.identityKey),
      registrationId: bundle.registrationId,
      signedPreKey: {
        keyId: bundle.signedPreKey.keyId,
        publicKey: b64ToBuffer(bundle.signedPreKey.publicKey),
        signature: b64ToBuffer(bundle.signedPreKey.signature),
      },
      ...(bundle.oneTimePreKey
        ? { preKey: { keyId: bundle.oneTimePreKey.keyId, publicKey: b64ToBuffer(bundle.oneTimePreKey.publicKey) } }
        : {}),
    });
  });
}

export async function hasSession(store: SignalStore, address: string): Promise<boolean> {
  const { SessionCipher } = await loadSignal();
  return new SessionCipher(store, address).hasOpenSession();
}

export function encryptFor(
  store: SignalStore,
  address: string,
  plaintext: string,
): Promise<{ type: 1 | 3; body: string }> {
  return serial(async () => {
    const { SessionCipher } = await loadSignal();
    const out = await new SessionCipher(store, address).encrypt(textToBuffer(plaintext));
    if ((out.type !== 1 && out.type !== 3) || out.body === undefined) throw new Error('Kết quả mã hóa không hợp lệ');
    return { type: out.type, body: binaryToB64(out.body) };
  });
}

/** Giải mã một recipient; lỗi (MAC sai, không có session, tin lặp) → throw (E2EE_DECRYPT_FAILED, EC-E2EE-004). */
export function decryptFrom(store: SignalStore, address: string, type: 1 | 3, body: string): Promise<string> {
  return serial(async () => {
    const { SessionCipher } = await loadSignal();
    const cipher = new SessionCipher(store, address);
    const binary = b64ToBinary(body);
    const plain =
      type === 3
        ? await cipher.decryptPreKeyWhisperMessage(binary, 'binary')
        : await cipher.decryptWhisperMessage(binary, 'binary');
    return bufferToText(plain);
  });
}

/** Một nửa safety number (30 chữ số) cho (identifier, identity key) — NumericFingerprint v0 của Signal. */
async function displayStringFor(identifier: string, key: Uint8Array, iterations: number): Promise<string> {
  const id = Uint8Array.from(identifier, (ch) => {
    const code = ch.charCodeAt(0);
    if (code > 0xff) throw new RangeError('identifier phải là chuỗi một byte');
    return code;
  });
  // version (uint16 little-endian, = 0) ‖ key ‖ identifier; mỗi vòng: hash = SHA-512(hash ‖ key)
  let data: Uint8Array = new Uint8Array([0, 0, ...key, ...id]);
  for (let i = 0; i < iterations; i += 1) {
    const input = new Uint8Array(data.length + key.length);
    input.set(data);
    input.set(key, data.length);
    data = new Uint8Array(await crypto.subtle.digest('SHA-512', input));
  }
  let out = '';
  for (let offset = 0; offset < 30; offset += 5) {
    const b = data.subarray(offset, offset + 5);
    const chunk =
      ((b[0] ?? 0) * 2 ** 32 + (b[1] ?? 0) * 2 ** 24 + (b[2] ?? 0) * 2 ** 16 + (b[3] ?? 0) * 2 ** 8 + (b[4] ?? 0)) %
      100000;
    out += String(chunk).padStart(5, '0');
  }
  return out;
}

/**
 * Safety number 60 chữ số của cặp (mình, device peer) — hai bên ra cùng chuỗi (FR-E2EE-005). Cùng thuật toán với
 * FingerprintGenerator của thư viện D-12 (NumericFingerprint v0, SHA-512 lặp 5200 vòng; unit test so khớp từng chữ số)
 * nhưng dùng WebCrypto gốc: bản msrcrypto (JS thuần) của thư viện mất hàng chục giây trên trình duyệt.
 */
export async function fingerprint(
  localUserId: string,
  localIdentityKey: string,
  remoteUserId: string,
  remoteIdentityKey: string,
): Promise<string> {
  const [local, remote] = await Promise.all([
    displayStringFor(localUserId, new Uint8Array(b64ToBuffer(localIdentityKey)), FINGERPRINT_ITERATIONS),
    displayStringFor(remoteUserId, new Uint8Array(b64ToBuffer(remoteIdentityKey)), FINGERPRINT_ITERATIONS),
  ]);
  return [local, remote].sort().join('');
}

/** Bản của thư viện (chậm) — chỉ để test đối chiếu. */
export async function libraryFingerprint(
  localUserId: string,
  localIdentityKey: string,
  remoteUserId: string,
  remoteIdentityKey: string,
): Promise<string> {
  const { FingerprintGenerator } = await loadSignal();
  return new FingerprintGenerator(FINGERPRINT_ITERATIONS).createFor(
    localUserId,
    b64ToBuffer(localIdentityKey),
    remoteUserId,
    b64ToBuffer(remoteIdentityKey),
  );
}
