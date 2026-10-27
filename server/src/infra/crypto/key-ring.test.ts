import { describe, expect, it } from 'vitest';
import { KeyRingError, createKeyRing } from './key-ring';

const key32 = Buffer.alloc(32, 9).toString('base64');
const key31 = Buffer.alloc(31, 9).toString('base64');

const expectFailWithoutValue = (fn: () => unknown, secret: string) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(KeyRingError);
    expect((err as Error).message).not.toContain(secret);
    return;
  }
  throw new Error('Kỳ vọng ném KeyRingError');
};

describe('key-ring (AC-ARCH-004)', () => {
  it('TC-ARCH-004 DATA_ENCRYPTION_ACTIVE_KEY_ID không có trong DATA_ENCRYPTION_KEYS → lỗi, không lộ giá trị key', () => {
    expectFailWithoutValue(() => createKeyRing({ k1: key32 }, 'k2'), key32);
  });

  it('TC-ARCH-004 key không đủ 32 byte → lỗi, không lộ giá trị key', () => {
    expectFailWithoutValue(() => createKeyRing({ k1: key31 }, 'k1'), key31);
  });

  it('TC-ARCH-004 keyId sai định dạng hoặc key không phải base64 → lỗi', () => {
    expectFailWithoutValue(() => createKeyRing({ 'k 1': key32 }, 'k 1'), key32);
    expectFailWithoutValue(() => createKeyRing({ k1: 'không-phải-base64!' }, 'k1'), 'không-phải-base64!');
    expectFailWithoutValue(() => createKeyRing({}, 'k1'), key32);
  });

  it('nhiều key: active trả key đang dùng, get đọc được key cũ (xoay khóa §9.2.4)', () => {
    const old = Buffer.alloc(32, 1).toString('base64');
    const ring = createKeyRing({ kold: old, knew: key32 }, 'knew');
    expect(ring.active().keyId).toBe('knew');
    expect(ring.get('kold').equals(Buffer.from(old, 'base64'))).toBe(true);
    expect(ring.keyIds()).toEqual(['kold', 'knew']);
  });
});
