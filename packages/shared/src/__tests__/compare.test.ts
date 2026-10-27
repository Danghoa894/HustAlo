import { describe, expect, it } from 'vitest';
import { compareMessageOrder } from '../utils/compare';

describe('compareMessageOrder', () => {
  it('sắp theo createdAt rồi tới id khi trùng thời điểm', () => {
    const t = '2026-10-27T09:00:00.000Z';
    const items = [
      { createdAt: '2026-10-27T09:00:01.000Z', id: '000000000000000000000001' },
      { createdAt: t, id: '000000000000000000000003' },
      { createdAt: new Date(t), id: '000000000000000000000002' },
    ];
    expect([...items].sort(compareMessageOrder).map((m) => m.id)).toEqual([
      '000000000000000000000002',
      '000000000000000000000003',
      '000000000000000000000001',
    ]);
  });

  it('trả 0 cho cùng tuple', () => {
    const a = { createdAt: '2026-10-27T09:00:00.000Z', id: '000000000000000000000001' };
    expect(compareMessageOrder(a, { ...a })).toBe(0);
  });
});
