import { describe, expect, it } from 'vitest';
import { decideRefresh } from './auth.service';

const now = new Date('2026-10-28T10:00:00.000Z');
const ago = (s: number) => new Date(now.getTime() - s * 1000);
const future = new Date(now.getTime() + 86_400_000);
const gen = (o: Partial<{ replacedAt: Date | null; revokedAt: Date | null; expiresAt: Date }> = {}) => ({
  replacedAt: null,
  revokedAt: null,
  expiresAt: future,
  ...o,
});

describe('decideRefresh (kiến trúc §7(a) A–D, D-19)', () => {
  it('A: token hiện hành → ROTATE', () => {
    expect(decideRefresh(gen(), now, false)).toBe('ROTATE');
  });

  it('TC-AUTH-003 B: vừa xoay ≤ 10 s và con còn hiện hành → GRACE_CONFLICT (không thu hồi)', () => {
    expect(decideRefresh(gen({ replacedAt: ago(3) }), now, true)).toBe('GRACE_CONFLICT');
    expect(decideRefresh(gen({ replacedAt: ago(10) }), now, true)).toBe('GRACE_CONFLICT');
  });

  it('TC-AUTH-004 C: ngoài grace, hoặc con đã bị xoay tiếp (tổ tiên xa) → REUSE', () => {
    expect(decideRefresh(gen({ replacedAt: ago(11) }), now, true)).toBe('REUSE');
    expect(decideRefresh(gen({ replacedAt: ago(2) }), now, false)).toBe('REUSE');
  });

  it('D: không tìm thấy, hết hạn, family đã thu hồi → INVALID', () => {
    expect(decideRefresh(null, now, false)).toBe('INVALID');
    expect(decideRefresh(gen({ expiresAt: ago(1) }), now, false)).toBe('INVALID');
    expect(decideRefresh(gen({ revokedAt: ago(1), replacedAt: ago(2) }), now, true)).toBe('INVALID');
  });
});
