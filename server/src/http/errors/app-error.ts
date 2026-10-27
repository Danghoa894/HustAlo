// server/src/http/errors/app-error.ts — lỗi nghiệp vụ có ErrorCode (kiến trúc §4.4.3)
import { ERROR_HTTP_STATUS, type ErrorCode } from '@hustalo/shared';

export class AppError extends Error {
  override name = 'AppError';
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    status?: number, // ngoại lệ cùng code (413, 422 cho VALIDATION_ERROR)
    readonly retryAfterSec?: number, // RATE_LIMITED → header Retry-After
  ) {
    super(message);
    this.status = status ?? ERROR_HTTP_STATUS[code];
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;
