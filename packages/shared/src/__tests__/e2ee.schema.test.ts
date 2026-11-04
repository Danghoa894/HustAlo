// Schema E2EE (api_spec SignedPreKey … PreKeyBundlesResponse; FR-E2EE-001..003, AC-110).
import { describe, expect, it } from 'vitest';
import {
  PreKeyBundlesResponseSchema,
  RegisterDeviceKeysRequestSchema,
  UploadPreKeysRequestSchema,
} from '../schemas/e2ee.schema';

const key = (c: string) => `B${c.repeat(43)}`; // 44 ký tự base64 (33 byte, tiền tố 0x05)
const sig = `${'A'.repeat(86)}==`;

const register = {
  registrationId: 12345,
  identityKey: key('E'),
  signedPreKey: { keyId: 1, publicKey: key('I'), signature: sig },
  oneTimePreKeys: [{ keyId: 1, publicKey: key('M') }],
};

describe('RegisterDeviceKeysRequestSchema', () => {
  it('TC-AC-110 nhận khóa công khai; có trường khóa riêng → lỗi (.strict)', () => {
    expect(RegisterDeviceKeysRequestSchema.safeParse(register).success).toBe(true);
    expect(RegisterDeviceKeysRequestSchema.safeParse({ ...register, identityKeyPrivate: key('X') }).success).toBe(
      false,
    );
    expect(
      RegisterDeviceKeysRequestSchema.safeParse({
        ...register,
        signedPreKey: { ...register.signedPreKey, privateKey: key('X') },
      }).success,
    ).toBe(false);
  });

  it('oneTimePreKeys không bắt buộc (xoay signed prekey); tối đa 100; khóa/chữ ký sai độ dài → lỗi', () => {
    const { oneTimePreKeys: _drop, ...rotate } = register;
    expect(RegisterDeviceKeysRequestSchema.safeParse(rotate).success).toBe(true);
    const many = Array.from({ length: 101 }, (_, i) => ({ keyId: i, publicKey: key('M') }));
    expect(RegisterDeviceKeysRequestSchema.safeParse({ ...register, oneTimePreKeys: many }).success).toBe(false);
    expect(RegisterDeviceKeysRequestSchema.safeParse({ ...register, identityKey: key('E').slice(1) }).success).toBe(
      false,
    );
    expect(
      RegisterDeviceKeysRequestSchema.safeParse({
        ...register,
        signedPreKey: { ...register.signedPreKey, signature: 'A'.repeat(88) },
      }).success,
    ).toBe(false);
    expect(RegisterDeviceKeysRequestSchema.safeParse({ ...register, registrationId: 16381 }).success).toBe(false);
  });

  it('keyId one-time prekey 0..16777215', () => {
    const ok = UploadPreKeysRequestSchema.safeParse({ oneTimePreKeys: [{ keyId: 16777215, publicKey: key('M') }] });
    const bad = UploadPreKeysRequestSchema.safeParse({ oneTimePreKeys: [{ keyId: 16777216, publicKey: key('M') }] });
    expect(ok.success).toBe(true);
    expect(bad.success).toBe(false);
    expect(UploadPreKeysRequestSchema.safeParse({ oneTimePreKeys: [] }).success).toBe(false);
  });
});

describe('PreKeyBundlesResponseSchema', () => {
  it('oneTimePreKey có thể null (EC-E2EE-002); 1..5 bundle', () => {
    const bundle = {
      userId: '6720a1b2c3d4e5f601234563',
      deviceId: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
      signalDeviceId: 1,
      registrationId: 4321,
      identityKey: key('E'),
      signedPreKey: { keyId: 3, publicKey: key('I'), signature: sig },
      oneTimePreKey: null,
    };
    expect(PreKeyBundlesResponseSchema.safeParse({ userId: bundle.userId, bundles: [bundle] }).success).toBe(true);
    expect(PreKeyBundlesResponseSchema.safeParse({ userId: bundle.userId, bundles: [] }).success).toBe(false);
  });
});
