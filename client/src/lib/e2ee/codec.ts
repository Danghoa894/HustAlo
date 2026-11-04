// client/src/lib/e2ee/codec.ts — chuyển đổi byte cho lớp E2EE: base64 (wire/server) ↔ ArrayBuffer (thư viện D-12),
// "binary string" (thư viện trả bản mã dạng chuỗi mỗi ký tự một byte) ↔ base64.

export function bufferToB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function b64ToBuffer(b64: string): ArrayBuffer {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out.buffer;
}

/** Chuỗi nhị phân (mỗi ký tự 0..255) → base64. */
export const binaryToB64 = (binary: string): string => btoa(binary);
/** base64 → chuỗi nhị phân cho decryptPreKeyWhisperMessage / decryptWhisperMessage (encoding 'binary'). */
export const b64ToBinary = (b64: string): string => atob(b64);

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export const textToBuffer = (text: string): ArrayBuffer => encoder.encode(text).buffer;
export const bufferToText = (buf: ArrayBuffer): string => decoder.decode(new Uint8Array(buf));
