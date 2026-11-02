// server/src/modules/calls/calls.service.ts — cuộc gọi 1-1 (FR-CALL-001..011; kiến trúc §7(e)–(g), §8).
// Mỗi event: đọc call:active → xác định actor (AUTHZ-6) → hỏi call.state-machine → CAS bằng call-transition.lua →
// ghi callHistory có điều kiện → phát call:state + event chuyên biệt → SYSTEM khi terminal. CAS thua (event khác vừa
// đổi trạng thái) → đọc lại và đánh giá lại, nên bên đến sau luôn thấy trạng thái mới nhất (EC-CALL-SIG-005).
import {
  CALL_CONNECT_TIMEOUT_MS,
  CALL_DEADLINE_SWEEP_INTERVAL_MS,
  CALL_INCOMING_ACK_TIMEOUT_MS,
  CALL_PAGE_MAX,
  CALL_RECONNECT_GRACE_MS,
  CALL_RING_TIMEOUT_MS,
  CALL_STATE_TTL_S,
  EVENTS,
  decodeCursor,
  encodeCursor,
} from '@hustalo/shared';
import type { CallEndReason, CallPage, CallRecord, CallState, CallStatus, CallType, UserPublic } from '@hustalo/shared';
import { Types } from 'mongoose';
import type { Logger } from 'pino';
import { AppError } from '../../http/errors/app-error';
import { metrics } from '../../infra/metrics/metrics';
import type { Emitter } from '../../realtime/emitter';
import { sessionRoom, tabRoom, userRoom } from '../../realtime/rooms';
import {
  deadlineOps,
  isTerminal,
  transition,
  type CallActor,
  type CallDeadlineKind,
  type CallEvent,
  type CallMachineState,
} from './call.state-machine';
import { createCallSweeper } from './call.sweeper';
import type { CallActiveState, CallStateRepository } from './callState.repository';
import type { CallHistoryRecord, CallsRepository } from './calls.repository';

// ---- Port tới module khác (kiến trúc §5.2: calls → users, conversations, messages) ----
export interface CallsConversationsPort {
  assertMember(conversationId: string, userId: string): Promise<{ conv: { _id: Types.ObjectId; type: string } }>;
  getOtherMember(conversationId: Types.ObjectId, me: string): Promise<string | null>;
}
export interface CallsUsersPort {
  isBlockedEitherWay(a: string, b: string): Promise<boolean>;
  getPublicMany(ids: string[]): Promise<Map<string, { user: UserPublic; active: boolean }>>;
}
export interface CallsMessagesPort {
  createSystemMessage(
    conversationId: string,
    input: {
      kind: 'CALL_MISSED' | 'CALL_ENDED';
      actorId: string;
      callId: string;
      callType: CallType;
      durationSec?: number | null;
    },
  ): Promise<void>;
}

export interface CallTiming {
  ringMs: number;
  connectMs: number;
  reconnectMs: number;
  peerGraceMs: number;
  incomingAckMs: number;
  sweepMs: number;
}

export interface CallsDeps {
  state: CallStateRepository;
  history: CallsRepository;
  conversations: CallsConversationsPort;
  users: CallsUsersPort;
  messages: CallsMessagesPort;
  emitter: Emitter;
  logger: Logger;
  timing?: Partial<CallTiming>;
  /** Rate limit callInvite theo user (RATE_LIMITS.callInvite); ném RATE_LIMITED. Không có → không giới hạn. */
  limitInvite?: (userId: string) => Promise<void>;
}

/** Tab gửi event (socket.data.auth). */
export interface CallAuth {
  userId: string;
  deviceId: string;
  tabId: string;
}

const MSG = {
  notFound: 'Không tìm thấy cuộc gọi',
  group: 'Cuộc gọi nhóm chưa được hỗ trợ',
  busy: 'Người nhận đang bận',
  blocked: 'Không thể gọi cho người này',
  inCall: 'Bạn đang trong một cuộc gọi khác',
  invalid: 'Thao tác không hợp lệ với trạng thái cuộc gọi',
  forbidden: 'Bạn không có quyền thực hiện thao tác này',
  timeout: 'Cuộc gọi đã kết thúc',
  answered: 'Cuộc gọi đã được trả lời trên thiết bị khác',
  badCursor: 'Cursor không hợp lệ',
} as const;

