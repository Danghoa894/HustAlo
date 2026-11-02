// Bảng kỳ vọng chép từ kiến trúc §8.2 (độc lập với code): mỗi hàng T01–T36 ít nhất một test, và mọi cặp
// (status, event, actor) không có trong bảng phải trả lỗi hoặc noop (AC-ARCH-008).
import { CALL_MAX_ICE_RESTARTS, CallStatus, type CallEndReason } from '@hustalo/shared';
import { describe, expect, it } from 'vitest';
import {
  deadlineOps,
  transition,
  type CallActor,
  type CallEvent,
  type CallMachineState,
  type TransitionResult,
} from './call.state-machine';

const ALL: CallStatus[] = Object.values(CallStatus);
const TERMINAL: CallStatus[] = ['ENDED', 'REJECTED', 'CANCELLED', 'MISSED', 'BUSY', 'FAILED'];
const ACTORS: CallActor[] = ['CALLER_TAB', 'CALLER_OTHER_TAB', 'CALLEE_TAB', 'CALLEE_OTHER_TAB', 'SERVER'];
const CALLEE_ANY: CallActor[] = ['CALLEE_TAB', 'CALLEE_OTHER_TAB'];
const PARTICIPANT: CallActor[] = ['CALLER_TAB', 'CALLEE_TAB'];

const st = (status: CallStatus, over: Partial<CallMachineState> = {}): CallMachineState => ({
  status,
  offerRevision: 0,
  answeredRevision: 0,
  iceRestarts: 0,
  // CONNECTED/RECONNECTING luôn đã có connectedAt; trạng thái khác thì chưa (terminal xét theo `over`).
  connected: status === 'CONNECTED' || status === 'RECONNECTING',
  ...over,
});
const go = (status: CallStatus, endReason: CallEndReason | null = null): TransitionResult => ({
  to: status,
  endReason,
});
const NOOP = { noop: true };

// ---- Oracle: mọi chuyển trạng thái hợp lệ của §8.2 (from, event, actor) → to ----
interface Row {
  id: string;
  from: CallStatus[];
  event: CallEvent;
  actors: CallActor[];
  state?: Partial<CallMachineState>;
  expect: TransitionResult;
}

