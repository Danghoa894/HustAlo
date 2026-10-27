// server/src/realtime/with-ack.ts — bọc handler C→S: parse envelope, rate limit, map lỗi → ACK (kiến trúc §4.5)
import { performance } from 'node:perf_hooks';
import { NIL_UUID, RATE_LIMITS, clientEnvelope, type AckResponse } from '@hustalo/shared';
import type { Logger } from 'pino';
import type { z } from 'zod';
import { toAppError } from '../http/middleware/error-handler';
import { metrics } from '../infra/metrics/metrics';
import type { RateLimiters, RateRule } from '../infra/rate-limit/rate-limiter';
import { ruleForEvent } from './middleware/socket-rate-limit';

/** Phần socket mà withAck cần; `data.auth` được socket-auth (M1) gắn sau handshake. */
export interface AckSocket {
  id: string;
  data: { auth?: { userId: string } };
}

export interface HandlerContext<S extends AckSocket> {
  socket: S;
  requestId: string;
}

export interface WithAckOptions<P extends z.ZodTypeAny> {
  event: string;
  schema: P;
  rateRule?: RateRule;
}

export interface WithAckDeps {
  logger: Logger;
  rateLimiters?: RateLimiters;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readRequestId(envelope: unknown): string {
  const id = (envelope as { requestId?: unknown } | null)?.requestId;
  return typeof id === 'string' && UUID.test(id) ? id : NIL_UUID;
}

function rateSubject(rule: RateRule, socket: AckSocket): string {
  return RATE_LIMITS[rule].key === 'socket' ? socket.id : (socket.data.auth?.userId ?? socket.id);
}

export function withAck<S extends AckSocket, P extends z.ZodTypeAny, D>(
  deps: WithAckDeps,
  socket: S,
  opts: WithAckOptions<P>,
  handler: (payload: z.output<P>, ctx: HandlerContext<S>) => Promise<D>,
): (envelope: unknown, ack?: unknown) => void {
  const envelopeSchema = clientEnvelope(opts.schema);

  return (envelope, ack) => {
    if (typeof ack !== 'function') {
      // Không có callback → không xử lý ghi (kiến trúc §4.5).
      deps.logger.warn({ event: opts.event, reason: 'NO_ACK_CALLBACK' }, 'socket event bỏ qua');
      return;
    }
    const reply = ack as (res: AckResponse<D>) => void;
    const started = performance.now();
    let requestId = readRequestId(envelope);

    const run = async (): Promise<D> => {
      const parsed = envelopeSchema.parse(envelope) as { requestId: string; payload: z.output<P> };
      requestId = parsed.requestId;
      const rule = opts.rateRule ?? ruleForEvent(opts.event);
      if (rule && deps.rateLimiters) {
        await deps.rateLimiters.consume(rule, rateSubject(rule, socket));
      }
      return handler(parsed.payload, { socket, requestId });
    };

    run()
      .then((data) => {
        metrics.socketEvents.inc({ event: opts.event, result: 'ok', code: '' });
        deps.logger.info(
          {
            event: opts.event,
            requestId,
            userId: socket.data.auth?.userId,
            durationMs: performance.now() - started,
            ok: true,
          },
          'socket event',
        );
        reply({ ok: true, requestId, data });
      })
      .catch((err: unknown) => {
        const appErr = toAppError(err);
        metrics.socketEvents.inc({ event: opts.event, result: 'error', code: appErr.code });
        const line = {
          event: opts.event,
          requestId,
          userId: socket.data.auth?.userId,
          durationMs: performance.now() - started,
          ok: false,
          code: appErr.code,
        };
        if (appErr.code === 'INTERNAL_ERROR') deps.logger.error({ ...line, err }, 'socket event lỗi');
        else deps.logger.info(line, 'socket event');
        reply({ ok: false, requestId, error: { code: appErr.code, message: appErr.message } });
      });
  };
}
