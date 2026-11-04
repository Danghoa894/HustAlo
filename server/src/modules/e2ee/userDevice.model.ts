// server/src/modules/e2ee/userDevice.model.ts — database_schema.md §2.9. Chỉ lưu KHÓA CÔNG KHAI (kiến trúc §9.3).
import { DeviceStatus } from '@hustalo/shared';
import { Schema, model, type InferSchemaType } from 'mongoose';
import { baseSchemaOptions } from '../../infra/db/schema-options';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

// Độ dài đã đối chiếu với @privacyresearch/libsignal-protocol-typescript 0.0.16: public key serialize 33 byte
// (0x05 + 32) → 44 ký tự base64; chữ ký XEdDSA 64 byte → 88 ký tự.
const signedPreKeySchema = new Schema(
  {
    keyId: { type: Number, required: true, min: 0 },
    publicKey: { type: String, required: true, match: BASE64, minlength: 44, maxlength: 44 },
    signature: { type: String, required: true, match: BASE64, minlength: 88, maxlength: 88 },
    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { _id: false, strict: 'throw' },
);

const userDeviceSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    deviceId: { type: String, required: true, match: UUID_V4 },
    signalDeviceId: { type: Number, required: true, min: 1, max: 2147483647 },
    registrationId: { type: Number, required: true, min: 1, max: 16380 },
    identityKey: { type: String, required: true, match: BASE64, minlength: 44, maxlength: 44 },
    signedPreKey: { type: signedPreKeySchema, required: true },
    status: { type: String, required: true, enum: Object.values(DeviceStatus), default: DeviceStatus.ACTIVE },
    revokedAt: { type: Date, default: null },
  },
  { ...baseSchemaOptions, collection: 'userDevices' },
);

userDeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true, name: 'user_device_unique' });
userDeviceSchema.index({ userId: 1, signalDeviceId: 1 }, { unique: true, name: 'user_signalDevice_unique' });
userDeviceSchema.index({ userId: 1, status: 1 }, { name: 'user_status' });

export type UserDevice = InferSchemaType<typeof userDeviceSchema>;
export const UserDeviceModel = model('UserDevice', userDeviceSchema);