const ROWS: Row[] = [
  { id: 'T03', from: ['INITIATED'], event: { type: 'INCOMING_ACK' }, actors: ['SERVER'], expect: go('RINGING') },
  {
    id: 'T04',
    from: ['INITIATED', 'RINGING'],
    event: { type: 'ACCEPT' },
    actors: CALLEE_ANY,
    expect: go('ACCEPTED'),
  },
  {
    id: 'T05',
    from: ['INITIATED', 'RINGING'],
    event: { type: 'INVITE_GLARE' },
    actors: CALLEE_ANY,
    expect: go('ACCEPTED'),
  },
  {
    id: 'T06',
    from: ['INITIATED', 'RINGING'],
    event: { type: 'REJECT' },
    actors: CALLEE_ANY,
    expect: go('REJECTED', 'REJECTED'),
  },
  {
    id: 'T07',
    from: ['INITIATED', 'RINGING'],
    event: { type: 'CANCEL' },
    actors: ['CALLER_TAB'],
    expect: go('CANCELLED', 'CANCELLED'),
  },
  {
    id: 'T07',
    from: ['INITIATED', 'RINGING'],
    event: { type: 'END', reason: 'HANGUP' },
    actors: ['CALLER_TAB'],
    expect: go('CANCELLED', 'CANCELLED'),
  },
  {
    id: 'T08',
    from: ['INITIATED', 'RINGING'],
    event: { type: 'DEADLINE', kind: 'RING' },
    actors: ['SERVER'],
    expect: go('MISSED', 'TIMEOUT'),
  },
  {
    id: 'T09',
    from: ['INITIATED', 'RINGING'],
    event: { type: 'END', reason: 'MEDIA_FAILURE' },
    actors: ['CALLER_TAB', ...CALLEE_ANY],
    expect: go('FAILED', 'MEDIA_FAILURE'),
  },
  {
    id: 'T10',
    from: ['INITIATED', 'RINGING'],
    event: { type: 'DEADLINE', kind: 'PEER', peer: 'CALLER_TAB' },
    actors: ['SERVER'],
    expect: go('CANCELLED', 'PEER_DISCONNECTED'),
  },
  {
    id: 'T11',
    from: ['INITIATED', 'RINGING'],
    event: { type: 'LOGOUT', tab: 'CALLER_TAB' },
    actors: ['SERVER'],
    expect: go('CANCELLED', 'LOGOUT'),
  },
  {
    id: 'T12',
    from: ['ACCEPTED'],
    event: { type: 'OFFER', revision: 1 },
    actors: ['CALLER_TAB'],
    expect: go('CONNECTING'),
  },
  {
    id: 'T13',
    from: ['ACCEPTED', 'CONNECTING'],
    event: { type: 'STATE_REPORT', connectionState: 'connected' },
    actors: PARTICIPANT,
    expect: go('CONNECTED'),
  },
  {
    id: 'T14',
    from: ['ACCEPTED', 'CONNECTING'],
    event: { type: 'DEADLINE', kind: 'CONNECT' },
    actors: ['SERVER'],
    expect: go('FAILED', 'NETWORK_FAILURE'),
  },
  {
    id: 'T15',
    from: ['ACCEPTED', 'CONNECTING'],
    event: { type: 'END', reason: 'HANGUP' },
    actors: PARTICIPANT,
    expect: go('ENDED', 'HANGUP'),
  },
  {
    id: 'T15',
    from: ['ACCEPTED', 'CONNECTING'],
    event: { type: 'CANCEL' },
    actors: PARTICIPANT,
    expect: go('ENDED', 'HANGUP'),
  },
  {
    id: 'T16',
    from: ['ACCEPTED', 'CONNECTING'],
    event: { type: 'END', reason: 'MEDIA_FAILURE' },
    actors: PARTICIPANT,
    expect: go('FAILED', 'MEDIA_FAILURE'),
  },
  {
    id: 'T17',
    from: ['ACCEPTED', 'CONNECTING'],
    event: { type: 'END', reason: 'NETWORK_FAILURE' },
    actors: PARTICIPANT,
    expect: go('FAILED', 'NETWORK_FAILURE'),
  },
  {
    id: 'T19',
    from: ['CONNECTED'],
    event: { type: 'STATE_REPORT', connectionState: 'disconnected' },
    actors: PARTICIPANT,
    expect: go('RECONNECTING'),
  },
  {
    id: 'T19',
    from: ['CONNECTED'],
    event: { type: 'STATE_REPORT', connectionState: 'failed' },
    actors: PARTICIPANT,
    expect: go('RECONNECTING'),
  },
  {
    id: 'T20',
    from: ['RECONNECTING'],
    event: { type: 'STATE_REPORT', connectionState: 'connected' },
    actors: PARTICIPANT,
    expect: go('CONNECTED'),
  },
  {
    id: 'T21',
    from: ['CONNECTED', 'RECONNECTING'],
    event: { type: 'END', reason: 'HANGUP' },
    actors: PARTICIPANT,
    expect: go('ENDED', 'HANGUP'),
  },
  {
    id: 'T21',
    from: ['CONNECTED', 'RECONNECTING'],
    event: { type: 'CANCEL' },
    actors: PARTICIPANT,
    expect: go('ENDED', 'HANGUP'),
  },
  {
    id: 'T22',
    from: ['CONNECTED', 'RECONNECTING'],
    event: { type: 'END', reason: 'MEDIA_FAILURE' },
    actors: PARTICIPANT,
    expect: go('ENDED', 'MEDIA_FAILURE'),
  },
  {
    id: 'T23',
    from: ['CONNECTED', 'RECONNECTING'],
    event: { type: 'END', reason: 'NETWORK_FAILURE' },
    actors: PARTICIPANT,
    expect: go('ENDED', 'NETWORK_FAILURE'),
  },
  {
    id: 'T24',
    from: ['RECONNECTING'],
    event: { type: 'DEADLINE', kind: 'RECONNECT' },
    actors: ['SERVER'],
    expect: go('ENDED', 'NETWORK_FAILURE'),
  },
  ...(['CALLER_TAB', 'CALLEE_TAB'] as const).flatMap((peer): Row[] => [
    {
      id: 'T25',
      from: ['ACCEPTED', 'CONNECTING'],
      event: { type: 'DEADLINE', kind: 'PEER', peer },
      actors: ['SERVER'],
      expect: go('FAILED', 'PEER_DISCONNECTED'),
    },
    {
      id: 'T26',
      from: ['CONNECTED', 'RECONNECTING'],
      event: { type: 'DEADLINE', kind: 'PEER', peer },
      actors: ['SERVER'],
      expect: go('ENDED', 'PEER_DISCONNECTED'),
    },
    {
      id: 'T27',
      from: ['ACCEPTED', 'CONNECTING', 'CONNECTED', 'RECONNECTING'],
      event: { type: 'LOGOUT', tab: peer },
      actors: ['SERVER'],
      expect: go('ENDED', 'LOGOUT'),
    },
  ]),
  {
    id: 'T27',
    from: ['ACCEPTED', 'CONNECTING', 'CONNECTED', 'RECONNECTING'],
    event: { type: 'LOCK' },
    actors: ['SERVER'],
    expect: go('ENDED', 'LOGOUT'),
  },
  {
    id: 'T28',
    from: ['INITIATED', 'RINGING'],
    event: { type: 'LOCK' },
    actors: ['SERVER'],
    expect: go('FAILED', 'LOGOUT'),
  },
  {
    id: 'T29',
    from: ['INITIATED', 'RINGING', 'ACCEPTED', 'CONNECTING'],
    event: { type: 'STATE_LOST' },
    actors: ['SERVER'],
    expect: go('FAILED', 'SERVER_RESTART'),
  },
  {
    id: 'T29',
    from: ['CONNECTED', 'RECONNECTING'],
    event: { type: 'STATE_LOST' },
    actors: ['SERVER'],
    expect: go('ENDED', 'SERVER_RESTART'),
  },
];

