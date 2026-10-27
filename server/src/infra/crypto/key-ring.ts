// server/src/infra/crypto/key-ring.ts — parse + validate DATA_ENCRYPTION_KEYS / DATA_ENCRYPTION_ACTIVE_KEY_ID (kiến trúc §9.2.1)
// Lỗi chỉ nêu keyId / tên biến, KHÔNG bao giờ chứa giá trị key (AC-ARCH-004).
import { env } from '../../config/env';

const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const KEY_BYTES = 32;

export class KeyRingError extends Error {
  override name = 'KeyRingError';
}

export interface KeyRing {
  active(): { keyId: string; key: Buffer };
  get(keyId: string): Buffer;
  keyIds(): string[];
}

export function createKeyRing(keys: Record<string, unknown>, activeKeyId: string): KeyRing {
  const ring = new Map<string, Buffer>();
  for (const [keyId, value] of Object.entries(keys)) {
    if (!KEY_ID_PATTERN.test(keyId)) throw new KeyRingError(`DATA_ENCRYPTION_KEYS: keyId "${keyId}" không hợp lệ`);
    if (typeof value !== 'string' || !BASE64_PATTERN.test(value))
      throw new KeyRingError(`DATA_ENCRYPTION_KEYS.${keyId}: phải là chuỗi base64`);
    const key = Buffer.from(value, 'base64');
    if (key.length !== KEY_BYTES)
      throw new KeyRingError(`DATA_ENCRYPTION_KEYS.${keyId}: phải decode đúng ${KEY_BYTES} byte`);
    ring.set(keyId, key);
  }
  if (ring.size === 0) throw new KeyRingError('DATA_ENCRYPTION_KEYS: cần ít nhất một key');
  const activeKey = ring.get(activeKeyId);
  if (activeKey === undefined)
    throw new KeyRingError('DATA_ENCRYPTION_ACTIVE_KEY_ID: không có trong DATA_ENCRYPTION_KEYS');

  return {
    active: () => ({ keyId: activeKeyId, key: activeKey }),
    get: (keyId) => {
      const key = ring.get(keyId);
      if (key === undefined) throw new KeyRingError(`keyId "${keyId}" không có trong key ring`);
      return key;
    },
    keyIds: () => [...ring.keys()],
  };
}

let cached: KeyRing | undefined;

/** Key ring từ env, khởi tạo lần đầu dùng. main.ts gọi `keyRing.active()` lúc boot để fail-fast. */
export const keyRing: KeyRing = {
  active: () => load().active(),
  get: (keyId) => load().get(keyId),
  keyIds: () => load().keyIds(),
};

function load(): KeyRing {
  cached ??= createKeyRing(env.DATA_ENCRYPTION_KEYS, env.DATA_ENCRYPTION_ACTIVE_KEY_ID);
  return cached;
}
