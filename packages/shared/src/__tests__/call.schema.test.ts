import { describe, expect, it } from 'vitest';
import {
  CallHistoryQuerySchema,
  CallRecordSchema,
  CallStateEventSchema,
  IceServersResponseSchema,
} from '../schemas/call.schema';
import {
  CallEndPayload,
  CallIcePayload,
  CallIceRestartPayload,
  CallInvitePayload,
  CallSdpPayload,
} from '../schemas/socket.schema';
import { CALL_ICE_CANDIDATE_MAX_LENGTH, CALL_SDP_MAX_LENGTH } from '../constants';

const callId = '6720d1b2c3d4e5f601234701';
const conversationId = '6720b1b2c3d4e5f601234501';
const peer = { id: '6720a1b2c3d4e5f601234563', username: 'bob', displayName: 'Bob Trần', avatarUrl: null };
const uuid = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

const record = {
  id: callId,
  conversationId,
  callType: 'VIDEO',
  direction: 'INCOMING',
  peer,
  status: 'ENDED',
  endReason: 'HANGUP',
  createdAt: '2026-10-27T09:16:40.000Z',
  connectedAt: '2026-10-27T09:16:48.000Z',
  endedAt: '2026-10-27T09:20:00.000Z',
  durationSec: 192,
};

describe('hợp đồng cuộc gọi (FR-CALL-001..008)', () => {
  it('CallRecord: ví dụ api_spec hợp lệ; direction ngoài OUTGOING/INCOMING → lỗi; trường lạ → lỗi (.strict)', () => {
    expect(CallRecordSchema.safeParse(record).success).toBe(true);
    expect(CallRecordSchema.safeParse({ ...record, direction: 'RINGING' }).success).toBe(false);
    expect(CallRecordSchema.safeParse({ ...record, callerId: peer.id }).success).toBe(false);
    expect(CallRecordSchema.safeParse({ ...record, durationSec: -1 }).success).toBe(false);
  });

  it('GET /calls query: limit 1..50 (mặc định 20), cursor base64url', () => {
    expect(CallHistoryQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(CallHistoryQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
    expect(CallHistoryQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(CallHistoryQuerySchema.safeParse({ cursor: 'a+b' }).success).toBe(false);
  });

  it('IceServersResponse: urls phải bắt đầu stun:/turn:/turns:; source XIRSYS|FALLBACK; policy all|relay', () => {
    const ok = {
      iceServers: [
        { urls: ['stun:stun.l.google.com:19302'] },
        { urls: ['turn:h:3478'], username: 'u', credential: 'c' },
      ],
      iceTransportPolicy: 'relay',
      expiresAt: '2026-10-27T11:00:00.000Z',
      source: 'FALLBACK',
    };
    expect(IceServersResponseSchema.safeParse(ok).success).toBe(true);
    expect(IceServersResponseSchema.safeParse({ ...ok, iceServers: [] }).success).toBe(false);
    expect(IceServersResponseSchema.safeParse({ ...ok, iceServers: [{ urls: ['http://x'] }] }).success).toBe(false);
    expect(IceServersResponseSchema.safeParse({ ...ok, source: 'OTHER' }).success).toBe(false);
  });

  it('CallStateEvent: acceptedTabId là UUID hoặc null; version ≥ 1', () => {
    const ev = {
      eventId: uuid,
      occurredAt: '2026-10-27T09:16:40.000Z',
      callId,
      conversationId,
      status: 'RINGING',
      endReason: null,
      callType: 'VOICE',
      callerId: peer.id,
      calleeId: '6720a1b2c3d4e5f601234564',
      acceptedDeviceId: null,
      acceptedTabId: null,
      connectedAt: null,
      endedAt: null,
      version: 2,
    };
    expect(CallStateEventSchema.safeParse(ev).success).toBe(true);
    expect(CallStateEventSchema.safeParse({ ...ev, version: 0 }).success).toBe(false);
    expect(CallStateEventSchema.safeParse({ ...ev, acceptedTabId: 'tab-1' }).success).toBe(false);
  });

  it('TC-CALL-SIG-012 payload invite: callType VOICE|VIDEO; callerId trong payload → lỗi (.strict)', () => {
    expect(CallInvitePayload.safeParse({ conversationId, callType: 'VIDEO' }).success).toBe(true);
    expect(CallInvitePayload.safeParse({ conversationId, callType: 'GROUP' }).success).toBe(false);
    expect(CallInvitePayload.safeParse({ conversationId, callType: 'VOICE', callerId: peer.id }).success).toBe(false);
  });

  it('SDP/candidate quá dài → lỗi; revision ≥ 1; attempt ≥ 1; reason chỉ HANGUP|NETWORK_FAILURE|MEDIA_FAILURE', () => {
    expect(CallSdpPayload.safeParse({ callId, revision: 1, sdp: 'x'.repeat(CALL_SDP_MAX_LENGTH) }).success).toBe(true);
    expect(CallSdpPayload.safeParse({ callId, revision: 1, sdp: 'x'.repeat(CALL_SDP_MAX_LENGTH + 1) }).success).toBe(
      false,
    );
    expect(CallSdpPayload.safeParse({ callId, revision: 0, sdp: 'v=0' }).success).toBe(false);
    const cand = (candidate: string) => ({
      callId,
      revision: 1,
      candidate: { candidate, sdpMid: '0', sdpMLineIndex: 0, usernameFragment: null },
    });
    expect(CallIcePayload.safeParse(cand('')).success).toBe(true); // end-of-candidates
    expect(CallIcePayload.safeParse(cand('x'.repeat(CALL_ICE_CANDIDATE_MAX_LENGTH + 1))).success).toBe(false);
    expect(CallIceRestartPayload.safeParse({ callId, attempt: 0 }).success).toBe(false);
    expect(CallEndPayload.safeParse({ callId, reason: 'HANGUP' }).success).toBe(true);
    expect(CallEndPayload.safeParse({ callId, reason: 'LOGOUT' }).success).toBe(false);
  });
});
