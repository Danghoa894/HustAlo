// packages/shared/src/schemas/call.schema.ts — DTO cuộc gọi: CallRecord/CallPage (GET /calls), IceServersResponse
// (GET /calls/ice-servers), CallStateEvent (S→C call:state) — api_spec components/schemas, kiến trúc §4.5, §9.5.
import { z } from 'zod';
import { CALL_PAGE_DEFAULT, CALL_PAGE_MAX } from '../constants';
import { CallEndReason, CallStatus, CallType } from '../enums';
import { isoDate, objectId, pageCursor, uuidV4 } from './common.schema';
import { UserPublicSchema } from './user.schema';

const enumOf = <T extends Record<string, string>>(o: T) => z.enum(Object.values(o) as [T[keyof T], ...T[keyof T][]]);

export const CallTypeSchema = enumOf(CallType);
export const CallStatusSchema = enumOf(CallStatus);
export const CallEndReasonSchema = enumOf(CallEndReason);

/** GET /calls — cursor `(createdAt, id)` base64url. */
export const CallHistoryQuerySchema = z
  .object({
    cursor: pageCursor.optional(),
    limit: z.coerce.number().int().min(1).max(CALL_PAGE_MAX).default(CALL_PAGE_DEFAULT),
  })
  .strict();
export type CallHistoryQuery = z.infer<typeof CallHistoryQuerySchema>;

/** `direction` tính theo người xem, không phải CallStatus (PRD FR-CALL-008). */
export const CallRecordSchema = z
  .object({
    id: objectId,
    conversationId: objectId,
    callType: CallTypeSchema,
    direction: z.enum(['OUTGOING', 'INCOMING']),
    peer: UserPublicSchema,
    status: CallStatusSchema,
    endReason: CallEndReasonSchema.nullable(),
    createdAt: isoDate,
    connectedAt: isoDate.nullable(),
    endedAt: isoDate.nullable(),
    durationSec: z.number().int().min(0).nullable(),
  })
  .strict();
export type CallRecord = z.infer<typeof CallRecordSchema>;

export const CallPageSchema = z
  .object({ items: z.array(CallRecordSchema).max(CALL_PAGE_MAX), nextCursor: z.string().nullable() })
  .strict();
export type CallPage = z.infer<typeof CallPageSchema>;

export const IceServerSchema = z
  .object({
    urls: z.array(z.string().regex(/^(stun|turn|turns):/)).min(1),
    username: z.string().optional(),
    credential: z.string().optional(),
  })
  .strict();
export type IceServer = z.infer<typeof IceServerSchema>;

export const IceServersResponseSchema = z
  .object({
    iceServers: z.array(IceServerSchema).min(1),
    iceTransportPolicy: z.enum(['all', 'relay']),
    expiresAt: isoDate,
    source: z.enum(['XIRSYS', 'FALLBACK']),
  })
  .strict();
export type IceServersResponse = z.infer<typeof IceServersResponseSchema>;

/** Phần dữ liệu của call:state S→C (không gồm eventId/occurredAt). */
export const CallStateSchema = z.object({
  callId: objectId,
  conversationId: objectId,
  status: CallStatusSchema,
  endReason: CallEndReasonSchema.nullable(),
  callType: CallTypeSchema,
  callerId: objectId,
  calleeId: objectId,
  acceptedDeviceId: uuidV4.nullable(),
  acceptedTabId: uuidV4.nullable(),
  connectedAt: isoDate.nullable(),
  endedAt: isoDate.nullable(),
  version: z.number().int().min(1),
});
export type CallState = z.infer<typeof CallStateSchema>;

export const CallStateEventSchema = CallStateSchema.extend({ eventId: uuidV4, occurredAt: isoDate });
export type CallStateEvent = z.infer<typeof CallStateEventSchema>;
