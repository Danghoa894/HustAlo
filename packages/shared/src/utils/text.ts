// packages/shared/src/utils/text.ts — chuẩn hóa nội dung tin nhắn (D-17)
import { MESSAGE_MAX_LENGTH } from '../constants';

// Khoảng trắng Unicode + zero-width U+200B–U+200D, U+2060, U+FEFF ở hai đầu chuỗi.
const EDGE_TRIM = /^[\s\u200B-\u200D\u2060\uFEFF]+|[\s\u200B-\u200D\u2060\uFEFF]+$/gu;

export function normalizeMessageText(input: string): string {
  return input.normalize('NFC').replace(EDGE_TRIM, '');
}

export function countCodePoints(s: string): number {
  return Array.from(s).length;
}

export function isValidMessageText(input: string): boolean {
  const n = countCodePoints(normalizeMessageText(input));
  return n >= 1 && n <= MESSAGE_MAX_LENGTH;
}

/** Chuẩn hóa để tìm kiếm tiền tố displayName: bỏ dấu tiếng Việt, đ→d, chữ thường (database_schema.md §2.1). */
export function normalizeForSearch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .trim();
}

/** displayName: NFC + trim, dùng chung cho đăng ký và cập nhật hồ sơ (FR-AUTH-001, FR-USER-002). */
export function normalizeDisplayName(s: string): string {
  return s.normalize('NFC').replace(EDGE_TRIM, '');
}
