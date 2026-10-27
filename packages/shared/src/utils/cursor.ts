// packages/shared/src/utils/cursor.ts — cursor base64url của JSON [createdAtISO, objectIdHex] (database_schema.md §4)
// Mã hóa base64url thuần TS để chạy được cả ở server (Node) và client (trình duyệt) mà không cần Buffer/btoa.
export interface TupleCursor {
  createdAt: string; // ISO UTC
  id: string; // ObjectId hex
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LOOKUP = new Map(Array.from(ALPHABET, (c, i) => [c, i] as const));

function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += ALPHABET.charAt((n >> 18) & 63) + ALPHABET.charAt((n >> 12) & 63);
    if (i + 1 < bytes.length) out += ALPHABET.charAt((n >> 6) & 63);
    if (i + 2 < bytes.length) out += ALPHABET.charAt(n & 63);
  }
  return out;
}

function fromBase64Url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new Error('INVALID_CURSOR');
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i += 4) {
    const chunk = s.slice(i, i + 4);
    let n = 0;
    // Chuỗi đã qua regex nên mọi ký tự đều có trong bảng; vị trí thiếu (cuối chuỗi) tính là 0.
    for (let j = 0; j < 4; j += 1) n = (n << 6) | (LOOKUP.get(chunk.charAt(j)) ?? 0);
    bytes.push((n >> 16) & 255);
    if (chunk.length > 2) bytes.push((n >> 8) & 255);
    if (chunk.length > 3) bytes.push(n & 255);
  }
  return Uint8Array.from(bytes);
}

export const encodeCursor = (c: TupleCursor): string =>
  toBase64Url(new TextEncoder().encode(JSON.stringify([c.createdAt, c.id])));

export function decodeCursor(s: string): TupleCursor {
  let arr: unknown;
  try {
    arr = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(s)));
  } catch {
    throw new Error('INVALID_CURSOR');
  }
  if (
    !Array.isArray(arr) ||
    typeof arr[0] !== 'string' ||
    typeof arr[1] !== 'string' ||
    Number.isNaN(Date.parse(arr[0])) ||
    !/^[a-f0-9]{24}$/.test(arr[1])
  )
    throw new Error('INVALID_CURSOR');
  return { createdAt: arr[0], id: arr[1] };
}
