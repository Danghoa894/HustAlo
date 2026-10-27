import { ErrorCode } from '@hustalo/shared';
import { describe, expect, it } from 'vitest';
import { ERROR_MESSAGES, UNKNOWN_ERROR_MESSAGE, errorMessage } from './errors';

describe('i18n/errors', () => {
  it('mọi ErrorCode có chuỗi tiếng Việt không rỗng, không chứa thuật ngữ kỹ thuật', () => {
    for (const code of Object.values(ErrorCode)) {
      const msg = ERROR_MESSAGES[code];
      expect(msg.length).toBeGreaterThan(0);
      expect(msg).not.toMatch(/token|socket|HTTP|ICE|\d{3}/i);
      expect(msg).not.toContain('!');
    }
  });

  it('mã không biết → "Đã có lỗi xảy ra. Vui lòng thử lại."', () => {
    expect(UNKNOWN_ERROR_MESSAGE).toBe('Đã có lỗi xảy ra. Vui lòng thử lại.');
    expect(errorMessage('MA_LA')).toBe(UNKNOWN_ERROR_MESSAGE);
    expect(errorMessage(undefined)).toBe(UNKNOWN_ERROR_MESSAGE);
    expect(errorMessage('USER_BLOCKED')).toBe(ERROR_MESSAGES.USER_BLOCKED);
  });
});
