// server/src/modules/calls/callState.repository.ts — Redis call:active, user:incall, call:deadlines, call:pending
// (DB §5.2–5.4). Chuyển trạng thái chỉ qua call-invite.lua / call-transition.lua; bộ đếm signaling (offerRevision,
// iceRestarts) tăng bằng HINCRBY có kiểm tra để hai event đua nhau chỉ một bên thắng (kiến trúc §7(f)).
import type { CallStatus, CallType } from '@hustalo/shared';
import type { Redis } from 'ioredis';
import { keys } from '../../infra/redis/keys';
import { withScripts } from '../../infra/redis/scripts';

export interface CallActiveState {
  callId: string;
  status: CallStatus;
  version: number;
  callType: CallType;
  conversationId: string;
  callerId: string;
  calleeId: string;
  callerDeviceId: string;
  callerTabId: string;
  acceptedDeviceId: string | null;
  acceptedTabId: string | null;
  offerRevision: number;
  answeredRevision: number;
  iceRestarts: number;
  createdAt: number;
  acceptedAt: number | null;
  connectedAt: number | null;
  endReason: string | null;
}

export interface InviteArgs {
  callId: string;
  callerId: string;
  calleeId: string;
  conversationId: string;
  callType: CallType;
  callerDeviceId: string;
  callerTabId: string;
  nowMs: number;
  ringTimeoutMs: number;
  connectTimeoutMs: number;
  stateTtlS?: number;
}

/** Key user:incall treo đã được script dọn (DB §5.4). */
export interface StaleInCall {
  userId: string;
  callId: string;
}

export type InviteResult = (
  | { result: 'CREATED'; callId: string }
  | { result: 'GLARE'; callId: string; version: number; callType: CallType }
  | { result: 'BUSY'; callId: string }
  | { result: 'CALLER_IN_CALL'; callId: string }
) & { stale: StaleInCall[] };

export interface TransitionArgs {
  callId: string;
  callerId: string;
  calleeId: string;
  expectedFrom: readonly CallStatus[];
  to: CallStatus;
  terminal?: boolean;
  fields?: Record<string, string | number>;
  removeDeadlines?: string[]; // hậu tố: RING, CONNECT, RECONNECT, PEER:{tabId}
  addDeadlines?: [string, number][];
}

export type TransitionOutcome =
  | { ok: true; status: CallStatus; version: number }
  | { ok: false; status: CallStatus; version: number }
  | { ok: false; missing: true };

const TERMINAL: readonly CallStatus[] = ['ENDED', 'REJECTED', 'CANCELLED', 'MISSED', 'BUSY', 'FAILED'];
const DEFAULT_STATE_TTL_S = 6 * 60 * 60; // CALL_STATE_TTL_S

const num = (v: string | undefined) => (v === undefined || v === '' ? null : Number(v));
const str = (v: string | undefined) => (v === undefined || v === '' ? null : v);

function parse(callId: string, h: Record<string, string>): CallActiveState | null {
  if (!h.status) return null;
  return {
    callId,
    status: h.status as CallStatus,
    version: Number(h.version),
    callType: h.callType as CallType,
    conversationId: h.conversationId ?? '',
    callerId: h.callerId ?? '',
    calleeId: h.calleeId ?? '',
    callerDeviceId: h.callerDeviceId ?? '',
    callerTabId: h.callerTabId ?? '',
    acceptedDeviceId: str(h.acceptedDeviceId),
    acceptedTabId: str(h.acceptedTabId),
    offerRevision: Number(h.offerRevision ?? 0),
    answeredRevision: Number(h.answeredRevision ?? 0),
    iceRestarts: Number(h.iceRestarts ?? 0),
    createdAt: Number(h.createdAt),
    acceptedAt: num(h.acceptedAt),
    connectedAt: num(h.connectedAt),
    endReason: str(h.endReason),
  };
}

export function createCallStateRepository(client: Redis) {
  const r = withScripts(client);

  return {
    async invite(a: InviteArgs): Promise<InviteResult> {
      const res = await r.callInvite(
        keys.userInCall(a.callerId),
        keys.userInCall(a.calleeId),
        keys.callActive(a.callId),
        keys.callDeadlines(),
        keys.callPending(a.calleeId),
        a.callId,
        a.callerId,
        a.calleeId,
        a.conversationId,
        a.callType,
        a.callerDeviceId,
        a.callerTabId,
        a.nowMs,
        a.ringTimeoutMs,
        a.stateTtlS ?? DEFAULT_STATE_TTL_S,
        keys.prefix,
        a.connectTimeoutMs,
      );
      // {result, callId, version|'', callType|'', staleCsv "userId=callId,…"}
      const [result, callId = '', version = '', callType = '', staleCsv = ''] = res;
      const stale = staleCsv
        ? staleCsv.split(',').map((pair) => {
            const [userId = '', id = ''] = pair.split('=');
            return { userId, callId: id };
          })
        : [];
      if (result === 'GLARE')
        return { result, callId, version: Number(version), callType: callType as CallType, stale };
      return { result: result as 'CREATED' | 'BUSY' | 'CALLER_IN_CALL', callId, stale };
    },

    async get(callId: string): Promise<CallActiveState | null> {
      return parse(callId, await r.hgetall(keys.callActive(callId)));
    },

    async transition(a: TransitionArgs): Promise<TransitionOutcome> {
      const res = await r.callTransition(
        keys.callActive(a.callId),
        keys.callDeadlines(),
        keys.userInCall(a.callerId),
        keys.userInCall(a.calleeId),
        keys.callPending(a.calleeId),
        a.callId,
        a.expectedFrom.join(','),
        a.to,
        (a.terminal ?? TERMINAL.includes(a.to)) ? '1' : '0',
        JSON.stringify(a.fields ?? {}),
        JSON.stringify(a.removeDeadlines ?? []),
        JSON.stringify(a.addDeadlines ?? []),
      );
      const flag = Number(res[0]);
      if (flag === -1) return { ok: false, missing: true };
      const status = res[1] as CallStatus;
      const version = Number(res[2]);
      return flag === 1 ? { ok: true, status, version } : { ok: false, status, version };
    },

    /**
     * Tăng bộ đếm signaling (`offerRevision`, `iceRestarts`) khi giá trị mới đúng bằng `expected`. HINCRBY nguyên tử:
     * hai event cùng giá trị đua nhau thì bên đến sau nhận số lớn hơn, hoàn tác và thua (kiến trúc §7(f)).
     */
    async bumpCounter(callId: string, field: 'offerRevision' | 'iceRestarts', expected: number): Promise<boolean> {
      const key = keys.callActive(callId);
      const next = await r.hincrby(key, field, 1);
      if (next === expected) return true;
      await r.hincrby(key, field, -1);
      return false;
    },

    setFields: async (callId: string, fields: Record<string, string | number>) => {
      await r.hset(keys.callActive(callId), fields);
    },

    incallOf: (userId: string) => r.get(keys.userInCall(userId)),

    pendingFor: (calleeId: string) => r.smembers(keys.callPending(calleeId)),

    addDeadline: async (member: string, scoreMs: number) => {
      await r.zadd(keys.callDeadlines(), scoreMs, member);
    },

    removeDeadline: async (member: string) => {
      await r.zrem(keys.callDeadlines(), member);
    },

    deadlineOf: async (member: string) => {
      const s = await r.zscore(keys.callDeadlines(), member);
      return s === null ? null : Number(s);
    },

    claimDue: (nowMs: number, limit: number) => r.claimDue(keys.callDeadlines(), nowMs, limit),
  };
}

export type CallStateRepository = ReturnType<typeof createCallStateRepository>;