const isTransition = (r: TransitionResult): r is { to: CallStatus; endReason: CallEndReason | null } => 'to' in r;

// Event mẫu cho tích chéo (revision/attempt hợp lệ với state mặc định, để chỉ còn status/actor quyết định).
const SAMPLE_EVENTS: CallEvent[] = [
  { type: 'INVITE', callerInCall: false, calleeBusy: false },
  { type: 'INVITE_GLARE' },
  { type: 'INCOMING_ACK' },
  { type: 'ACCEPT' },
  { type: 'REJECT' },
  { type: 'CANCEL' },
  { type: 'END', reason: 'HANGUP' },
  { type: 'END', reason: 'NETWORK_FAILURE' },
  { type: 'END', reason: 'MEDIA_FAILURE' },
  { type: 'STATE_REPORT', connectionState: 'connected' },
  { type: 'STATE_REPORT', connectionState: 'disconnected' },
  { type: 'STATE_REPORT', connectionState: 'failed' },
  { type: 'OFFER', revision: 1 },
  { type: 'ANSWER', revision: 1 },
  { type: 'ICE_CANDIDATE', revision: 1 },
  { type: 'ICE_RESTART', attempt: 1 },
  { type: 'DEADLINE', kind: 'RING' },
  { type: 'DEADLINE', kind: 'CONNECT' },
  { type: 'DEADLINE', kind: 'RECONNECT' },
  { type: 'DEADLINE', kind: 'PEER', peer: 'CALLER_TAB' },
  { type: 'DEADLINE', kind: 'PEER', peer: 'CALLEE_TAB' },
  { type: 'LOGOUT', tab: 'CALLER_TAB' },
  { type: 'LOGOUT', tab: 'CALLER_OTHER_TAB' },
  { type: 'LOGOUT', tab: 'CALLEE_TAB' },
  { type: 'LOGOUT', tab: 'CALLEE_OTHER_TAB' },
  { type: 'LOCK' },
  { type: 'STATE_LOST' },
];

