// server/src/modules/calls/callHistory.model.ts — database_schema.md §2.8 (_id = callId; ghi sau mỗi chuyển trạng thái)
import { Schema, model, type InferSchemaType } from 'mongoose';
import { CALL_ACTIVE_STATUSES, CALL_MAX_ICE_RESTARTS, CallEndReason, CallStatus, CallType } from '@hustalo/shared';
import { baseSchemaOptions } from '../../infra/db/schema-options';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const callHistorySchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, required: true, ref: 'Conversation' },
    callType: { type: String, required: true, enum: Object.values(CallType) },
    callerId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    calleeId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    participantIds: {
      type: [Schema.Types.ObjectId],
      required: true,
      validate: { validator: (v: unknown[]) => v.length === 2, message: 'participantIds phải có 2 phần tử' },
    },
    callerDeviceId: { type: String, required: true, match: UUID_V4 },
    callerTabId: { type: String, required: true, match: UUID_V4 },
    acceptedDeviceId: { type: String, default: null, match: UUID_V4 },
    acceptedTabId: { type: String, default: null, match: UUID_V4 },
    status: { type: String, required: true, enum: Object.values(CallStatus), default: CallStatus.INITIATED },
    endReason: { type: String, default: null, enum: [...Object.values(CallEndReason), null] },
    version: { type: Number, required: true, default: 1, min: 1 },
    iceRestarts: { type: Number, required: true, default: 0, min: 0, max: CALL_MAX_ICE_RESTARTS },
    acceptedAt: { type: Date, default: null },
    connectedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    durationSec: { type: Number, default: null, min: 0 },
  },
  { ...baseSchemaOptions, collection: 'callHistory' },
);

callHistorySchema.index({ participantIds: 1, createdAt: -1, _id: -1 }, { name: 'participant_created' });
callHistorySchema.index(
  { status: 1, updatedAt: 1 },
  { partialFilterExpression: { status: { $in: [...CALL_ACTIVE_STATUSES] } }, name: 'active_reconcile' },
);
callHistorySchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60, name: 'created_ttl' });

export type CallHistory = InferSchemaType<typeof callHistorySchema>;
export const CallHistoryModel = model('CallHistory', callHistorySchema);
