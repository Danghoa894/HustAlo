// server/src/realtime/handlers/call.handler.ts — 10 event C→S call:* (kiến trúc §4.5, §7(e)–(g)); tab gửi
// (userId, deviceId, tabId) lấy từ handshake. Khi socket kết nối: đẩy call:incoming đang chờ (D-08); khi ngắt: đặt
// deadline PEER nếu tab đang tham gia cuộc gọi. Không bao giờ log sdp/candidate (§11.3).
import {
  CALL_INCOMING_ACK_TIMEOUT_MS,
  CallEndPayload,
  CallIcePayload,
  CallIceRestartPayload,
  CallIdPayload,
  CallInvitePayload,
  CallSdpPayload,
  CallStateReportPayload,
  EVENTS,
} from '@hustalo/shared';
import type { Logger } from 'pino';
import type { RateLimiters } from '../../infra/rate-limit/rate-limiter';
import type { CallsService } from '../../modules/calls/calls.service';
import { withMeta } from '../emitter';
import type { HustaloServer } from '../gateway';
import { withAck } from '../with-ack';

export interface CallHandlerDeps {
  calls: CallsService;
  logger: Logger;
  rateLimiters?: RateLimiters;
  /** Chỉ test: rút ngắn thời gian chờ ACK call:incoming. */
  incomingAckMs?: number;
}

export function registerCallHandlers(io: HustaloServer, deps: CallHandlerDeps): void {
  const ackDeps = { logger: deps.logger, ...(deps.rateLimiters ? { rateLimiters: deps.rateLimiters } : {}) };
  const ackMs = deps.incomingAckMs ?? CALL_INCOMING_ACK_TIMEOUT_MS;
  const { calls } = deps;

  io.on('connection', (socket) => {
    const auth = socket.data.auth;
    if (!auth) return;
    const tab = { userId: auth.userId, deviceId: auth.deviceId, tabId: auth.tabId };

    void calls
      .deliverPending(auth.userId, (payload) =>
        socket
          .timeout(ackMs)
          .emitWithAck(EVENTS.CALL_INCOMING, withMeta(payload))
          .then(
            (res) => (res as { ok?: unknown } | undefined)?.ok === true,
            () => false,
          ),
      )
      .catch((err: unknown) =>
        deps.logger.warn({ err: (err as Error).message }, 'không đẩy được call:incoming đang chờ'),
      );

    socket.on('disconnect', () => {
      void calls.onSocketDisconnect(tab).catch(() => undefined);
    });

    socket.on(
      EVENTS.CALL_INVITE,
      // rateRule null: calls.invite tự tính callInvite sau khi biết lời mời không phải glare (§7(g)).
      withAck(ackDeps, socket, { event: EVENTS.CALL_INVITE, schema: CallInvitePayload, rateRule: null }, (p) =>
        calls.invite(tab, p),
      ),
    );
    socket.on(
      EVENTS.CALL_ACCEPT,
      withAck(ackDeps, socket, { event: EVENTS.CALL_ACCEPT, schema: CallIdPayload }, (p) =>
        calls.accept(tab, p.callId),
      ),
    );
    socket.on(
      EVENTS.CALL_REJECT,
      withAck(ackDeps, socket, { event: EVENTS.CALL_REJECT, schema: CallIdPayload }, (p) =>
        calls.reject(tab, p.callId),
      ),
    );
    socket.on(
      EVENTS.CALL_CANCEL,
      withAck(ackDeps, socket, { event: EVENTS.CALL_CANCEL, schema: CallIdPayload }, (p) =>
        calls.cancel(tab, p.callId),
      ),
    );
    socket.on(
      EVENTS.CALL_END,
      withAck(ackDeps, socket, { event: EVENTS.CALL_END, schema: CallEndPayload }, (p) => calls.end(tab, p)),
    );
    socket.on(
      EVENTS.CALL_STATE,
      withAck(ackDeps, socket, { event: EVENTS.CALL_STATE, schema: CallStateReportPayload }, (p) =>
        calls.reportState(tab, p),
      ),
    );
    socket.on(
      EVENTS.CALL_OFFER,
      withAck(ackDeps, socket, { event: EVENTS.CALL_OFFER, schema: CallSdpPayload }, (p) => calls.offer(tab, p)),
    );
    socket.on(
      EVENTS.CALL_ANSWER,
      withAck(ackDeps, socket, { event: EVENTS.CALL_ANSWER, schema: CallSdpPayload }, (p) => calls.answer(tab, p)),
    );
    socket.on(
      EVENTS.CALL_ICE_CANDIDATE,
      withAck(ackDeps, socket, { event: EVENTS.CALL_ICE_CANDIDATE, schema: CallIcePayload }, (p) =>
        calls.iceCandidate(tab, p),
      ),
    );
    socket.on(
      EVENTS.CALL_ICE_RESTART,
      withAck(ackDeps, socket, { event: EVENTS.CALL_ICE_RESTART, schema: CallIceRestartPayload }, (p) =>
        calls.iceRestart(tab, p),
      ),
    );
  });
}
