// server/src/modules/calls/call.state-machine.ts — bảng chuyển trạng thái cuộc gọi (kiến trúc §8.2) và deadline (§8.3).
// Hàm thuần, không I/O: calls.service xác định actor (AUTHZ-6) rồi hỏi bảng này để biết đích, lỗi hay noop; CAS thật
// chạy ở call-transition.lua với expectedFrom = trạng thái đã đọc.
import { CALL_MAX_ICE_RESTARTS, CALL_TERMINAL_STATUSES } from '@hustalo/shared';
import type { CallEndReason, CallStatus, ErrorCode } from '@hustalo/shared';

/**
 * Vai trò của tab gửi event so với cuộc gọi. CALLEE_ANY (§8.2) = CALLEE_TAB | CALLEE_OTHER_TAB;
 * PARTICIPANT = CALLER_TAB | CALLEE_TAB. User không phải caller/callee bị chặn ở service (CALL_NOT_FOUND).
 */
export type CallActor = 'CALLER_TAB' | 'CALLER_OTHER_TAB' | 'CALLEE_TAB' | 'CALLEE_OTHER_TAB' | 'SERVER';

export type CallDeadlineKind = 'RING' | 'CONNECT' | 'RECONNECT' | 'PEER';

export type CallEvent =
  | { type: 'INVITE'; callerInCall: boolean; calleeBusy: boolean }
  | { type: 'INVITE_GLARE' }
  | { type: 'INCOMING_ACK' }
  | { type: 'ACCEPT' }
  | { type: 'REJECT' }
  | { type: 'CANCEL' }
  | { type: 'END'; reason: 'HANGUP' | 'NETWORK_FAILURE' | 'MEDIA_FAILURE' }
  | { type: 'STATE_REPORT'; connectionState: 'connected' | 'disconnected' | 'failed' }
  | { type: 'OFFER'; revision: number }
  | { type: 'ANSWER'; revision: number }
  | { type: 'ICE_CANDIDATE'; revision: number }
  | { type: 'ICE_RESTART'; attempt: number }
  /** PEER: `peer` là vai trò của tab có socket đã mất quá grace. */
  | { type: 'DEADLINE'; kind: CallDeadlineKind; peer?: 'CALLER_TAB' | 'CALLEE_TAB' }
  /** Logout/thu hồi phiên chứa tab `tab` (T11, T27). */
  | { type: 'LOGOUT'; tab: Exclude<CallActor, 'SERVER'> }
  /** Khóa tài khoản caller hoặc callee (T27, T28). */
  | { type: 'LOCK' }
  /** call:active đã mất nhưng callHistory chưa terminal (T29, §8.5). */
  | { type: 'STATE_LOST' };

export interface CallMachineState {
  status: CallStatus;
  offerRevision: number;
  answeredRevision: number;
  iceRestarts: number;
  connected: boolean; // đã từng CONNECTED (connectedAt != null)
}

export type TransitionResult =
  { to: CallStatus; endReason: CallEndReason | null } | { error: ErrorCode } | { noop: true };

const RINGING_PHASE: readonly CallStatus[] = ['INITIATED', 'RINGING'];
const SETUP_PHASE: readonly CallStatus[] = ['ACCEPTED', 'CONNECTING'];
const LIVE_PHASE: readonly CallStatus[] = ['CONNECTED', 'RECONNECTING'];

export const isTerminal = (s: CallStatus) => CALL_TERMINAL_STATUSES.includes(s);

const to = (status: CallStatus, endReason: CallEndReason | null = null): TransitionResult => ({
  to: status,
  endReason,
});
const err = (error: ErrorCode): TransitionResult => ({ error });
const NOOP: TransitionResult = { noop: true };

const isParticipant = (a: CallActor) => a === 'CALLER_TAB' || a === 'CALLEE_TAB';
const isCallee = (a: CallActor) => a === 'CALLEE_TAB' || a === 'CALLEE_OTHER_TAB';

