// server/src/infra/crypto/aes-gcm.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DATA_ENCRYPTION_VERSION } from '@hustalo/shared';
import { keyRing, type KeyRing } from './key-ring';

export interface EncryptedField {
  v: 1;
  keyId: string;
  iv: string;
  ct: string;
  tag: string;
}

/** `ring` mặc định là key ring từ env; job re-encrypt truyền ring riêng (kiến trúc §9.2.4). */
export function encryptField(plaintext: string, aad: string, ring: KeyRing = keyRing): EncryptedField {
  const { keyId, key } = ring.active();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    v: DATA_ENCRYPTION_VERSION,
    keyId,
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptField(field: EncryptedField, aad: string, ring: KeyRing = keyRing): string {
  // Dữ liệu đọc từ DB có thể mang phiên bản khác kiểu khai báo → kiểm tra ở runtime.
  const version = field.v as number;
  if (version !== DATA_ENCRYPTION_VERSION) throw new Error(`Unsupported contentEnc.v=${version}`);
  const key = ring.get(field.keyId); // throw nếu keyId không có trong key ring
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(field.iv, 'base64'), { authTagLength: 16 });
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(field.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(field.ct, 'base64')), decipher.final()]).toString('utf8');
}
