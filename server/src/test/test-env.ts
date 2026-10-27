// server/src/test/test-env.ts — biến môi trường giả cho unit/integration test. KHÔNG phải secret thật.
// Giá trị cố định, chỉ hợp lệ về định dạng (độ dài khóa), không dùng ở môi trường nào khác.
// Không đặt LOG_LEVEL: env.ts không nhận 'silent'; logger.ts tự dùng 'silent' khi NODE_ENV=test.
export const TEST_DATA_KEY = Buffer.alloc(32, 7).toString('base64');

export const testEnv: Record<string, string> = {
  NODE_ENV: 'test',
  CORS_ORIGINS: 'https://localhost:5173',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/hustalo-test?replicaSet=rs0&directConnection=true',
  REDIS_URL: 'redis://127.0.0.1:6379/15',
  REDIS_KEY_PREFIX: 'hustalo-test:',
  JWT_ACCESS_SECRET: Buffer.alloc(48, 1).toString('base64url'),
  JWT_ISSUER: 'hustalo-api',
  JWT_AUDIENCE: 'hustalo-web',
  REFRESH_TOKEN_PEPPER: Buffer.alloc(32, 2).toString('base64url'),
  COOKIE_SECURE: 'true',
  DATA_ENCRYPTION_KEYS: JSON.stringify({ ktest1: TEST_DATA_KEY }),
  DATA_ENCRYPTION_ACTIVE_KEY_ID: 'ktest1',
  STUN_URLS: 'stun:stun.l.google.com:19302',
};
