// client/src/lib/e2ee/signal-store.ts — IndexedDB `hustalo-signal-{userId}` (kiến trúc §9.3): khóa riêng, prekey,
// signed prekey, session, identity đã biết của từng device peer, và bản rõ tin SECRET (store `messages`). Không bao giờ
// gửi gì trong DB này lên server (TB-8).
//
// Thư viện D-12 gọi `isTrustedIdentity(name)` chỉ với tên người dùng (không có device), trong khi mỗi device có identity
// riêng. Vì vậy store luôn trả `true` ở đó và ứng dụng tự kiểm tra identity theo từng device trước khi gửi (useSecretSession,
// kiến trúc §7(h)); `saveIdentity(address)` nhận địa chỉ đầy đủ `{userId}.{signalDeviceId}` và đánh dấu `changed` khi khóa
// khác bản đã biết (FR-E2EE-006).
//
// Khóa lưu dạng base64 và đổi lại thành ArrayBuffer mới khi đọc: thư viện kiểm `instanceof ArrayBuffer`, còn ArrayBuffer
// structured-clone từ IndexedDB có thể thuộc realm khác (worker, iframe, môi trường test).
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { KeyPairType, SessionRecordType, StorageType } from '@privacyresearch/libsignal-protocol-typescript';
import { b64ToBuffer, bufferToB64 } from './codec';

/** Identity đã biết của một device peer (địa chỉ Signal `{userId}.{signalDeviceId}`). */
export interface KnownIdentity {
  address: string;
  userId: string;
  /** UUID device (`hustalo.deviceId`) — ánh xạ `senderDeviceId` của envelope sang địa chỉ Signal; null khi chưa biết. */
  deviceId: string | null;
  identityKey: string; // base64
  /** Người dùng đã bấm "Đánh dấu đã xác minh" cho đúng khóa này (FR-E2EE-005). */
  verified: boolean;
  /** Khóa vừa đổi so với bản trước, chưa được "Chấp nhận" (FR-E2EE-006). */
  changed: boolean;
  /** Bản cũ đã verified trước khi đổi → chặn gửi tới khi chấp nhận. */
  wasVerified: boolean;
}

/** Cặp khóa dạng lưu trữ (base64). */
interface StoredKeyPair {
  pub: string;
  priv: string;
}
const toStored = (k: KeyPairType): StoredKeyPair => ({ pub: bufferToB64(k.pubKey), priv: bufferToB64(k.privKey) });
const fromStored = (k: StoredKeyPair): KeyPairType => ({ pubKey: b64ToBuffer(k.pub), privKey: b64ToBuffer(k.priv) });

export interface LocalMeta {
  identityKeyPair: KeyPairType;
  registrationId: number;
  /** keyId one-time prekey tiếp theo (keyId tiếp nối, FR-E2EE-003). */
  nextPreKeyId: number;
  signedPreKeyId: number;
  signedPreKeyCreatedAt: number;
}

export interface SignedPreKeyRow {
  keyId: number;
  keyPair: KeyPairType;
  signature: ArrayBuffer;
  createdAt: number;
}

type StoredMeta = Omit<LocalMeta, 'identityKeyPair'> & { identityKeyPair: StoredKeyPair };
interface StoredSignedPreKey {
  keyId: number;
  keyPair: StoredKeyPair;
  signature: string;
  createdAt: number;
}

interface SignalDb extends DBSchema {
  meta: { key: string; value: StoredMeta };
  preKeys: { key: number; value: { keyId: number; keyPair: StoredKeyPair } };
  signedPreKeys: { key: number; value: StoredSignedPreKey };
  sessions: { key: string; value: { address: string; record: SessionRecordType } };
  identities: { key: string; value: KnownIdentity; indexes: { userId: string; deviceId: string } };
  messages: { key: string; value: { key: string; text: string } };
}

const META_KEY = 'local';
export const signalDbName = (userId: string) => `hustalo-signal-${userId}`;

const userOf = (address: string) => address.slice(0, address.lastIndexOf('.'));
const asNumber = (id: number | string) => (typeof id === 'number' ? id : Number(id));

export class SignalStore implements StorageType {
  private constructor(
    private readonly db: IDBPDatabase<SignalDb>,
    readonly userId: string,
  ) {}

  static async open(userId: string): Promise<SignalStore> {
    const db = await openDB<SignalDb>(signalDbName(userId), 1, {
      upgrade(d) {
        d.createObjectStore('meta');
        d.createObjectStore('preKeys', { keyPath: 'keyId' });
        d.createObjectStore('signedPreKeys', { keyPath: 'keyId' });
        d.createObjectStore('sessions', { keyPath: 'address' });
        const identities = d.createObjectStore('identities', { keyPath: 'address' });
        identities.createIndex('userId', 'userId');
        identities.createIndex('deviceId', 'deviceId');
        d.createObjectStore('messages', { keyPath: 'key' });
      },
    });
    return new SignalStore(db, userId);
  }

  close(): void {
    this.db.close();
  }

  // ---- khóa của device này ----
  async getMeta(): Promise<LocalMeta | undefined> {
    const m = await this.db.get('meta', META_KEY);
    return m ? { ...m, identityKeyPair: fromStored(m.identityKeyPair) } : undefined;
  }

  async setMeta(meta: LocalMeta): Promise<void> {
    await this.db.put('meta', { ...meta, identityKeyPair: toStored(meta.identityKeyPair) }, META_KEY);
  }

