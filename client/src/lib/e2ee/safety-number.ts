// client/src/lib/e2ee/safety-number.ts — safety number 60 chữ số (12 nhóm 5 số, 3 hàng × 4 nhóm) cho từng device của
// peer (FR-E2EE-005, ui_ux_spec.md §3.8 SafetyNumberDialog). Thuật toán: FingerprintGenerator của thư viện D-12
// (NumericFingerprint của Signal, SHA-512 lặp 5200 vòng) — tính trong signal-adapter.
import { fingerprint } from './signal-adapter';

export const SAFETY_NUMBER_DIGITS = 60;
const GROUP = 5;
const GROUPS_PER_ROW = 4;

/** "123451234512345…" → ["12345", "12345", …] (12 nhóm). */
export function groupSafetyNumber(digits: string): string[] {
  if (!new RegExp(`^\\d{${String(SAFETY_NUMBER_DIGITS)}}$`).test(digits)) throw new Error('Safety number không hợp lệ');
  return digits.match(new RegExp(`\\d{${String(GROUP)}}`, 'g')) ?? [];
}

/** 12 nhóm → 3 hàng × 4 nhóm. */
export function safetyNumberRows(digits: string): string[][] {
  const groups = groupSafetyNumber(digits);
  const rows: string[][] = [];
  for (let i = 0; i < groups.length; i += GROUPS_PER_ROW) rows.push(groups.slice(i, i + GROUPS_PER_ROW));
  return rows;
}

/** Hai bên (mình ↔ device peer) tính ra cùng một chuỗi nếu không ai bị thay identity key. */
export function computeSafetyNumber(
  me: { userId: string; identityKey: string },
  peer: { userId: string; identityKey: string },
): Promise<string> {
  return fingerprint(me.userId, me.identityKey, peer.userId, peer.identityKey);
}
