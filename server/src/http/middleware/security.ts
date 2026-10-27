// server/src/http/middleware/security.ts — helmet + CSP, CORS whitelist, body limit (kiến trúc §9.6, FR-SEC-006)
import { REST_BODY_LIMIT_BYTES } from '@hustalo/shared';
import cors from 'cors';
import express, { type RequestHandler } from 'express';
import helmet from 'helmet';

/** connect-src: 'self' + từng origin được phép ở dạng https:// và wss:// tương ứng. */
function connectSources(origins: readonly string[]): string[] {
  const out = new Set<string>(["'self'"]);
  for (const o of origins) {
    const url = new URL(o);
    out.add(url.origin);
    out.add(`${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`);
  }
  return [...out];
}

export function securityMiddleware(opts: { corsOrigins: readonly string[]; production: boolean }): RequestHandler[] {
  const allowed = new Set(opts.corsOrigins);
  return [
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          mediaSrc: ["'self'", 'blob:'],
          connectSrc: connectSources(opts.corsOrigins),
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          objectSrc: ["'none'"],
        },
      },
      referrerPolicy: { policy: 'no-referrer' },
      strictTransportSecurity: opts.production ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
    cors({
      // Origin ngoài whitelist → không có Access-Control-Allow-Origin (AC-107). Không dùng '*' vì có credentials.
      origin: (origin, cb) => cb(null, origin !== undefined && allowed.has(origin)),
      credentials: true,
    }),
    express.json({ limit: REST_BODY_LIMIT_BYTES }),
  ];
}
