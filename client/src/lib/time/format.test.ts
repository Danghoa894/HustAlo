import { describe, expect, it } from 'vitest';
import { formatDuration, formatListTime } from './format';

// Thứ Tư 28/10/2026 15:30 giờ địa phương
const now = new Date(2026, 9, 28, 15, 30);
const at = (y: number, mo: number, d: number, h = 9, mi = 5) => new Date(y, mo, d, h, mi).toISOString();

describe('lib/time/format formatListTime (ui_ux_spec.md §3.2)', () => {
  it('cùng ngày → HH:mm', () => {
    expect(formatListTime(at(2026, 9, 28, 9, 5), now)).toBe('09:05');
  });
  it('hôm qua → "Hôm qua"', () => {
    expect(formatListTime(at(2026, 9, 27, 23, 59), now)).toBe('Hôm qua');
  });
  it('trong 7 ngày → T2…T7, CN', () => {
    expect(formatListTime(at(2026, 9, 26), now)).toBe('T2');
    expect(formatListTime(at(2026, 9, 25), now)).toBe('CN');
    expect(formatListTime(at(2026, 9, 22), now)).toBe('T5');
  });
  it('cùng năm → DD/MM; khác năm → DD/MM/YYYY', () => {
    expect(formatListTime(at(2026, 9, 20), now)).toBe('20/10');
    expect(formatListTime(at(2025, 11, 31), now)).toBe('31/12/2025');
  });
});

describe('formatDuration', () => {
  it('mm:ss', () => {
    expect(formatDuration(192)).toBe('03:12');
    expect(formatDuration(5)).toBe('00:05');
  });
});
