import { describe, expect, it } from 'vitest';
import { decryptField, encryptField } from './aes-gcm';

const conversationId = '6720a1b2c3d4e5f601234561';
const messageId = '6720b1b2c3d4e5f601234501';
const aad = `${conversationId}:${messageId}`;

describe('AES-256-GCM contentEnc (kiến trúc §9.2)', () => {
  it('TC-AC-100 định dạng { v: 1, keyId, iv 12 byte (16 ký tự base64), ct, tag 16 byte } và không chứa plaintext', () => {
    const enc = encryptField('bí mật 123', aad);
    expect(enc.v).toBe(1);
    expect(enc.keyId).toBe('ktest1');
    expect(enc.iv).toHaveLength(16);
    expect(Buffer.from(enc.iv, 'base64')).toHaveLength(12);
    expect(Buffer.from(enc.tag, 'base64')).toHaveLength(16);
    expect(JSON.stringify(enc)).not.toContain('bí mật 123');
  });

  it('TC-AC-100 round-trip với đúng AAD', () => {
    expect(decryptField(encryptField('bí mật 123', aad), aad)).toBe('bí mật 123');
  });

  it('TC-AC-100 giải mã với AAD sai (đổi conversationId) ném lỗi', () => {
    const enc = encryptField('bí mật 123', aad);
    expect(() => decryptField(enc, `6720a1b2c3d4e5f601234562:${messageId}`)).toThrow();
  });

  it('IV mới cho mỗi lần mã hóa cùng nội dung', () => {
    expect(encryptField('x', aad).iv).not.toBe(encryptField('x', aad).iv);
  });

  it('tag bị sửa → ném lỗi; keyId lạ → ném lỗi', () => {
    const enc = encryptField('x', aad);
    const badTag = Buffer.from(enc.tag, 'base64');
    badTag[0] = (badTag[0] ?? 0) ^ 1;
    expect(() => decryptField({ ...enc, tag: badTag.toString('base64') }, aad)).toThrow();
    expect(() => decryptField({ ...enc, keyId: 'khong-co' }, aad)).toThrow();
  });
});
