// packages/shared/src/schemas/e2ee.schema.ts — khóa công khai thiết bị, one-time prekey, PreKeyBundle, danh sách
// thiết bị (api_spec components/schemas: SignedPreKey … PreKeyBundlesResponse; PRD FR-E2EE-001..003, FR-E2EE-007).
// Envelope gửi tin (E2eeEnvelope) ở socket.schema.ts, envelope theo device (E2eeEnvelopeViewSchema) ở message.schema.ts.
import { z } from 'zod';
import { E2EE_MAX_DEVICES_PER_USER, E2EE_ONE_TIME_PREKEY_BATCH } from '../constants';
import { DeviceStatus } from '../enums';
import { isoDate, objectId, uuidV4 } from './common.schema';

/** Khóa công khai Curve25519 33 byte (tiền tố kiểu 0x05) dạng base64 — 44 ký tự. */
export const Base64PublicKey = z.string().regex(/^[A-Za-z0-9+/]{43}[A-Za-z0-9+/=]$/, 'Khóa công khai không hợp lệ');
/** Chữ ký XEdDSA 64 byte dạng base64 — 88 ký tự. */
export const Base64Signature = z.string().regex(/^[A-Za-z0-9+/]{86}==$/, 'Chữ ký không hợp lệ');

/** Signal prekey id 24 bit (api_spec OneTimePreKey.keyId ≤ 16777215). */
const preKeyIdMax = 0xffffff;
/** Signal registrationId 1..16380 (api_spec RegisterDeviceKeysRequest). */
const registrationIdMax = 16380;

export const SignedPreKeySchema = z
  .object({ keyId: z.number().int().min(0), publicKey: Base64PublicKey, signature: Base64Signature })
  .strict();
export type SignedPreKey = z.infer<typeof SignedPreKeySchema>;

export const OneTimePreKeySchema = z
  .object({ keyId: z.number().int().min(0).max(preKeyIdMax), publicKey: Base64PublicKey })
  .strict();
export type OneTimePreKey = z.infer<typeof OneTimePreKeySchema>;

const preKeyBatch = z.array(OneTimePreKeySchema).min(1).max(E2EE_ONE_TIME_PREKEY_BATCH);

/** PUT /e2ee/devices/{deviceId}/keys — không bao giờ có trường khóa riêng (.strict()). */
export const RegisterDeviceKeysRequestSchema = z
  .object({
    registrationId: z.number().int().min(1).max(registrationIdMax),
    identityKey: Base64PublicKey,
    signedPreKey: SignedPreKeySchema,
    oneTimePreKeys: preKeyBatch.optional(), // bắt buộc ở lần đăng ký đầu (kiểm trong service)
  })
  .strict();
export type RegisterDeviceKeysRequest = z.infer<typeof RegisterDeviceKeysRequestSchema>;

export const DeviceKeysResponseSchema = z
  .object({ deviceId: uuidV4, signalDeviceId: z.number().int().min(1), oneTimePreKeyCount: z.number().int().min(0) })
  .strict();
export type DeviceKeysResponse = z.infer<typeof DeviceKeysResponseSchema>;

/** POST /e2ee/devices/{deviceId}/prekeys. */
export const UploadPreKeysRequestSchema = z.object({ oneTimePreKeys: preKeyBatch }).strict();
export type UploadPreKeysRequest = z.infer<typeof UploadPreKeysRequestSchema>;

export const PreKeyCountResponseSchema = z.object({ oneTimePreKeyCount: z.number().int().min(0) }).strict();
export type PreKeyCountResponse = z.infer<typeof PreKeyCountResponseSchema>;

export const DeviceSchema = z
  .object({
    deviceId: uuidV4,
    signalDeviceId: z.number().int().min(1),
    status: z.enum([DeviceStatus.ACTIVE, DeviceStatus.REVOKED]),
    isCurrent: z.boolean(),
    userAgent: z.string().max(512),
    oneTimePreKeyCount: z.number().int().min(0),
    createdAt: isoDate,
    revokedAt: isoDate.nullable(),
  })
  .strict();
export type Device = z.infer<typeof DeviceSchema>;

export const DeviceListSchema = z.object({ items: z.array(DeviceSchema) }).strict();
export type DeviceList = z.infer<typeof DeviceListSchema>;

export const PreKeyBundleSchema = z
  .object({
    userId: objectId,
    deviceId: uuidV4,
    signalDeviceId: z.number().int().min(1),
    registrationId: z.number().int().min(1).max(registrationIdMax),
    identityKey: Base64PublicKey,
    signedPreKey: SignedPreKeySchema,
    oneTimePreKey: OneTimePreKeySchema.nullable(),
  })
  .strict();
export type PreKeyBundle = z.infer<typeof PreKeyBundleSchema>;

export const PreKeyBundlesResponseSchema = z
  .object({ userId: objectId, bundles: z.array(PreKeyBundleSchema).min(1).max(E2EE_MAX_DEVICES_PER_USER) })
  .strict();
export type PreKeyBundlesResponse = z.infer<typeof PreKeyBundlesResponseSchema>;

/** GET /e2ee/users/{userId}/identities — chỉ đọc, không tiêu thụ prekey (FR-E2EE-006). */
export const DeviceIdentitySchema = z
  .object({ deviceId: uuidV4, signalDeviceId: z.number().int().min(1), identityKey: Base64PublicKey })
  .strict();
export type DeviceIdentity = z.infer<typeof DeviceIdentitySchema>;

export const DeviceIdentitiesResponseSchema = z
  .object({ userId: objectId, items: z.array(DeviceIdentitySchema).max(E2EE_MAX_DEVICES_PER_USER) })
  .strict();
export type DeviceIdentitiesResponse = z.infer<typeof DeviceIdentitiesResponseSchema>;

/** Path `/e2ee/devices/{deviceId}…`. */
export const DeviceIdParamsSchema = z.object({ deviceId: uuidV4 }).strict();
