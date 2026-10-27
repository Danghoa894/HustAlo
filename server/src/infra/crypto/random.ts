// server/src/infra/crypto/random.ts — token ngẫu nhiên, HMAC, so sánh hằng thời gian
import { createHmac, randomBytes, timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';

/** `bytes` byte ngẫu nhiên, base64url (32 byte → 43 ký tự). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** HMAC-SHA256(pepper, value) dạng hex; pepper là base64url (REFRESH_TOKEN_PEPPER). */
export function hmacSha256(pepper: string, value: string): string {
  return createHmac('sha256', Buffer.from(pepper, 'base64url')).update(value, 'utf8').digest('hex');
}

/** So sánh hai chuỗi không rò rỉ thời gian; khác độ dài → false. */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && nodeTimingSafeEqual(ab, bb);
}
