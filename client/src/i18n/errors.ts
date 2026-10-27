// client/src/i18n/errors.ts — ánh xạ ErrorCode → chuỗi hiển thị (ui_ux_spec.md §5.1 quy tắc 6).
// Không bao giờ hiển thị error.message của server; mã không biết → UNKNOWN_ERROR_MESSAGE.
import { ErrorCode } from '@hustalo/shared';

export const UNKNOWN_ERROR_MESSAGE = 'Đã có lỗi xảy ra. Vui lòng thử lại.';

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'Thông tin chưa hợp lệ. Vui lòng kiểm tra lại.',
  UNAUTHENTICATED: 'Phiên đăng nhập đã hết. Vui lòng đăng nhập lại.',
  TOKEN_EXPIRED: 'Phiên đăng nhập đã hết. Vui lòng đăng nhập lại.',
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  NOT_FOUND: 'Không tìm thấy nội dung bạn yêu cầu.',
  CONFLICT: 'Dữ liệu đã thay đổi. Vui lòng thử lại.',
  RATE_LIMITED: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.',
  NOT_A_MEMBER: 'Bạn không còn là thành viên của cuộc trò chuyện này.',
  CONVERSATION_FULL: 'Nhóm đã đủ số thành viên tối đa.',
  USER_BLOCKED: 'Không thể thực hiện vì một trong hai người đã chặn người kia.',
  DUPLICATE_MESSAGE: 'Tin nhắn đã được gửi.',
  CALL_NOT_FOUND: 'Cuộc gọi không còn tồn tại.',
  CALL_INVALID_STATE: 'Cuộc gọi đã thay đổi trạng thái. Vui lòng thử lại.',
  CALL_BUSY: 'Người nhận đang bận.',
  CALL_TIMEOUT: 'Cuộc gọi đã hết thời gian chờ.',
  CALL_ALREADY_ANSWERED: 'Cuộc gọi đã được trả lời trên thiết bị khác.',
  E2EE_KEYS_UNAVAILABLE: 'Chưa thể thiết lập cuộc trò chuyện bí mật. Vui lòng thử lại sau.',
  E2EE_DECRYPT_FAILED: 'Không thể hiển thị nội dung tin nhắn này.',
  SERVICE_UNAVAILABLE: 'Dịch vụ tạm thời gián đoạn. Vui lòng thử lại sau.',
  INTERNAL_ERROR: UNKNOWN_ERROR_MESSAGE,
};

const KNOWN = new Set<string>(Object.values(ErrorCode));

export function errorMessage(code: string | undefined | null): string {
  return code !== undefined && code !== null && KNOWN.has(code)
    ? ERROR_MESSAGES[code as ErrorCode]
    : UNKNOWN_ERROR_MESSAGE;
}
