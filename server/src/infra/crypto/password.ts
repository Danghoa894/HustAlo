// server/src/infra/crypto/password.ts — Argon2id hash/verify + dummy hash chống timing (kiến trúc §9.4, FR-SEC-004)
import argon2 from 'argon2';

/** OWASP: m=19 MiB, t=2, p=1. Đổi tham số → needsRehash() true → rehash khi đăng nhập (AC-108). */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string, options: Partial<typeof ARGON2_OPTIONS> = {}): Promise<string> {
  return argon2.hash(password, { ...ARGON2_OPTIONS, ...options });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false; // hash hỏng/không phải PHC → coi như sai
  }
}

export function needsRehash(hash: string): boolean {
  return argon2.needsRehash(hash, ARGON2_OPTIONS);
}

let dummyHash: Promise<string> | undefined;

/** Khi không có user: vẫn chạy verify trên hash giả cùng tham số để thời gian phản hồi tương đương (AC-003). */
export async function verifyDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword('dummy-password-for-timing-0');
  await verifyPassword(await dummyHash, password);
  return false;
}
