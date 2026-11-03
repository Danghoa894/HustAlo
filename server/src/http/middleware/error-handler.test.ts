// server/src/http/middleware/error-handler.test.ts — toAppError: Redis không truy cập được trên luồng bắt buộc Redis
// (cuộc gọi, auth) → SERVICE_UNAVAILABLE (kiến trúc §10.2 bảng lỗi, EC-INFRA-002).
import { describe, expect, it } from 'vitest';
import { toAppError } from './error-handler';

describe('toAppError — Redis down (kiến trúc §10.2)', () => {
  it.each([
    "Stream isn't writeable and enableOfflineQueue options is false",
    'Connection is closed.',
    'Reached the max retries per request limit (which is 1). Refer to "maxRetriesPerRequest" option for details.',
  ])('TC-INFRA-002 lỗi kết nối ioredis "%s" → SERVICE_UNAVAILABLE', (message) => {
    expect(toAppError(new Error(message)).code).toBe('SERVICE_UNAVAILABLE');
  });

  it('MaxRetriesPerRequestError (theo name) → SERVICE_UNAVAILABLE', () => {
    const err = new Error('x');
    err.name = 'MaxRetriesPerRequestError';
    expect(toAppError(err).code).toBe('SERVICE_UNAVAILABLE');
  });

  it('lỗi khác → INTERNAL_ERROR', () => {
    expect(toAppError(new Error('boom')).code).toBe('INTERNAL_ERROR');
  });
});
