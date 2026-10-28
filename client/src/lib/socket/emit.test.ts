import { EVENTS, SOCKET_ACK_TIMEOUT_MS } from '@hustalo/shared';
import { describe, expect, it, vi } from 'vitest';
import { AckTimeoutError, emitWithAck, type AckEmitter } from './emit';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function fakeEmitter(reply: (env: { requestId: string }) => [Error | null, unknown]) {
  const timeout = vi.fn((_ms: number) => ({
    emit: (_ev: string, env: unknown, cb: (err: Error | null, res: unknown) => void) => {
      const [err, res] = reply(env as { requestId: string });
      cb(err, res);
    },
  }));
  return { emitter: { timeout } satisfies AckEmitter, timeout };
}

describe('lib/socket/emit emitWithAck (kiến trúc §4.5)', () => {
  it('bọc payload vào envelope {requestId uuid v4, payload}, timeout SOCKET_ACK_TIMEOUT_MS', async () => {
    let sent: unknown;
    const { emitter, timeout } = fakeEmitter((env) => {
      sent = env;
      return [null, { ok: true, requestId: env.requestId, data: { accepted: [] } }];
    });
    const res = await emitWithAck(EVENTS.PRESENCE_SUBSCRIBE, { userIds: ['6720a1b2c3d4e5f601234561'] }, emitter);
    expect(timeout).toHaveBeenCalledWith(SOCKET_ACK_TIMEOUT_MS);
    expect(sent).toMatchObject({ payload: { userIds: ['6720a1b2c3d4e5f601234561'] } });
    expect((sent as { requestId: string }).requestId).toMatch(UUID);
    expect(res).toMatchObject({ ok: true, data: { accepted: [] } });
  });

  it('ACK lỗi được trả nguyên dạng {ok:false, error}', async () => {
    const { emitter } = fakeEmitter((env) => [
      null,
      { ok: false, requestId: env.requestId, error: { code: 'RATE_LIMITED', message: 'x' } },
    ]);
    await expect(
      emitWithAck(EVENTS.PRESENCE_SUBSCRIBE, { userIds: ['6720a1b2c3d4e5f601234561'] }, emitter),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED' },
    });
  });

  it('không có ACK trong thời hạn → AckTimeoutError', async () => {
    const { emitter } = fakeEmitter(() => [new Error('operation has timed out'), undefined]);
    await expect(
      emitWithAck(EVENTS.PRESENCE_SUBSCRIBE, { userIds: ['6720a1b2c3d4e5f601234561'] }, emitter),
    ).rejects.toBeInstanceOf(AckTimeoutError);
  });
});
