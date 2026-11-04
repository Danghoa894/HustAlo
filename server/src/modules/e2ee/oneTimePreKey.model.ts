// server/src/modules/e2ee/oneTimePreKey.model.ts — database_schema.md §2.10. Mỗi lần cấp là MỘT thao tác nguyên tử trên
// MỘT document (findOneAndUpdate consumedAt, DB §4.8); TTL dọn prekey đã cấp sau 7 ngày.
import { Schema, model, type InferSchemaType } from 'mongoose';
import { baseSchemaOptions } from '../../infra/db/schema-options';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const oneTimePreKeySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    deviceId: { type: String, required: true, match: UUID_V4 },
    keyId: { type: Number, required: true, min: 0, max: 16777215 },
    publicKey: { type: String, required: true, match: BASE64, minlength: 44, maxlength: 44 },
    consumedAt: { type: Date, default: null },
    consumedBy: { type: Schema.Types.ObjectId, default: null, ref: 'User' },
  },
  { ...baseSchemaOptions, collection: 'oneTimePreKeys' },
);

oneTimePreKeySchema.index({ userId: 1, deviceId: 1, keyId: 1 }, { unique: true, name: 'device_key_unique' });
oneTimePreKeySchema.index({ userId: 1, deviceId: 1, consumedAt: 1, keyId: 1 }, { name: 'available' });
oneTimePreKeySchema.index({ consumedAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60, name: 'consumed_ttl' });

export type OneTimePreKey = InferSchemaType<typeof oneTimePreKeySchema>;
export const OneTimePreKeyModel = model('OneTimePreKey', oneTimePreKeySchema);