const ERROR_MESSAGE: Record<string, string> = {
  CALL_NOT_FOUND: MSG.notFound,
  CALL_INVALID_STATE: MSG.invalid,
  FORBIDDEN: MSG.forbidden,
  CALL_TIMEOUT: MSG.timeout,
  CALL_ALREADY_ANSWERED: MSG.answered,
};

const CAS_ATTEMPTS = 3;
function fail(code: string): never {
  throw new AppError(code as never, ERROR_MESSAGE[code] ?? MSG.invalid);
}

const toMachine = (s: CallActiveState): CallMachineState => ({
  status: s.status,
  offerRevision: s.offerRevision,
  answeredRevision: s.answeredRevision,
  iceRestarts: s.iceRestarts,
  connected: s.connectedAt !== null,
});

/** null = không phải caller/callee (→ CALL_NOT_FOUND, AUTHZ-6). */
function actorOf(
  s: { callerId: string; calleeId: string; callerTabId: string; acceptedTabId: string | null },
  a: { userId: string; tabId: string },
): CallActor | null {
  if (a.userId === s.callerId) return a.tabId === s.callerTabId ? 'CALLER_TAB' : 'CALLER_OTHER_TAB';
  if (a.userId === s.calleeId) return a.tabId === s.acceptedTabId ? 'CALLEE_TAB' : 'CALLEE_OTHER_TAB';
  return null;
}

const iso = (ms: number | null | undefined) => (ms === null || ms === undefined ? null : new Date(ms).toISOString());

