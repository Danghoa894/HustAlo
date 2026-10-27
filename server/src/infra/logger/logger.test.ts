import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger';

function capture() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString('utf8'));
      cb();
    },
  });
  return { logger: createLogger({ level: 'info', destination }), output: () => lines.join('') };
}

describe('logger redact (kiến trúc §11.3)', () => {
  it('che mật khẩu, token, nội dung tin, SDP, candidate, credential', () => {
    const { logger, output } = capture();
    const secrets = {
      password: 'mat-khau-123',
      accessToken: 'eyJhbGciOiJIUzI1NiJ9.x.y',
      refreshToken: 'rt-abcdef',
      content: 'bí mật 123',
      sdp: 'v=0 a=fingerprint:sha-256 AA',
      candidate: 'candidate:1 1 udp 2122260223 192.168.1.23 54400 typ host',
      credential: 'turn-secret',
    };
    logger.info({ data: secrets, payload: { content: 'nội dung payload', sdp: 'v=0' } }, 'kiểm tra');
    logger.info({ req: { headers: { authorization: 'Bearer eyJ.abc', cookie: 'hustalo_rt=xyz' } } }, 'req');
    const out = output();
    for (const v of [...Object.values(secrets), 'nội dung payload', 'Bearer eyJ.abc', 'hustalo_rt=xyz']) {
      expect(out).not.toContain(v);
    }
    expect(out).toContain('[REDACTED]');
  });

  it('giữ trường id được phép log', () => {
    const { logger, output } = capture();
    logger.info({ requestId: 'r-1', userId: 'u-1', conversationId: 'c-1' }, 'ok');
    expect(output()).toContain('"conversationId":"c-1"');
    expect(output()).toContain('"instanceId"');
  });
});
