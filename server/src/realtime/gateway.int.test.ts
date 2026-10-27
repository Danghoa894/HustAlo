import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { EVENTS, NIL_UUID, TypingPayload, type AckResponse } from '@hustalo/shared';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../infra/logger/logger';
import { AppError } from '../http/errors/app-error';
import { createEmitter } from './emitter';
import { createGateway, type HustaloServer } from './gateway';
import { userRoom } from './rooms';
import { withAck } from './with-ack';

const conversationId = '6720a1b2c3d4e5f601234561';
const requestId = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const logger = createLogger({ level: 'silent' });

describe('gateway + withAck + emitter', () => {
  let http: HttpServer;
  let io: HustaloServer;
  let client: ClientSocket;
  const handled: string[] = [];

  beforeAll(async () => {
    http = createServer();
    io = createGateway(http, {
      path: '/socket.io',
      pingInterval: 25_000,
      pingTimeout: 20_000,
      corsOrigins: ['https://localhost:5173'],
      adapter: 'memory',
      logger,
      auth: null,
    });
    io.on('connection', (socket) => {
      void socket.join(userRoom('u1'));
      socket.on(
        EVENTS.TYPING_START,
        withAck({ logger }, socket, { event: EVENTS.TYPING_START, schema: TypingPayload }, (payload) => {
          handled.push(payload.conversationId);
          if (payload.conversationId === '000000000000000000000000') throw new AppError('NOT_FOUND', 'Không tìm thấy');
          if (payload.conversationId === 'ffffffffffffffffffffffff') throw new Error('bug nội bộ');
          return Promise.resolve({});
        }),
      );
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const { port } = http.address() as AddressInfo;
    client = connect(`http://127.0.0.1:${port}`, { path: '/socket.io', transports: ['websocket'] });
    await new Promise<void>((resolve) => client.on('connect', () => resolve()));
  });

  afterAll(async () => {
    client.disconnect();
    await io.close();
  });

  const send = (envelope: unknown) =>
    client.timeout(5000).emitWithAck(EVENTS.TYPING_START, envelope) as Promise<AckResponse<Record<string, never>>>;

  it('envelope hợp lệ → ACK ok cùng requestId', async () => {
    expect(await send({ requestId, payload: { conversationId } })).toEqual({ ok: true, requestId, data: {} });
  });

  it('envelope sai schema → ACK VALIDATION_ERROR; requestId không đọc được → NIL_UUID', async () => {
    const bad = await send({ requestId, payload: { conversationId, userId: 'chen-vao' } });
    expect(bad).toMatchObject({ ok: false, requestId, error: { code: 'VALIDATION_ERROR' } });
    const broken = await send({ payload: {} });
    expect(broken).toMatchObject({ ok: false, requestId: NIL_UUID, error: { code: 'VALIDATION_ERROR' } });
  });

  it('AppError → ACK đúng code; lỗi lạ → INTERNAL_ERROR với message chung', async () => {
    expect(await send({ requestId, payload: { conversationId: '000000000000000000000000' } })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await send({ requestId, payload: { conversationId: 'ffffffffffffffffffffffff' } })).toEqual({
      ok: false,
      requestId,
      error: { code: 'INTERNAL_ERROR', message: 'Đã có lỗi xảy ra' },
    });
  });

  it('event không kèm callback ACK → server bỏ qua, không xử lý', async () => {
    const before = handled.length;
    client.emit(EVENTS.TYPING_START, { requestId, payload: { conversationId } });
    await send({ requestId, payload: { conversationId } }); // đồng bộ: event sau đã được xử lý
    expect(handled.length).toBe(before + 1);
  });

  it('emitter gắn eventId (uuid) + occurredAt (ISO) vào event S→C', async () => {
    const received = new Promise<Record<string, unknown>>((resolve) => client.once(EVENTS.SESSION_REVOKED, resolve));
    createEmitter(io).toUser('u1', EVENTS.SESSION_REVOKED, { reason: 'LOGOUT' });
    const payload = await received;
    expect(payload.reason).toBe('LOGOUT');
    expect(payload.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(String(payload.occurredAt)))).toBe(false);
  });
});
