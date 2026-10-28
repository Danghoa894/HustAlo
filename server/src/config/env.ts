// server/src/config/env.ts
import { z } from 'zod';
import { SOCKET_PING_INTERVAL_MS, SOCKET_PING_TIMEOUT_MS } from '@hustalo/shared';

const csv = z.string().transform((s) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length > 0),
);

const base64urlMin32 = z
  .string()
  .refine((s) => Buffer.from(s, 'base64url').length >= 32, 'phải là base64url của tối thiểu 32 byte');

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),
    CORS_ORIGINS: csv.pipe(z.array(z.string().url()).min(1)),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    METRICS_PORT: z.coerce.number().int().min(1).max(65535).default(9464),

    MONGODB_URI: z
      .string()
      .startsWith('mongodb')
      .refine((u) => u.includes('replicaSet='), 'phải có replicaSet= (AC-ARCH-003)'),
    REDIS_URL: z.string().startsWith('redis'),
    REDIS_URL_TEST: z.string().startsWith('redis').optional(),
    REDIS_KEY_PREFIX: z
      .string()
      .regex(/^[a-z0-9_-]+:$/)
      .default('hustalo:'),

    JWT_ACCESS_SECRET: base64urlMin32,
    JWT_ISSUER: z.string().min(1),
    JWT_AUDIENCE: z.string().min(1),
    REFRESH_TOKEN_PEPPER: base64urlMin32,
    COOKIE_SECURE: z.enum(['true', 'false']).transform((v) => v === 'true'),

    // Chi tiết parse/validate từng key ở infra/crypto/key-ring.ts (AC-ARCH-004); ở đây chỉ kiểm tra JSON object.
    DATA_ENCRYPTION_KEYS: z.string().transform((s, ctx) => {
      try {
        const v: unknown = JSON.parse(s);
        if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error();
        return v as Record<string, string>;
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'DATA_ENCRYPTION_KEYS phải là JSON object' });
        return z.NEVER;
      }
    }),
    DATA_ENCRYPTION_ACTIVE_KEY_ID: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),

    SOCKET_PATH: z.string().startsWith('/').default('/socket.io'),
    SOCKET_PING_INTERVAL: z.coerce.number().int().positive().default(SOCKET_PING_INTERVAL_MS),
    SOCKET_PING_TIMEOUT: z.coerce.number().int().positive().default(SOCKET_PING_TIMEOUT_MS),
    SOCKET_ADAPTER: z.enum(['memory', 'redis-streams']).default('memory'),

    STUN_URLS: csv.pipe(z.array(z.string().regex(/^stuns?:/)).min(1)),
    XIRSYS_IDENT: z.string().default(''),
    XIRSYS_SECRET: z.string().default(''),
    XIRSYS_CHANNEL: z.string().default('hustalo-dev'),
    XIRSYS_API_URL: z.string().url().default('https://global.xirsys.net'),
    TURN_FALLBACK_URLS: csv.pipe(z.array(z.string().regex(/^turns?:/))).default(''),
    TURN_FALLBACK_USERNAME: z.string().default(''),
    TURN_FALLBACK_CREDENTIAL: z.string().default(''),
    ICE_TRANSPORT_POLICY: z.enum(['all', 'relay']).default('all'),
    DEV_CALL_RING_TIMEOUT_MS: z.coerce.number().int().min(5000).max(120000).optional(), // DG-08

    SEED_PASSWORD: z.string().min(8).max(128).optional(),
  })
  .superRefine((e, ctx) => {
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    // EC-SEC-009: cookie phiên luôn Secure ở production; dev/test chạy http://localhost (DG-01).
    if (e.NODE_ENV === 'production' && !e.COOKIE_SECURE)
      fail('COOKIE_SECURE', 'chỉ được false khi NODE_ENV là development hoặc test');
    if ((e.XIRSYS_IDENT === '') !== (e.XIRSYS_SECRET === ''))
      fail('XIRSYS_SECRET', 'XIRSYS_IDENT và XIRSYS_SECRET phải cùng có hoặc cùng trống');
    if (e.TURN_FALLBACK_URLS.length > 0 && (e.TURN_FALLBACK_USERNAME === '' || e.TURN_FALLBACK_CREDENTIAL === ''))
      fail('TURN_FALLBACK_CREDENTIAL', 'có TURN_FALLBACK_URLS thì phải có username và credential');
    if (e.NODE_ENV === 'production' && e.XIRSYS_IDENT === '' && e.TURN_FALLBACK_URLS.length === 0)
      fail('XIRSYS_IDENT', 'production cần ít nhất một nguồn TURN');
    if (e.NODE_ENV === 'production' && e.SEED_PASSWORD !== undefined)
      fail('SEED_PASSWORD', 'không được đặt ở production');
    if (e.ICE_TRANSPORT_POLICY === 'relay' && e.XIRSYS_IDENT === '' && e.TURN_FALLBACK_URLS.length === 0)
      fail('ICE_TRANSPORT_POLICY', 'relay cần có TURN');
  });

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // Chỉ in tên biến và thông điệp — KHÔNG in giá trị (có thể là secret).
  for (const issue of parsed.error.issues) {
    process.stderr.write(`[env] ${issue.path.join('.')}: ${issue.message}\n`);
  }
  process.exit(1);
}

export const env = Object.freeze(parsed.data);
export type Env = typeof env;