describe('call.state-machine — bảng §8.2 (TC-ARCH-008)', () => {
  it('TC-ARCH-008 T01 invite hợp lệ, chưa có state → INITIATED', () => {
    expect(transition(null, { type: 'INVITE', callerInCall: false, calleeBusy: false }, 'CALLER_TAB')).toEqual(
      go('INITIATED'),
    );
  });

  it('TC-ARCH-008 TC-CALL-SIG-002 T02 callee bận → BUSY/BUSY; caller đang trong cuộc gọi khác → CALL_INVALID_STATE', () => {
    expect(transition(null, { type: 'INVITE', callerInCall: false, calleeBusy: true }, 'CALLER_TAB')).toEqual(
      go('BUSY', 'BUSY'),
    );
    expect(transition(null, { type: 'INVITE', callerInCall: true, calleeBusy: false }, 'CALLER_TAB')).toEqual({
      error: 'CALL_INVALID_STATE',
    });
  });

  for (const row of ROWS) {
    const label = `${row.event.type}${'reason' in row.event ? `{${row.event.reason}}` : ''}${
      'connectionState' in row.event ? `{${row.event.connectionState}}` : ''
    }${'kind' in row.event ? `{${row.event.kind}${row.event.peer ? `:${row.event.peer}` : ''}}` : ''}${
      'tab' in row.event ? `{${row.event.tab}}` : ''
    }`;
    it(`TC-ARCH-008 ${row.id} ${row.from.join('|')} + ${label} bởi ${row.actors.join('|')} → ${
      isTransition(row.expect) ? `${row.expect.to}/${row.expect.endReason ?? '—'}` : 'noop'
    }`, () => {
      for (const from of row.from) {
        for (const actor of row.actors) {
          expect(transition(st(from, row.state), row.event, actor), `${from} ${actor}`).toEqual(row.expect);
        }
      }
    });
  }

  it('TC-ARCH-008 T18 ACCEPTED/CONNECTING + call:state{disconnected|failed} → giữ nguyên (noop)', () => {
    for (const from of ['ACCEPTED', 'CONNECTING'] as const) {
      for (const cs of ['disconnected', 'failed'] as const) {
        for (const actor of PARTICIPANT) {
          expect(transition(st(from), { type: 'STATE_REPORT', connectionState: cs }, actor)).toEqual(NOOP);
        }
      }
    }
  });

  it('TC-ARCH-008 TC-CALL-NET-010 T30 ice-restart attempt = iceRestarts+1 ≤ 2 → noop (relay); lần 3 → CALL_INVALID_STATE', () => {
    for (const from of ['CONNECTING', 'CONNECTED', 'RECONNECTING'] as const) {
      for (const actor of PARTICIPANT) {
        expect(transition(st(from), { type: 'ICE_RESTART', attempt: 1 }, actor)).toEqual(NOOP);
        expect(transition(st(from, { iceRestarts: 1 }), { type: 'ICE_RESTART', attempt: 2 }, actor)).toEqual(NOOP);
      }
    }
    const max = CALL_MAX_ICE_RESTARTS;
    expect(
      transition(st('CONNECTED', { iceRestarts: max }), { type: 'ICE_RESTART', attempt: max + 1 }, 'CALLER_TAB'),
    ).toEqual({ error: 'CALL_INVALID_STATE' });
    // attempt trùng (hai bên cùng gửi, cái sau thua — 7(f))
    expect(transition(st('CONNECTED', { iceRestarts: 1 }), { type: 'ICE_RESTART', attempt: 1 }, 'CALLEE_TAB')).toEqual({
      error: 'CALL_INVALID_STATE',
    });
    expect(transition(st('ACCEPTED'), { type: 'ICE_RESTART', attempt: 1 }, 'CALLER_TAB')).toEqual({
      error: 'CALL_INVALID_STATE',
    });
  });

  it('TC-ARCH-008 T31 CONNECTING/CONNECTED/RECONNECTING + offer revision n+1 từ tab caller → giữ nguyên (relay)', () => {
    for (const from of ['CONNECTING', 'CONNECTED', 'RECONNECTING'] as const) {
      expect(transition(st(from, { offerRevision: 1 }), { type: 'OFFER', revision: 2 }, 'CALLER_TAB')).toEqual(NOOP);
    }
  });

  it('TC-ARCH-008 TC-CALL-SIG-015 T32 terminal + end/cancel/reject/state → noop (idempotent, không phát lại)', () => {
    const events: CallEvent[] = [
      { type: 'END', reason: 'HANGUP' },
      { type: 'CANCEL' },
      { type: 'REJECT' },
      { type: 'STATE_REPORT', connectionState: 'connected' },
    ];
    for (const from of TERMINAL) {
      for (const ev of events) {
        const actors = ev.type === 'REJECT' ? CALLEE_ANY : ACTORS.filter((a) => a !== 'SERVER');
        for (const actor of actors) expect(transition(st(from), ev, actor), `${from} ${ev.type}`).toEqual(NOOP);
      }
    }
  });

  it('TC-ARCH-008 TC-CALL-SIG-006 T33 terminal + accept: MISSED → CALL_TIMEOUT; terminal khác → CALL_INVALID_STATE', () => {
    for (const from of TERMINAL) {
      for (const actor of CALLEE_ANY) {
        expect(transition(st(from), { type: 'ACCEPT' }, actor)).toEqual({
          error: from === 'MISSED' ? 'CALL_TIMEOUT' : 'CALL_INVALID_STATE',
        });
      }
    }
  });

  it('TC-ARCH-008 TC-CALL-SIG-016 T34 đã ACCEPTED: tab khác của callee → CALL_ALREADY_ANSWERED; chính tab đã accept → noop', () => {
    for (const from of ['ACCEPTED', 'CONNECTING', 'CONNECTED', 'RECONNECTING'] as const) {
      expect(transition(st(from), { type: 'ACCEPT' }, 'CALLEE_OTHER_TAB')).toEqual({ error: 'CALL_ALREADY_ANSWERED' });
      expect(transition(st(from), { type: 'ACCEPT' }, 'CALLEE_TAB')).toEqual(NOOP);
    }
  });

  it('TC-ARCH-008 TC-CALL-SIG-007 T35 revision/role sai → CALL_INVALID_STATE; sai role → FORBIDDEN', () => {
    // offer: chỉ tab caller, revision = offerRevision + 1
    expect(transition(st('ACCEPTED'), { type: 'OFFER', revision: 2 }, 'CALLER_TAB')).toEqual({
      error: 'CALL_INVALID_STATE',
    });
    expect(transition(st('CONNECTED', { offerRevision: 2 }), { type: 'OFFER', revision: 2 }, 'CALLER_TAB')).toEqual({
      error: 'CALL_INVALID_STATE',
    });
    expect(transition(st('ACCEPTED'), { type: 'OFFER', revision: 1 }, 'CALLEE_TAB')).toEqual({ error: 'FORBIDDEN' });
    expect(transition(st('RINGING'), { type: 'OFFER', revision: 1 }, 'CALLER_TAB')).toEqual({
      error: 'CALL_INVALID_STATE',
    });
    // answer: chỉ tab đã accept, revision == offerRevision, chưa answer revision đó
    expect(transition(st('CONNECTING', { offerRevision: 1 }), { type: 'ANSWER', revision: 1 }, 'CALLEE_TAB')).toEqual(
      NOOP,
    );
    expect(
      transition(
        st('CONNECTING', { offerRevision: 1, answeredRevision: 1 }),
        { type: 'ANSWER', revision: 1 },
        'CALLEE_TAB',
      ),
    ).toEqual({ error: 'CALL_INVALID_STATE' });
    expect(transition(st('CONNECTED', { offerRevision: 2 }), { type: 'ANSWER', revision: 1 }, 'CALLEE_TAB')).toEqual({
      error: 'CALL_INVALID_STATE',
    });
    expect(transition(st('ACCEPTED'), { type: 'ANSWER', revision: 1 }, 'CALLEE_TAB')).toEqual({
      error: 'CALL_INVALID_STATE',
    });
    expect(transition(st('CONNECTING', { offerRevision: 1 }), { type: 'ANSWER', revision: 1 }, 'CALLER_TAB')).toEqual({
      error: 'FORBIDDEN',
    });
    // ice-candidate: 2 tab tham gia, revision == offerRevision, không terminal (EC-CALL-SIG-010 candidate cũ)
    expect(
      transition(st('CONNECTED', { offerRevision: 2 }), { type: 'ICE_CANDIDATE', revision: 1 }, 'CALLER_TAB'),
    ).toEqual({ error: 'CALL_INVALID_STATE' });
    expect(
      transition(st('CONNECTED', { offerRevision: 2 }), { type: 'ICE_CANDIDATE', revision: 2 }, 'CALLEE_TAB'),
    ).toEqual(NOOP);
    expect(
      transition(st('CONNECTED', { offerRevision: 1 }), { type: 'ICE_CANDIDATE', revision: 1 }, 'CALLEE_OTHER_TAB'),
    ).toEqual({ error: 'FORBIDDEN' });
    expect(transition(st('ENDED', { offerRevision: 1 }), { type: 'ICE_CANDIDATE', revision: 1 }, 'CALLER_TAB')).toEqual(
      { error: 'CALL_INVALID_STATE' },
    );
    // ice-restart từ tab không tham gia
    expect(transition(st('CONNECTED'), { type: 'ICE_RESTART', attempt: 1 }, 'CALLER_OTHER_TAB')).toEqual({
      error: 'FORBIDDEN',
    });
  });

  it('TC-ARCH-008 TC-CALL-SIG-010 T36 event cho callId không có state → CALL_NOT_FOUND', () => {
    for (const ev of SAMPLE_EVENTS.filter((e) => e.type !== 'INVITE')) {
      expect(transition(null, ev, 'CALLER_TAB'), ev.type).toEqual({ error: 'CALL_NOT_FOUND' });
    }
  });

  it('TC-ARCH-008 TC-CALL-SIG-005 accept và cancel đua: bên đến sau thua (cancel sau accept → HANGUP; accept sau cancel → CALL_INVALID_STATE)', () => {
    expect(transition(st('ACCEPTED'), { type: 'CANCEL' }, 'CALLER_TAB')).toEqual(go('ENDED', 'HANGUP'));
    expect(transition(st('CANCELLED'), { type: 'ACCEPT' }, 'CALLEE_OTHER_TAB')).toEqual({
      error: 'CALL_INVALID_STATE',
    });
  });

  it('TC-ARCH-008 mọi cặp (status, event, actor) ngoài bảng → lỗi hoặc noop, không bao giờ chuyển trạng thái lạ', () => {
    const allowed = new Map<string, TransitionResult>();
    const key = (from: CallStatus, ev: CallEvent, actor: CallActor) => `${from}|${JSON.stringify(ev)}|${actor}`;
    for (const row of ROWS) {
      if (row.state) continue; // T29 có connected=true xét riêng
      for (const from of row.from) for (const actor of row.actors) allowed.set(key(from, row.event, actor), row.expect);
    }
    let checked = 0;
    for (const from of ALL) {
      for (const ev of SAMPLE_EVENTS) {
        for (const actor of ACTORS) {
          const res = transition(st(from), ev, actor);
          checked += 1;
          const exp = allowed.get(key(from, ev, actor));
          if (exp) expect(res, key(from, ev, actor)).toEqual(exp);
          else
            expect(isTransition(res), `không được chuyển: ${key(from, ev, actor)} → ${JSON.stringify(res)}`).toBe(
              false,
            );
        }
      }
    }
    expect(checked).toBe(ALL.length * SAMPLE_EVENTS.length * ACTORS.length);
  });

  it('TC-ARCH-008 event của client không bao giờ được gửi bởi SERVER và ngược lại (FORBIDDEN)', () => {
    const serverOnly: CallEvent[] = [
      { type: 'INCOMING_ACK' },
      { type: 'DEADLINE', kind: 'RING' },
      { type: 'LOGOUT', tab: 'CALLER_TAB' },
      { type: 'LOCK' },
      { type: 'STATE_LOST' },
    ];
    for (const ev of serverOnly) expect(transition(st('RINGING'), ev, 'CALLER_TAB')).toEqual({ error: 'FORBIDDEN' });
    for (const ev of [
      { type: 'CANCEL' },
      { type: 'END', reason: 'HANGUP' },
      { type: 'STATE_REPORT', connectionState: 'connected' },
    ] as CallEvent[]) {
      expect(transition(st('ENDED'), ev, 'SERVER')).toEqual({ error: 'FORBIDDEN' });
    }
  });
});

