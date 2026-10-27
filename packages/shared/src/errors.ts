// packages/shared/src/errors.ts
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  NOT_A_MEMBER: 'NOT_A_MEMBER',
  CONVERSATION_FULL: 'CONVERSATION_FULL',
  USER_BLOCKED: 'USER_BLOCKED',
  DUPLICATE_MESSAGE: 'DUPLICATE_MESSAGE',
  CALL_NOT_FOUND: 'CALL_NOT_FOUND',
  CALL_INVALID_STATE: 'CALL_INVALID_STATE',
  CALL_BUSY: 'CALL_BUSY',
  CALL_TIMEOUT: 'CALL_TIMEOUT',
  CALL_ALREADY_ANSWERED: 'CALL_ALREADY_ANSWERED',
  E2EE_KEYS_UNAVAILABLE: 'E2EE_KEYS_UNAVAILABLE',
  E2EE_DECRYPT_FAILED: 'E2EE_DECRYPT_FAILED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400, // ngoại lệ cùng code: 413 khi body > REST_BODY_LIMIT_BYTES; 422 khi currentPassword sai (POST /auth/change-password)
  UNAUTHENTICATED: 401,
  TOKEN_EXPIRED: 401,
  FORBIDDEN: 403,
  NOT_A_MEMBER: 403,
  USER_BLOCKED: 403,
  NOT_FOUND: 404,
  CALL_NOT_FOUND: 404,
  CONFLICT: 409,
  CALL_INVALID_STATE: 409,
  CALL_BUSY: 409,
  CALL_TIMEOUT: 409,
  CALL_ALREADY_ANSWERED: 409,
  CONVERSATION_FULL: 422,
  E2EE_KEYS_UNAVAILABLE: 422,
  E2EE_DECRYPT_FAILED: 422, // chỉ phát sinh phía client; giữ ánh xạ để thống nhất
  DUPLICATE_MESSAGE: 200, // KHÔNG phải lỗi: trả kết quả cũ
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  details?: unknown;
  requestId: string;
}
export interface ErrorResponse {
  error: ErrorBody;
} // REST
export interface AckError {
  code: ErrorCode;
  message: string;
} // Socket ACK
