// Định dạng safety number (FR-E2EE-005, ui_ux_spec.md §3.8): 60 chữ số → 12 nhóm 5 số, 3 hàng × 4 nhóm.
import { describe, expect, it } from 'vitest';
import { groupSafetyNumber, safetyNumberRows } from './safety-number';

const digits = Array.from({ length: 60 }, (_, i) => String(i % 10)).join('');

describe('safety number', () => {
  it('TC-AC-120 60 chữ số → 12 nhóm 5, 3 hàng × 4 nhóm', () => {
    expect(groupSafetyNumber(digits)).toHaveLength(12);
    expect(groupSafetyNumber(digits)[0]).toBe('01234');
    expect(safetyNumberRows(digits).map((r) => r.length)).toEqual([4, 4, 4]);
    expect(safetyNumberRows(digits).flat().join('')).toBe(digits);
  });

  it('không đủ 60 chữ số → lỗi', () => {
    expect(() => groupSafetyNumber('123')).toThrow();
    expect(() => groupSafetyNumber(`${digits.slice(1)}a`)).toThrow();
  });
});