describe('deadline theo chuyển trạng thái (§8.3)', () => {
  it('TC-ARCH-008 RING đặt ở T01, xóa ở T04/T05; CONNECT đặt ở T04/T05, xóa ở T13; RECONNECT đặt ở T19, xóa ở T20; terminal: Lua xóa hết', () => {
    expect(deadlineOps(null, 'INITIATED')).toEqual({ remove: [], add: ['RING'] });
    expect(deadlineOps('INITIATED', 'RINGING')).toEqual({ remove: [], add: [] });
    expect(deadlineOps('RINGING', 'ACCEPTED')).toEqual({ remove: ['RING'], add: ['CONNECT'] });
    expect(deadlineOps('ACCEPTED', 'CONNECTING')).toEqual({ remove: [], add: [] });
    expect(deadlineOps('CONNECTING', 'CONNECTED')).toEqual({ remove: ['CONNECT'], add: [] });
    expect(deadlineOps('CONNECTED', 'RECONNECTING')).toEqual({ remove: [], add: ['RECONNECT'] });
    expect(deadlineOps('RECONNECTING', 'CONNECTED')).toEqual({ remove: ['RECONNECT'], add: [] });
    for (const t of TERMINAL) expect(deadlineOps('CONNECTED', t)).toEqual({ remove: [], add: [] });
  });
});
