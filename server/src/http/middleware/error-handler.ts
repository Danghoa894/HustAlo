// server/src/http/middleware/error-handler.ts — AppError/ZodError/Mongo error → ErrorResponse (kiến trúc §4.4.3)
import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ErrorResponse } from '@hustalo/shared';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { AppError } from '../errors/app-error';

const isMongoUnavailable = (err: unknown): boolean =>
  err instanceof mongoose.mongo.MongoServerSelectionError ||
  err instanceof mongoose.mongo.MongoNetworkError ||
  (err instanceof mongoose.mongo.MongoError && err.hasErrorLabel('TransientTransactionError'));

const isDuplicateKey = (err: unknown): boolean => err instanceof mongoose.mongo.MongoServerError && err.code === 11000;

interface BodyParserError {
  type?: string;
  status?: number;
}

/** Ánh xạ lỗi bất kỳ sang AppError; dùng chung cho REST và ACK socket. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return new AppError('VALIDATION_ERROR', 'Dữ liệu không hợp lệ', details);
  }
  const bp = err as BodyParserError | null;
  if (bp?.type === 'entity.too.large')
    return new AppError('VALIDATION_ERROR', 'Dữ liệu gửi lên quá lớn', undefined, 413);
  if (bp?.type === 'entity.parse.failed') return new AppError('VALIDATION_ERROR', 'JSON không hợp lệ');
  if (isMongoUnavailable(err))
    return new AppError('SERVICE_UNAVAILABLE', 'Dịch vụ tạm thời không khả dụng, vui lòng thử lại');
  if (isDuplicateKey(err)) return new AppError('CONFLICT', 'Dữ liệu đã tồn tại');
  return new AppError('INTERNAL_ERROR', 'Đã có lỗi xảy ra');
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError('NOT_FOUND', 'Không tìm thấy'));
};

export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  const appErr = toAppError(err);
  if (appErr.code === 'INTERNAL_ERROR') req.log.error({ err }, 'unhandled error');
  if (appErr.retryAfterSec !== undefined) res.setHeader('Retry-After', String(appErr.retryAfterSec));
  const body: ErrorResponse = {
    error: {
      code: appErr.code,
      message: appErr.message,
      ...(appErr.details === undefined ? {} : { details: appErr.details }),
      requestId: typeof req.id === 'string' ? req.id : JSON.stringify(req.id),
    },
  };
  res.status(appErr.status).json(body);
};