  /** Xóa toàn bộ khóa/session (đăng ký lại từ đầu). Không xóa identity đã biết và bản rõ. */
  async resetLocalKeys(): Promise<void> {
    const tx = this.db.transaction(['meta', 'preKeys', 'signedPreKeys', 'sessions'], 'readwrite');
    await Promise.all([
      tx.objectStore('meta').clear(),
      tx.objectStore('preKeys').clear(),
      tx.objectStore('signedPreKeys').clear(),
      tx.objectStore('sessions').clear(),
      tx.done,
    ]);
  }

  async storeSignedPreKeyRow(row: SignedPreKeyRow): Promise<void> {
    await this.db.put('signedPreKeys', {
      keyId: row.keyId,
      keyPair: toStored(row.keyPair),
      signature: bufferToB64(row.signature),
      createdAt: row.createdAt,
    });
  }

  async getSignedPreKeyRow(keyId: number): Promise<SignedPreKeyRow | undefined> {
    const r = await this.db.get('signedPreKeys', keyId);
    return r ? { ...r, keyPair: fromStored(r.keyPair), signature: b64ToBuffer(r.signature) } : undefined;
  }

  /** Giữ signed prekey cũ thêm một chu kỳ để giải mã PreKey message đến muộn (kiến trúc §9.3). */
  async pruneSignedPreKeys(keepIds: number[], olderThan: number): Promise<void> {
    for (const row of await this.db.getAll('signedPreKeys')) {
      if (!keepIds.includes(row.keyId) && row.createdAt < olderThan) await this.db.delete('signedPreKeys', row.keyId);
    }
  }

  countPreKeys = () => this.db.count('preKeys');

  // ---- StorageType (thư viện D-12) ----
  getIdentityKeyPair = async () => (await this.getMeta())?.identityKeyPair;

  getLocalRegistrationId = async () => (await this.getMeta())?.registrationId;

  isTrustedIdentity = () => Promise.resolve(true);

  async saveIdentity(encodedAddress: string, publicKey: ArrayBuffer): Promise<boolean> {
    const identityKey = bufferToB64(publicKey);
    const prev = await this.db.get('identities', encodedAddress);
    if (prev?.identityKey === identityKey) return false;
    await this.db.put('identities', {
      address: encodedAddress,
      userId: userOf(encodedAddress),
      deviceId: prev?.deviceId ?? null,
      identityKey,
      verified: false,
      changed: prev !== undefined,
      wasVerified: prev ? prev.verified || prev.wasVerified : false,
    });
    return prev !== undefined;
  }

  async loadPreKey(keyId: number | string): Promise<KeyPairType | undefined> {
    const r = await this.db.get('preKeys', asNumber(keyId));
    return r ? fromStored(r.keyPair) : undefined;
  }

  async storePreKey(keyId: number | string, keyPair: KeyPairType): Promise<void> {
    await this.db.put('preKeys', { keyId: asNumber(keyId), keyPair: toStored(keyPair) });
  }

  async removePreKey(keyId: number | string): Promise<void> {
    await this.db.delete('preKeys', asNumber(keyId));
  }

  async storeSession(encodedAddress: string, record: SessionRecordType): Promise<void> {
    await this.db.put('sessions', { address: encodedAddress, record });
  }

  loadSession = async (encodedAddress: string) => (await this.db.get('sessions', encodedAddress))?.record;

  async loadSignedPreKey(keyId: number | string): Promise<KeyPairType | undefined> {
    const r = await this.db.get('signedPreKeys', asNumber(keyId));
    return r ? fromStored(r.keyPair) : undefined;
  }

  async storeSignedPreKey(keyId: number | string, keyPair: KeyPairType): Promise<void> {
    const prev = await this.db.get('signedPreKeys', asNumber(keyId));
    await this.db.put('signedPreKeys', {
      keyId: asNumber(keyId),
      keyPair: toStored(keyPair),
      signature: prev?.signature ?? '',
      createdAt: prev?.createdAt ?? Date.now(),
    });
  }

  async removeSignedPreKey(keyId: number | string): Promise<void> {
    await this.db.delete('signedPreKeys', asNumber(keyId));
  }

  // ---- identity theo device (FR-E2EE-005/006) ----
  getIdentity = (address: string) => this.db.get('identities', address);

  identitiesOf = (userId: string) => this.db.getAllFromIndex('identities', 'userId', userId);

  identityByDevice = (deviceId: string) => this.db.getFromIndex('identities', 'deviceId', deviceId);

  /** Gắn UUID device vào identity (biết từ bundle); chưa có identity → tạo bản chưa xác minh. */
  async linkDevice(address: string, deviceId: string, identityKey: string): Promise<void> {
    const rec = await this.db.get('identities', address);
    if (rec) {
      if (rec.deviceId !== deviceId) await this.db.put('identities', { ...rec, deviceId });
      return;
    }
    await this.db.put('identities', {
      address,
      userId: userOf(address),
      deviceId,
      identityKey,
      verified: false,
      changed: false,
      wasVerified: false,
    });
  }

  async setVerified(address: string, verified: boolean): Promise<void> {
    const rec = await this.db.get('identities', address);
    if (rec) await this.db.put('identities', { ...rec, verified, changed: false, wasVerified: false });
  }

  /** "Chấp nhận" identity mới: cập nhật known identity, xóa `verified` (AC-113). */
  async acceptIdentity(address: string): Promise<void> {
    const rec = await this.db.get('identities', address);
    if (rec) await this.db.put('identities', { ...rec, verified: false, changed: false, wasVerified: false });
  }

  // ---- bản rõ tin SECRET (kiến trúc §9.3 "Bản rõ cục bộ") ----
  getPlaintext = async (key: string) => (await this.db.get('messages', key))?.text;

  async putPlaintext(key: string, text: string): Promise<void> {
    await this.db.put('messages', { key, text });
  }

  async deletePlaintext(key: string): Promise<void> {
    await this.db.delete('messages', key);
  }
}
