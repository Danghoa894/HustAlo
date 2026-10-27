import { describe, expect, it } from 'vitest';
import { MESSAGE_MAX_LENGTH } from '../constants';
import { normalizedText } from '../schemas/common.schema';
import { countCodePoints, isValidMessageText, normalizeMessageText } from '../utils/text';

describe('normalizedText (D-17)', () => {
  it('TC-MSG-001 từ chối chuỗi rỗng, chỉ khoảng trắng hoặc chỉ zero-width', () => {
    for (const s of ['', '   ', '\n\t ', '​‌‍', '⁠﻿', ' 　  ']) {
      expect(normalizedText.safeParse(s).success).toBe(false);
      expect(isValidMessageText(s)).toBe(false);
    }
  });

  it('TC-MSG-001 trim khoảng trắng và zero-width ở hai đầu, giữ phần giữa', () => {
    expect(normalizeMessageText('​  xin chào ﻿')).toBe('xin chào');
    expect(normalizedText.parse('  a​b  ')).toBe('a​b');
  });

  it('TC-MSG-002 chấp nhận đúng 4000 code point, từ chối 4001', () => {
    expect(normalizedText.safeParse('a'.repeat(MESSAGE_MAX_LENGTH)).success).toBe(true);
    expect(normalizedText.safeParse('a'.repeat(MESSAGE_MAX_LENGTH + 1)).success).toBe(false);
  });

  it('TC-MSG-002 đếm theo code point: 4000 emoji (8000 UTF-16 unit) vẫn hợp lệ', () => {
    const s = '😀'.repeat(MESSAGE_MAX_LENGTH);
    expect(s.length).toBe(MESSAGE_MAX_LENGTH * 2);
    expect(normalizedText.safeParse(s).success).toBe(true);
    expect(normalizedText.safeParse(s + '😀').success).toBe(false);
  });

  it('TC-MSG-003 chuẩn hóa NFC: tổ hợp e + dấu sắc thành một code point', () => {
    const decomposed = 'é';
    expect(normalizeMessageText(decomposed)).toBe('é');
    expect(countCodePoints(normalizeMessageText(decomposed))).toBe(1);
  });

  it('TC-MSG-003 giữ nguyên emoji ZWJ, zero-width giữa chuỗi và ký tự RTL override', () => {
    const family = '👨‍👩‍👧';
    expect(normalizedText.parse(family)).toBe(family);
    expect(countCodePoints(family)).toBe(5);
    const rtl = 'abc‮def';
    expect(normalizedText.parse(rtl)).toBe(rtl);
  });
});
