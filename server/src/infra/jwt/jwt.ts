// server/src/infra/jwt/jwt.ts — access token HS256 bằng jose (kiến trúc §6.3)
import { randomUUID } from 'node:crypto';
import { ACCESS_TOKEN_TTL_S } from '@hustalo/shared';
import { SignJWT, errors, jwtVerify } from 'jose';
import { env } from '../../config/env';
import { AppError } from '../../http/errors/app-error';

export interface AccessClaims {
  userId: string; // sub
  sid: string; // familyId
  deviceId: string; // did
  exp: number; // giây epoch
}

const secret = () => Buffer.from(env.JWT_ACCESS_SECRET, 'base64url');
const OBJECT_ID = /^[a-f0-9]{24}$/;

export async function signAccessToken(
  claims: Omit<AccessClaims, 'exp'>,
  now: Date = new Date(),
  ttlSec: number = ACCESS_TOKEN_TTL_S,
): Promise<{ token: string; expiresAt: Date }> {
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + ttlSec;
  const token = await new SignJWT({ sid: claims.sid, did: claims.deviceId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.userId)
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .setJti(randomUUID())
    .sign(secret());
  return { token, expiresAt: new Date(exp * 1000) };
}

/** Hết hạn → TOKEN_EXPIRED; sai chữ ký/claim → UNAUTHENTICATED (kiến trúc §4.4.3). */
export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      algorithms: ['HS256'],
      currentDate: new Date(), // theo Date hiện tại để fake clock trong test có hiệu lực
    });
    const { sub, sid, did, exp } = payload as { sub?: unknown; sid?: unknown; did?: unknown; exp?: unknown };
    if (
      typeof sub !== 'string' ||
      !OBJECT_ID.test(sub) ||
      typeof sid !== 'string' ||
      !OBJECT_ID.test(sid) ||
      typeof did !== 'string' ||
      typeof exp !== 'number'
    ) {
      throw new AppError('UNAUTHENTICATED', 'Phiên đăng nhập không hợp lệ');
    }
    return { userId: sub, sid, deviceId: did, exp };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof errors.JWTExpired) throw new AppError('TOKEN_EXPIRED', 'Phiên đăng nhập đã hết hạn');
    throw new AppError('UNAUTHENTICATED', 'Phiên đăng nhập không hợp lệ');
  }
}
