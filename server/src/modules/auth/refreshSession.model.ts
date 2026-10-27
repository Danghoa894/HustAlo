// server/src/modules/auth/refreshSession.model.ts
import { Schema, model, type InferSchemaType } from 'mongoose';
import { SessionRevokeReason } from '@hustalo/shared';
import { baseSchemaOptions } from '../../infra/db/schema-options';

const HEX64 = /^[a-f0-9]{64}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const refreshSessionSchema = new Schema(
  {
    familyId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    deviceId: { type: String, required: true, match: UUID_V4 },
    tokenHash: { type: String, required: true, match: HEX64, select: false },
    parentHash: { type: String, default: null, match: HEX64, select: false },
    replacedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    revokeReason: { type: String, default: null, enum: [...Object.values(SessionRevokeReason), null] },
    expiresAt: { type: Date, required: true },
    userAgent: { type: String, default: '', maxlength: 512 },
    ip: { type: String, default: '', maxlength: 45 },
  },
  { ...baseSchemaOptions, collection: 'refreshSessions' },
);

refreshSessionSchema.index({ tokenHash: 1 }, { unique: true, name: 'tokenHash_unique' });
refreshSessionSchema.index({ familyId: 1, createdAt: -1 }, { name: 'family' });
refreshSessionSchema.index({ userId: 1, deviceId: 1, revokedAt: 1 }, { name: 'user_device_active' });
refreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expires_ttl' });

export type RefreshSession = InferSchemaType<typeof refreshSessionSchema>;
export const RefreshSessionModel = model('RefreshSession', refreshSessionSchema);