export function createCallsService(deps: CallsDeps) {
  const { state, history, conversations, users, messages, emitter, logger } = deps;
  const timing: CallTiming = {
    ringMs: CALL_RING_TIMEOUT_MS,
    connectMs: CALL_CONNECT_TIMEOUT_MS,
    reconnectMs: CALL_RECONNECT_GRACE_MS,
    peerGraceMs: CALL_RECONNECT_GRACE_MS,
    incomingAckMs: CALL_INCOMING_ACK_TIMEOUT_MS,
    sweepMs: CALL_DEADLINE_SWEEP_INTERVAL_MS,
    ...deps.timing,
  };
  const durationOf = (k: Exclude<CallDeadlineKind, 'PEER'>) =>
    k === 'RING' ? timing.ringMs : k === 'CONNECT' ? timing.connectMs : timing.reconnectMs;

  async function publicOf(id: string): Promise<UserPublic> {
    const u = (await users.getPublicMany([id])).get(id)?.user;
    if (!u) throw new AppError('NOT_FOUND', 'Không tìm thấy người dùng');
    return u;
  }

  function stateDto(s: CallActiveState, endedAt: number | null): CallState {
    return {
      callId: s.callId,
      conversationId: s.conversationId,
      status: s.status,
      endReason: (s.endReason as CallEndReason | null) ?? null,
      callType: s.callType,
      callerId: s.callerId,
      calleeId: s.calleeId,
      acceptedDeviceId: s.acceptedDeviceId,
      acceptedTabId: s.acceptedTabId,
      connectedAt: iso(s.connectedAt),
      endedAt: iso(endedAt),
      version: s.version,
    };
  }

  const emitState = (dto: CallState) => {
    emitter.toRooms([userRoom(dto.callerId), userRoom(dto.calleeId)], EVENTS.CALL_STATE, dto);
  };

  /** SYSTEM khi terminal (§8.2 (4)): MISSED/BUSY → CALL_MISSED; ENDED có connectedAt → CALL_ENDED. */
  async function systemFor(rec: CallHistoryRecord): Promise<void> {
    const base = { actorId: String(rec.callerId), callId: String(rec._id), callType: rec.callType };
    if (rec.status === 'MISSED' || rec.status === 'BUSY') {
      await messages.createSystemMessage(String(rec.conversationId), { kind: 'CALL_MISSED', ...base });
    } else if (rec.status === 'ENDED' && rec.connectedAt) {
      await messages.createSystemMessage(String(rec.conversationId), {
        kind: 'CALL_ENDED',
        ...base,
        durationSec: rec.durationSec,
      });
    }
  }

  async function safeSystem(rec: CallHistoryRecord) {
    try {
      await systemFor(rec);
    } catch (err) {
      logger.error({ err, callId: String(rec._id) }, 'không tạo được SYSTEM message cuộc gọi');
    }
  }

  /**
   * CAS một chuyển trạng thái đã được state machine duyệt. null = CAS thua (trạng thái đã đổi) → người gọi đọc lại.
   */
  async function apply(
    s: CallActiveState,
    to: CallStatus,
    endReason: CallEndReason | null,
    fields: Record<string, string | number> = {},
  ): Promise<CallActiveState | null> {
    const now = Date.now();
    const ops = deadlineOps(s.status, to);
    const all: Record<string, string | number> = { ...fields };
    if (endReason) all.endReason = endReason;
    if (to === 'CONNECTED' && s.connectedAt === null) all.connectedAt = now;
    const res = await state.transition({
      callId: s.callId,
      callerId: s.callerId,
      calleeId: s.calleeId,
      expectedFrom: [s.status],
      to,
      fields: all,
      removeDeadlines: ops.remove,
      addDeadlines: ops.add.map((k): [string, number] => [k, now + durationOf(k)]),
    });
    if (!res.ok) return null;

    const next: CallActiveState = {
      ...s,
      status: to,
      version: res.version,
      endReason: endReason ?? s.endReason,
      connectedAt: typeof all.connectedAt === 'number' ? all.connectedAt : s.connectedAt,
      acceptedDeviceId: typeof all.acceptedDeviceId === 'string' ? all.acceptedDeviceId : s.acceptedDeviceId,
      acceptedTabId: typeof all.acceptedTabId === 'string' ? all.acceptedTabId : s.acceptedTabId,
      acceptedAt: typeof all.acceptedAt === 'number' ? all.acceptedAt : s.acceptedAt,
    };
    metrics.callTransitions.inc({ from: s.status, to, endReason: endReason ?? '' });
    if (to === 'CONNECTED' && s.status !== 'RECONNECTING' && s.acceptedAt) {
      metrics.callSetup.observe({ callType: s.callType }, (now - s.acceptedAt) / 1000);
    }

    if (isTerminal(to)) {
      const { record, changed } = await history.finalize(s.callId, {
        status: to,
        endReason: endReason ?? 'HANGUP',
        endedAt: new Date(now),
        version: res.version,
      });
      emitState(stateDto(next, now));
      if (changed) await safeSystem(record);
    } else {
      await history.update(s.callId, {
        status: to,
        version: res.version,
        ...(next.acceptedDeviceId && to === 'ACCEPTED' ? { acceptedDeviceId: next.acceptedDeviceId } : {}),
        ...(next.acceptedTabId && to === 'ACCEPTED' ? { acceptedTabId: next.acceptedTabId } : {}),
        ...(to === 'ACCEPTED' && next.acceptedAt ? { acceptedAt: new Date(next.acceptedAt) } : {}),
        ...(to === 'CONNECTED' && next.connectedAt ? { connectedAt: new Date(next.connectedAt) } : {}),
      });
      emitState(stateDto(next, null));
    }
    return next;
  }

  /** Event chuyên biệt sau ACCEPTED (T04/T05): call:accepted tới 2 tab, answered-elsewhere tới tab khác của callee. */
  function announceAccepted(s: CallActiveState) {
    if (!s.acceptedTabId || !s.acceptedDeviceId) return;
    const payload = { callId: s.callId, acceptedDeviceId: s.acceptedDeviceId, acceptedTabId: s.acceptedTabId };
    emitter.toRooms([tabRoom(s.callerTabId), tabRoom(s.acceptedTabId)], EVENTS.CALL_ACCEPTED, payload);
    emitter.toUserExceptTab(s.calleeId, s.acceptedTabId, EVENTS.CALL_ANSWERED_ELSEWHERE, {
      callId: s.callId,
      reason: 'ANSWERED_ELSEWHERE',
    });
  }

  /**
   * Chạy một event lên cuộc gọi đang live: đánh giá bảng, CAS, thử lại khi thua. `extra` thêm trường khi chuyển.
   * Trả trạng thái sau xử lý (noop → trạng thái hiện tại).
   */
  async function drive(
    callId: string,
    event: CallEvent,
    who: CallAuth | 'SERVER',
    extra?: (s: CallActiveState) => Record<string, string | number>,
  ): Promise<{ s: CallActiveState; changed: boolean }> {
    for (let i = 0; i < CAS_ATTEMPTS; i += 1) {
      const s = await state.get(callId);
      if (!s) fail('CALL_NOT_FOUND');
      const cur = s;
      const actor = who === 'SERVER' ? 'SERVER' : actorOf(cur, who);
      if (actor === null) fail('CALL_NOT_FOUND');
      const r = transition(toMachine(cur), event, actor);
      if ('error' in r) fail(r.error);
      if ('noop' in r) return { s: cur, changed: false };
      const next = await apply(cur, r.to, r.endReason, extra?.(cur));
      if (next) return { s: next, changed: true };
    }
    logger.warn({ callId, event: event.type }, 'CAS cuộc gọi thua liên tiếp');
    return fail('CALL_INVALID_STATE');
  }

  /**
   * call:active không còn (hết TTL 300 s sau terminal, hoặc Redis mất dữ liệu): tra Mongo. Record chưa terminal →
   * chốt T29 (§8.5 bước 3) và phát call:state kết thúc. Trả record cuối; null = không có / không phải người tham gia.
   */
  async function resolveLost(callId: string, userId: string): Promise<CallHistoryRecord | null> {
    const rec = await history.findById(callId);
    if (!rec || (String(rec.callerId) !== userId && String(rec.calleeId) !== userId)) return null;
    if (isTerminal(rec.status)) return rec;
    const r = transition(
      {
        status: rec.status,
        offerRevision: 0,
        answeredRevision: 0,
        iceRestarts: rec.iceRestarts,
        connected: rec.connectedAt !== null,
      },
      { type: 'STATE_LOST' },
      'SERVER',
    );
    if (!('to' in r)) return rec;
    const endedAt = new Date();
    const { record, changed } = await history.finalize(callId, {
      status: r.to,
      endReason: r.endReason ?? 'SERVER_RESTART',
      endedAt,
      version: rec.version + 1,
    });
    if (changed) {
      metrics.callTransitions.inc({ from: rec.status, to: r.to, endReason: r.endReason ?? '' });
      emitState({
        callId,
        conversationId: String(record.conversationId),
        status: record.status,
        endReason: record.endReason,
        callType: record.callType,
        callerId: String(record.callerId),
        calleeId: String(record.calleeId),
        acceptedDeviceId: record.acceptedDeviceId,
        acceptedTabId: record.acceptedTabId,
        connectedAt: record.connectedAt ? record.connectedAt.toISOString() : null,
        endedAt: endedAt.toISOString(),
        version: record.version,
      });
      await safeSystem(record);
    }
    return record;
  }

  /** end/cancel/reject/state khi state Redis đã mất: ACK trạng thái cuối (T32 qua Mongo, T29). */
  async function lostOr<T>(
    callId: string,
    auth: CallAuth,
    live: () => Promise<T>,
    onLost: (r: CallHistoryRecord) => T,
  ) {
    if (await state.get(callId)) return live();
    const rec = await resolveLost(callId, auth.userId);
    if (!rec) return fail('CALL_NOT_FOUND');
    return onLost(rec);
  }

  /** Điều kiện glare của call-invite.lua (DB §5.4), đọc trước để quyết định có tính rate limit hay không. */
  async function glareCandidate(me: string, callee: string, conversationId: string): Promise<boolean> {
    const [mine, theirs] = await Promise.all([state.incallOf(me), state.incallOf(callee)]);
    if (!mine || mine !== theirs) return false;
    const s = await state.get(mine);
    return (
      !!s &&
      s.callerId === callee &&
      s.calleeId === me &&
      s.conversationId === conversationId &&
      (s.status === 'INITIATED' || s.status === 'RINGING')
    );
  }

  async function ringExpiresAt(s: CallActiveState): Promise<string> {
    const at = await state.deadlineOf(`${s.callId}:RING`);
    return new Date(at ?? s.createdAt + timing.ringMs).toISOString();
  }

  /** T03: ≥ 1 tab callee đã hiện màn hình → RINGING, call:ringing một lần tới tab caller. */
  async function onIncomingAck(callId: string) {
    const { s, changed } = await drive(callId, { type: 'INCOMING_ACK' }, 'SERVER');
    if (changed && s.status === 'RINGING') {
      emitter.toTab(s.callerTabId, EVENTS.CALL_RINGING, { callId, ringExpiresAt: await ringExpiresAt(s) });
    }
  }

  async function incomingPayload(s: CallActiveState) {
    return {
      callId: s.callId,
      conversationId: s.conversationId,
      callType: s.callType,
      caller: await publicOf(s.callerId),
      ringExpiresAt: await ringExpiresAt(s),
    };
  }

  async function ringCallee(s: CallActiveState) {
    try {
      const acked = await emitter.toUserFirstAck(
        s.calleeId,
        EVENTS.CALL_INCOMING,
        await incomingPayload(s),
        timing.incomingAckMs,
      );
      if (acked) await onIncomingAck(s.callId);
    } catch (err) {
      if (!(err instanceof AppError)) logger.warn({ err, callId: s.callId }, 'không giao được call:incoming');
    }
  }

  async function onDeadline(member: string) {
    const [callId = '', kind = '', tabId] = member.split(':');
    const s = await state.get(callId);
    if (!s) return;
    let event: CallEvent;
    if (kind === 'PEER') {
      const peer = tabId === s.callerTabId ? 'CALLER_TAB' : tabId === s.acceptedTabId ? 'CALLEE_TAB' : null;
      if (!peer) return;
      event = { type: 'DEADLINE', kind: 'PEER', peer };
    } else if (kind === 'RING' || kind === 'CONNECT' || kind === 'RECONNECT') {
      event = { type: 'DEADLINE', kind };
    } else return;
    try {
      await drive(callId, event, 'SERVER');
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
    }
  }

  const sweeper = createCallSweeper({ claimDue: state.claimDue, onDeadline, intervalMs: timing.sweepMs, logger });

  /** Kết thúc cuộc gọi của các tab thuộc phiên bị thu hồi (T11, T27) hoặc của user bị khóa (T27, T28). */
  async function endForTabs(tabs: { userId: string; tabId: string }[], cause: 'LOGOUT' | 'LOCK') {
    const seen = new Set<string>();
    for (const t of tabs) {
      const callId = await state.incallOf(t.userId);
      if (!callId || seen.has(callId)) continue;
      const s = await state.get(callId);
      if (!s) continue;
      const tab = actorOf(s, t);
      if (!tab || tab === 'SERVER') continue;
      if (cause === 'LOGOUT' && tab !== 'CALLER_TAB' && tab !== 'CALLEE_TAB') continue;
      seen.add(callId);
      await drive(callId, cause === 'LOCK' ? { type: 'LOCK' } : { type: 'LOGOUT', tab }, 'SERVER').catch(
        (err: unknown) => {
          if (!(err instanceof AppError))
            logger.error({ err, callId }, 'không kết thúc được cuộc gọi khi thu hồi phiên');
        },
      );
    }
  }

  return {
    timing,

    /** §7(e), §7(g): CREATED → T01; GLARE → T05 (merged); BUSY → T02; caller đang gọi → CALL_INVALID_STATE. */
    async invite(auth: CallAuth, p: { conversationId: string; callType: CallType }) {
      const me = auth.userId;
      const { conv } = await conversations.assertMember(p.conversationId, me);
      if (conv.type === 'GROUP') throw new AppError('VALIDATION_ERROR', MSG.group); // D-22
      const callee = await conversations.getOtherMember(conv._id, me);
      if (!callee) throw new AppError('NOT_FOUND', MSG.notFound);
      if (await users.isBlockedEitherWay(me, callee)) throw new AppError('USER_BLOCKED', MSG.blocked);

      // §7(g): lời mời gộp do glare không tính rate limit → kiểm khả năng glare trước, rồi mới tăng bộ đếm.
      const glare = await glareCandidate(me, callee, String(conv._id));
      if (!glare) await deps.limitInvite?.(me);

      const callId = new Types.ObjectId();
      const now = Date.now();
      const res = await state.invite({
        callId: callId.toHexString(),
        callerId: me,
        calleeId: callee,
        conversationId: String(conv._id),
        callType: p.callType,
        callerDeviceId: auth.deviceId,
        callerTabId: auth.tabId,
        nowMs: now,
        ringTimeoutMs: timing.ringMs,
        connectTimeoutMs: timing.connectMs,
        stateTtlS: CALL_STATE_TTL_S,
      });

      // Hiếm: cuộc gọi ngược chiều vừa kết thúc giữa lúc kiểm và lúc chạy Lua → tính bù (không chặn lời mời đã xử lý).
      if (glare && res.result !== 'GLARE') await deps.limitInvite?.(me).catch(() => undefined);

      if (res.result === 'CALLER_IN_CALL') throw new AppError('CALL_INVALID_STATE', MSG.inCall);

      if (res.result === 'BUSY') {
        await history.insert({
          _id: callId,
          conversationId: conv._id,
          callType: p.callType,
          callerId: new Types.ObjectId(me),
          calleeId: new Types.ObjectId(callee),
          callerDeviceId: auth.deviceId,
          callerTabId: auth.tabId,
          status: 'BUSY',
          endReason: 'BUSY',
          endedAt: new Date(now),
          createdAt: new Date(now),
        });
        metrics.callTransitions.inc({ from: '', to: 'BUSY', endReason: 'BUSY' });
        emitter.toUser(callee, EVENTS.CALL_BUSY, {
          callId: callId.toHexString(),
          caller: await publicOf(me),
          callType: p.callType,
        });
        const rec = await history.findById(callId.toHexString());
        if (rec) await safeSystem(rec);
        throw new AppError('CALL_BUSY', MSG.busy);
      }

      if (res.result === 'GLARE') {
        // Lua đã CAS cuộc gọi ngược chiều → ACCEPTED với tab này là tab đã accept (D-03).
        const s = await state.get(res.callId);
        if (!s) return fail('CALL_NOT_FOUND');
        await history.update(res.callId, {
          status: 'ACCEPTED',
          version: s.version,
          acceptedDeviceId: auth.deviceId,
          acceptedTabId: auth.tabId,
          acceptedAt: new Date(s.acceptedAt ?? now),
        });
        metrics.callTransitions.inc({ from: 'RINGING', to: 'ACCEPTED', endReason: '' });
        announceAccepted(s);
        emitState(stateDto(s, null));
        return { callId: res.callId, status: 'ACCEPTED' as const, merged: true, callType: res.callType };
      }

      await history.insert({
        _id: callId,
        conversationId: conv._id,
        callType: p.callType,
        callerId: new Types.ObjectId(me),
        calleeId: new Types.ObjectId(callee),
        callerDeviceId: auth.deviceId,
        callerTabId: auth.tabId,
        status: 'INITIATED',
        createdAt: new Date(now),
      });
      metrics.callTransitions.inc({ from: '', to: 'INITIATED', endReason: '' });
      const s = await state.get(callId.toHexString());
      if (s) {
        emitState(stateDto(s, null));
        void ringCallee(s);
      }
      return { callId: callId.toHexString(), status: 'INITIATED' as const, merged: false, callType: p.callType };
    },

    /** D-08: callee vừa kết nối → đẩy call:incoming cho cuộc gọi INITIATED đang chờ tới đúng socket này. */
    async deliverPending(
      userId: string,
      send: (payload: Awaited<ReturnType<typeof incomingPayload>>) => Promise<boolean>,
    ) {
      for (const callId of await state.pendingFor(userId)) {
        const s = await state.get(callId);
        if (!s || s.calleeId !== userId || s.status !== 'INITIATED') continue;
        if (await send(await incomingPayload(s))) await onIncomingAck(callId).catch(() => undefined);
      }
    },

    async accept(auth: CallAuth, callId: string) {
      return lostOr(
        callId,
        auth,
        async () => {
          const { s, changed } = await drive(callId, { type: 'ACCEPT' }, auth, () => ({
            acceptedDeviceId: auth.deviceId,
            acceptedTabId: auth.tabId,
            acceptedAt: Date.now(),
          }));
          if (changed) announceAccepted(s);
          return { callId, status: 'ACCEPTED' as const };
        },
        (rec) => fail(rec.status === 'MISSED' ? 'CALL_TIMEOUT' : 'CALL_INVALID_STATE'),
      );
    },

    async reject(auth: CallAuth, callId: string) {
      return lostOr(
        callId,
        auth,
        async () => {
          const { s } = await drive(callId, { type: 'REJECT' }, auth);
          if (s.status !== 'REJECTED') fail('CALL_INVALID_STATE'); // terminal khác REJECTED (ACK chỉ mang REJECTED)
          return { callId, status: 'REJECTED' as const };
        },
        (rec) => (rec.status === 'REJECTED' ? { callId, status: 'REJECTED' as const } : fail('CALL_INVALID_STATE')),
      );
    },

    async cancel(auth: CallAuth, callId: string) {
      return lostOr(
        callId,
        auth,
        async () => ({ callId, status: (await drive(callId, { type: 'CANCEL' }, auth)).s.status }),
        (rec) => ({ callId, status: rec.status }),
      );
    },

    async end(auth: CallAuth, p: { callId: string; reason: 'HANGUP' | 'NETWORK_FAILURE' | 'MEDIA_FAILURE' }) {
      const { callId } = p;
      return lostOr(
        callId,
        auth,
        async () => {
          const { s } = await drive(callId, { type: 'END', reason: p.reason }, auth);
          return { callId, status: s.status, endReason: (s.endReason as CallEndReason | null) ?? null };
        },
        (rec) => ({ callId, status: rec.status, endReason: rec.endReason }),
      );
    },

    /** Báo cáo media (T13, T18–T20, T29); tab tham gia báo lại sau reconnect → hủy deadline PEER của tab. */
    async reportState(auth: CallAuth, p: { callId: string; connectionState: 'connected' | 'disconnected' | 'failed' }) {
      const { callId } = p;
      return lostOr(
        callId,
        auth,
        async () => {
          await state.removeDeadline(`${callId}:PEER:${auth.tabId}`);
          const { s } = await drive(callId, { type: 'STATE_REPORT', connectionState: p.connectionState }, auth);
          return { status: s.status, version: s.version };
        },
        (rec) => ({ status: rec.status, version: rec.version }),
      );
    },

    /** T12, T31: chỉ tab caller, revision = offerRevision + 1; relay tới tab đã accept. */
    async offer(auth: CallAuth, p: { callId: string; revision: number; sdp: string }) {
      const s = await state.get(p.callId);
      if (!s) return fail('CALL_NOT_FOUND');
      const actor = actorOf(s, auth);
      if (!actor) return fail('CALL_NOT_FOUND');
      const r = transition(toMachine(s), { type: 'OFFER', revision: p.revision }, actor);
      if ('error' in r) return fail(r.error);
      if (!(await state.bumpCounter(p.callId, 'offerRevision', p.revision))) return fail('CALL_INVALID_STATE');
      // T12: offer đầu tiên chuyển ACCEPTED → CONNECTING (CAS; thua = trạng thái đã đổi, vẫn relay như T31).
      if ('to' in r) await apply({ ...s, offerRevision: p.revision }, r.to, null);
      if (s.acceptedTabId) emitter.toTab(s.acceptedTabId, EVENTS.CALL_OFFER, p);
      return { revision: p.revision };
    },

    async answer(auth: CallAuth, p: { callId: string; revision: number; sdp: string }) {
      const s = await state.get(p.callId);
      if (!s) return fail('CALL_NOT_FOUND');
      const actor = actorOf(s, auth);
      if (!actor) return fail('CALL_NOT_FOUND');
      const r = transition(toMachine(s), { type: 'ANSWER', revision: p.revision }, actor);
      if ('error' in r) return fail(r.error);
      await state.setFields(p.callId, { answeredRevision: p.revision });
      emitter.toTab(s.callerTabId, EVENTS.CALL_ANSWER, p);
      return { revision: p.revision };
    },

    async iceCandidate(
      auth: CallAuth,
      p: {
        callId: string;
        revision: number;
        candidate: {
          candidate: string;
          sdpMid: string | null;
          sdpMLineIndex: number | null;
          usernameFragment: string | null;
        };
      },
    ) {
      const s = await state.get(p.callId);
      if (!s) return fail('CALL_NOT_FOUND');
      const actor = actorOf(s, auth);
      if (!actor) return fail('CALL_NOT_FOUND');
      const r = transition(toMachine(s), { type: 'ICE_CANDIDATE', revision: p.revision }, actor);
      if ('error' in r) return fail(r.error);
      const target = actor === 'CALLER_TAB' ? s.acceptedTabId : s.callerTabId;
      if (target) emitter.toTab(target, EVENTS.CALL_ICE_CANDIDATE, p);
      return {};
    },

    /** T30: attempt = iceRestarts + 1 ≤ CALL_MAX_ICE_RESTARTS; relay tới tab bên kia (caller tạo offer mới, D-04). */
    async iceRestart(auth: CallAuth, p: { callId: string; attempt: number }) {
      const s = await state.get(p.callId);
      if (!s) return fail('CALL_NOT_FOUND');
      const actor = actorOf(s, auth);
      if (!actor) return fail('CALL_NOT_FOUND');
      const r = transition(toMachine(s), { type: 'ICE_RESTART', attempt: p.attempt }, actor);
      if ('error' in r) return fail(r.error);
      if (!(await state.bumpCounter(p.callId, 'iceRestarts', p.attempt))) return fail('CALL_INVALID_STATE');
      metrics.callIceRestarts.inc({ result: 'requested' });
      await history.setIceRestarts(p.callId, p.attempt);
      const target = actor === 'CALLER_TAB' ? s.acceptedTabId : s.callerTabId;
      if (target) emitter.toTab(target, EVENTS.CALL_ICE_RESTART, p);
      return { attempt: p.attempt };
    },

    /** Socket của tab tham gia ngắt → deadline PEER (§7(f) "Socket signaling rớt nhưng media còn chạy"). */
    async onSocketDisconnect(auth: { userId: string; tabId: string }) {
      const callId = await state.incallOf(auth.userId);
      if (!callId) return;
      const s = await state.get(callId);
      if (!s || isTerminal(s.status)) return;
      const actor = actorOf(s, auth);
      if (actor !== 'CALLER_TAB' && actor !== 'CALLEE_TAB') return;
      await state.addDeadline(`${callId}:PEER:${auth.tabId}`, Date.now() + timing.peerGraceMs);
    },

    /** auth → calls (kiến trúc §5.2): logout / đổi mật khẩu / reuse thu hồi phiên; khóa tài khoản → LOCK. */
    async endCallsForSession(sid: string, cause: 'LOGOUT' | 'LOCK' = 'LOGOUT') {
      await endForTabs(await emitter.socketsIn(sessionRoom(sid)), cause);
    },

    /** ops:user-locked (job user:lock ở process khác, DG-03): T27/T28 cho cuộc gọi của user. */
    async endCallsForUser(userId: string) {
      const callId = await state.incallOf(userId);
      if (!callId) return;
      await drive(callId, { type: 'LOCK' }, 'SERVER').catch((err: unknown) => {
        if (!(err instanceof AppError)) logger.error({ err, callId }, 'không kết thúc được cuộc gọi của user bị khóa');
      });
    },

    /** §8.5 bước 1: callHistory active mồ côi (không còn call:active) → T29. */
    async reconcile(): Promise<number> {
      const before = new Date(Date.now() - (timing.ringMs + timing.connectMs));
      let n = 0;
      for (const rec of await history.findActiveBefore(before, 500)) {
        if (await state.get(String(rec._id))) continue;
        const done = await resolveLost(String(rec._id), String(rec.callerId));
        if (done && isTerminal(done.status)) n += 1;
      }
      return n;
    },

    /** FR-CALL-008: lịch sử của tôi, mới nhất trước; `direction` theo người xem. */
    async list(me: string, q: { cursor?: string | undefined; limit: number }): Promise<CallPage> {
      let cursor: { at: Date; id: Types.ObjectId } | null = null;
      if (q.cursor) {
        try {
          const c = decodeCursor(q.cursor);
          cursor = { at: new Date(c.createdAt), id: new Types.ObjectId(c.id) };
        } catch {
          throw new AppError('VALIDATION_ERROR', MSG.badCursor);
        }
      }
      const limit = Math.min(q.limit, CALL_PAGE_MAX);
      const docs = await history.page(me, cursor, limit);
      const page = docs.slice(0, limit);
      const peerIds = [...new Set(page.map((d) => String(String(d.callerId) === me ? d.calleeId : d.callerId)))];
      const peers = await users.getPublicMany(peerIds);
      const items: CallRecord[] = page.flatMap((d) => {
        const outgoing = String(d.callerId) === me;
        const peer = peers.get(String(outgoing ? d.calleeId : d.callerId))?.user;
        if (!peer) return [];
        return [
          {
            id: String(d._id),
            conversationId: String(d.conversationId),
            callType: d.callType,
            direction: outgoing ? 'OUTGOING' : 'INCOMING',
            peer,
            status: d.status,
            endReason: d.endReason,
            createdAt: d.createdAt.toISOString(),
            connectedAt: d.connectedAt ? d.connectedAt.toISOString() : null,
            endedAt: d.endedAt ? d.endedAt.toISOString() : null,
            durationSec: d.durationSec,
          },
        ];
      });
      const last = page[page.length - 1];
      return {
        items,
        nextCursor:
          docs.length > limit && last
            ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: String(last._id) })
            : null,
      };
    },

    onDeadline,
    start: sweeper.start,
    stop: sweeper.stop,
  };
}

export type CallsService = ReturnType<typeof createCallsService>;
