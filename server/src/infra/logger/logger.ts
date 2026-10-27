// server/src/infra/logger/logger.ts — pino JSON + redact bắt buộc (kiến trúc §11.2, §11.3)
import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';

/** `${hostname}-${pid}-${random4}` sinh lúc boot (kiến trúc §10.4). */
export const instanceId = `${hostname()}-${process.pid}-${randomBytes(2).toString('hex')}`;

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.passwordHash',
  '*.accessToken',
  '*.refreshToken',
  '*.token',
  '*.tokenHash',
  '*.content',
  '*.contentEnc',
  '*.ciphertext',
  '*.body',
  '*.sdp',
  '*.candidate',
  '*.iceServers',
  '*.credential',
  '*.username',
  '*.identityKey',
  '*.signedPreKey',
  '*.oneTimePreKeys',
  'payload.content',
  'payload.ciphertext',
  'payload.sdp',
  'payload.candidate',
];

export type LogLevel = LoggerOptions['level'];

export function createLogger(opts: { level?: string; destination?: DestinationStream } = {}): Logger {
  const options: LoggerOptions = {
    level: opts.level ?? process.env.LOG_LEVEL ?? 'info',
    base: { instanceId },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  return opts.destination ? pino(options, opts.destination) : pino(options);
}

/** Logger mặc định của process; test tạo logger riêng với destination bộ nhớ. */
export const logger: Logger = createLogger({
  level: process.env.NODE_ENV === 'test' ? 'silent' : (process.env.LOG_LEVEL ?? 'info'),
});
