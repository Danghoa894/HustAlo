import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from '../utils/cursor';

describe('cursor base64url', () => {
  const id = '6720b1b2c3d4e5f601234501';
  const c = { createdAt: '2026-10-27T09:12:00.000Z', id };

  it('mã hóa khớp ví dụ Cursor trong api_spec', () => {
    expect(encodeCursor(c)).toBe('WyIyMDI2LTEwLTI3VDA5OjEyOjAwLjAwMFoiLCI2NzIwYjFiMmMzZDRlNWY2MDEyMzQ1MDEiXQ');
  });

  it('round-trip encode → decode', () => {
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  // Giá trị kỳ vọng sinh bằng Buffer.from(JSON.stringify(v)).toString('base64url') của Node.
  it.each([
    ['2026-01-01T00:00:00Z', 'WyIyMDI2LTAxLTAxVDAwOjAwOjAwWiIsIjY3MjBiMWIyYzNkNGU1ZjYwMTIzNDUwMSJd'],
    ['2026-01-01T00:00:00.1Z', 'WyIyMDI2LTAxLTAxVDAwOjAwOjAwLjFaIiwiNjcyMGIxYjJjM2Q0ZTVmNjAxMjM0NTAxIl0'],
    ['2026-01-01T00:00:00.12Z', 'WyIyMDI2LTAxLTAxVDAwOjAwOjAwLjEyWiIsIjY3MjBiMWIyYzNkNGU1ZjYwMTIzNDUwMSJd'],
  ])('khớp base64url của Node (createdAt %s)', (createdAt, expected) => {
    expect(encodeCursor({ createdAt, id })).toBe(expected);
    expect(decodeCursor(expected)).toEqual({ createdAt, id });
  });

  it.each([
    '',
    '!!!',
    'a',
    'WyJraMO0bmctcGjhuqNpLW5nw6B5IiwiNjcyMGIxYjJjM2Q0ZTVmNjAxMjM0NTAxIl0', // createdAt không phải ngày
    'WyIyMDI2LTEwLTI3VDA5OjEyOjAwLjAwMFoiLCJYWVoiXQ', // id không phải ObjectId
    'eyJhIjoxfQ', // JSON không phải mảng
  ])('từ chối cursor hỏng %#', (bad) => {
    expect(() => decodeCursor(bad)).toThrow('INVALID_CURSOR');
  });
});