/** Kết thúc do người dùng sau ACCEPTED: SETUP → FAILED (trừ HANGUP), LIVE → ENDED (T15–T17, T21–T23). */
function endAfterAccept(status: CallStatus, reason: 'HANGUP' | 'NETWORK_FAILURE' | 'MEDIA_FAILURE'): TransitionResult {
  if (reason === 'HANGUP') return to('ENDED', 'HANGUP');
  return SETUP_PHASE.includes(status) ? to('FAILED', reason) : to('ENDED', reason);
}

/** Kết thúc do server sau ACCEPTED: SETUP → FAILED, LIVE → ENDED (T25/T26, T27). */
const serverEndAfterAccept = (status: CallStatus, reason: CallEndReason) =>
  SETUP_PHASE.includes(status) ? to('FAILED', reason) : to('ENDED', reason);

export function transition(state: CallMachineState | null, event: CallEvent, actor: CallActor): TransitionResult {
  // T01/T02: tạo cuộc gọi (chưa có state). Mọi event khác cho callId không tồn tại → T36.
  if (state === null) {
    if (event.type !== 'INVITE') return err('CALL_NOT_FOUND');
    if (event.callerInCall) return err('CALL_INVALID_STATE');
    return event.calleeBusy ? to('BUSY', 'BUSY') : to('INITIATED');
  }

  const { status } = state;
  const terminal = isTerminal(status);
  const ringing = RINGING_PHASE.includes(status);
  const setup = SETUP_PHASE.includes(status);
  const live = LIVE_PHASE.includes(status);

  switch (event.type) {
    case 'INVITE':
      // Người đã có cuộc gọi live gửi invite mới → bận chính mình (7(g): sau ACCEPTED → CALL_INVALID_STATE).
      return err('CALL_INVALID_STATE');

    case 'INVITE_GLARE': // T05
      if (!isCallee(actor)) return err('FORBIDDEN');
      return ringing ? to('ACCEPTED') : err('CALL_INVALID_STATE');

    case 'INCOMING_ACK': // T03
      if (actor !== 'SERVER') return err('FORBIDDEN');
      return status === 'INITIATED' ? to('RINGING') : NOOP;

    case 'ACCEPT':
      if (!isCallee(actor)) return err('FORBIDDEN');
      if (ringing) return to('ACCEPTED'); // T04
      if (terminal) return err(status === 'MISSED' ? 'CALL_TIMEOUT' : 'CALL_INVALID_STATE'); // T33
      return actor === 'CALLEE_TAB' ? NOOP : err('CALL_ALREADY_ANSWERED'); // T34

    case 'REJECT':
      if (!isCallee(actor)) return err('FORBIDDEN');
      if (terminal) return NOOP; // T32
      return ringing ? to('REJECTED', 'REJECTED') : err('CALL_INVALID_STATE'); // T06

    case 'CANCEL':
      if (terminal) return actor === 'SERVER' ? err('FORBIDDEN') : NOOP; // T32
      if (ringing) return actor === 'CALLER_TAB' ? to('CANCELLED', 'CANCELLED') : err('FORBIDDEN'); // T07
      return isParticipant(actor) ? to('ENDED', 'HANGUP') : err('FORBIDDEN'); // T15, T21

    case 'END':
      if (terminal) return actor === 'SERVER' ? err('FORBIDDEN') : NOOP; // T32
      if (ringing) {
        if (event.reason === 'MEDIA_FAILURE' && (actor === 'CALLER_TAB' || isCallee(actor))) {
          return to('FAILED', 'MEDIA_FAILURE'); // T09
        }
        if (actor === 'CALLER_TAB') {
          return event.reason === 'HANGUP' ? to('CANCELLED', 'CANCELLED') : err('CALL_INVALID_STATE'); // T07
        }
        return err('FORBIDDEN');
      }
      return isParticipant(actor) ? endAfterAccept(status, event.reason) : err('FORBIDDEN');

    case 'STATE_REPORT': {
      if (terminal) return actor === 'SERVER' ? err('FORBIDDEN') : NOOP; // T32
      if (ringing) return actor === 'CALLER_TAB' ? NOOP : err('FORBIDDEN'); // tab caller reconnect: hủy PEER
      if (!isParticipant(actor)) return err('FORBIDDEN');
      const up = event.connectionState === 'connected';
      if (setup) return up ? to('CONNECTED') : NOOP; // T13, T18
      if (status === 'CONNECTED') return up ? NOOP : to('RECONNECTING'); // T19
      return up ? to('CONNECTED') : NOOP; // T20 (RECONNECTING)
    }

    case 'OFFER': // T12, T31, T35
      if (actor !== 'CALLER_TAB') return err('FORBIDDEN');
      if (!(setup || live) || event.revision !== state.offerRevision + 1) return err('CALL_INVALID_STATE');
      return status === 'ACCEPTED' ? to('CONNECTING') : NOOP;

    case 'ANSWER': // T35
      if (actor !== 'CALLEE_TAB') return err('FORBIDDEN');
      if (
        !(status === 'CONNECTING' || live) ||
        event.revision !== state.offerRevision ||
        state.answeredRevision >= event.revision
      ) {
        return err('CALL_INVALID_STATE');
      }
      return NOOP;

    case 'ICE_CANDIDATE': // T35
      if (!isParticipant(actor)) return err('FORBIDDEN');
      return !terminal && event.revision === state.offerRevision ? NOOP : err('CALL_INVALID_STATE');

    case 'ICE_RESTART': // T30
      if (!isParticipant(actor)) return err('FORBIDDEN');
      if (
        !(status === 'CONNECTING' || live) ||
        event.attempt !== state.iceRestarts + 1 ||
        event.attempt > CALL_MAX_ICE_RESTARTS
      ) {
        return err('CALL_INVALID_STATE');
      }
      return NOOP;

    case 'DEADLINE':
      if (actor !== 'SERVER') return err('FORBIDDEN');
      // CAS thất bại = deadline cũ → noop (§8.3).
      if (event.kind === 'RING') return ringing ? to('MISSED', 'TIMEOUT') : NOOP; // T08
      if (event.kind === 'CONNECT') return setup ? to('FAILED', 'NETWORK_FAILURE') : NOOP; // T14
      if (event.kind === 'RECONNECT') return status === 'RECONNECTING' ? to('ENDED', 'NETWORK_FAILURE') : NOOP; // T24
      if (ringing) return event.peer === 'CALLER_TAB' ? to('CANCELLED', 'PEER_DISCONNECTED') : NOOP; // T10
      return setup || live ? serverEndAfterAccept(status, 'PEER_DISCONNECTED') : NOOP; // T25, T26

    case 'LOGOUT':
      if (actor !== 'SERVER') return err('FORBIDDEN');
      if (ringing) return event.tab === 'CALLER_TAB' ? to('CANCELLED', 'LOGOUT') : NOOP; // T11
      if (setup || live) return isParticipant(event.tab) ? to('ENDED', 'LOGOUT') : NOOP; // T27
      return NOOP;

    case 'LOCK':
      if (actor !== 'SERVER') return err('FORBIDDEN');
      if (ringing) return to('FAILED', 'LOGOUT'); // T28
      return setup || live ? to('ENDED', 'LOGOUT') : NOOP; // T27

    case 'STATE_LOST': // T29
      if (actor !== 'SERVER') return err('FORBIDDEN');
      if (terminal) return NOOP;
      return state.connected ? to('ENDED', 'SERVER_RESTART') : to('FAILED', 'SERVER_RESTART');
  }
}

/** Deadline đặt/xóa đi kèm một chuyển trạng thái (§8.3). Terminal: call-transition.lua tự xóa mọi deadline của call. */
export function deadlineOps(
  from: CallStatus | null,
  next: CallStatus,
): { remove: CallDeadlineKind[]; add: Exclude<CallDeadlineKind, 'PEER'>[] } {
  if (isTerminal(next)) return { remove: [], add: [] };
  if (next === 'INITIATED') return { remove: [], add: ['RING'] };
  if (next === 'ACCEPTED') return { remove: ['RING'], add: ['CONNECT'] };
  if (next === 'RECONNECTING') return { remove: [], add: ['RECONNECT'] };
  if (next === 'CONNECTED') return { remove: from === 'RECONNECTING' ? ['RECONNECT'] : ['CONNECT'], add: [] };
  return { remove: [], add: [] }; // RINGING giữ RING; CONNECTING giữ CONNECT
}
