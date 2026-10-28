// client/src/i18n/vi.ts — toàn bộ chuỗi UI tiếng Việt (development_guide.md §8.4, ui_ux_spec.md §5.1).
// Bổ sung theo milestone; không viết chuỗi UI trực tiếp trong component.
import { DISPLAY_NAME_MAX } from '@hustalo/shared';

export const vi = {
  app: {
    name: 'HUSTALO',
    loading: 'Đang tải…',
    skipToContent: 'Bỏ qua tới nội dung chính',
  },
  common: {
    close: 'Đóng',
    retry: 'Thử lại',
    cancel: 'Hủy',
    back: 'Quay lại',
    save: 'Lưu',
    showPassword: 'Hiện mật khẩu',
    hidePassword: 'Ẩn mật khẩu',
    required: 'Vui lòng nhập thông tin này',
  },
  notFound: {
    title: 'Không tìm thấy trang',
    backHome: 'Về trang chính',
  },
  chat: {
    emptyRoom: 'Chọn một cuộc trò chuyện để bắt đầu nhắn tin',
  },
  // ui_ux_spec.md §3.1
  auth: {
    loginTitle: 'Đăng nhập',
    registerTitle: 'Đăng ký',
    email: 'Email',
    password: 'Mật khẩu',
    username: 'Tên người dùng',
    displayName: 'Tên hiển thị',
    confirmPassword: 'Nhập lại mật khẩu',
    usernameHint: '3–30 ký tự: a–z, 0–9, dấu chấm, gạch dưới',
    passwordHint: 'Ít nhất 8 ký tự, gồm chữ và số',
    submitLogin: 'Đăng nhập',
    submittingLogin: 'Đang đăng nhập…',
    submitRegister: 'Tạo tài khoản',
    submittingRegister: 'Đang tạo tài khoản…',
    noAccount: 'Chưa có tài khoản?',
    goRegister: 'Đăng ký',
    haveAccount: 'Đã có tài khoản?',
    goLogin: 'Đăng nhập',
    invalidCredentials: 'Email hoặc mật khẩu không đúng',
    emailTaken: 'Email này đã được sử dụng',
    usernameTaken: 'Tên người dùng đã tồn tại',
    invalidEmail: 'Email không hợp lệ',
    invalidUsername: 'Tên người dùng không hợp lệ',
    invalidPassword: 'Mật khẩu cần ít nhất 8 ký tự, gồm chữ và số',
    passwordMismatch: 'Mật khẩu nhập lại không khớp',
    rateLimited: (n: number) => `Bạn đã thử quá nhiều lần. Vui lòng thử lại sau ${n} giây.`,
    serverBusy: 'Máy chủ đang bận, vui lòng thử lại',
    offline: 'Không có kết nối mạng',
  },
  // ui_ux_spec.md §3.9
  session: {
    relogin: 'Đăng nhập lại',
    REFRESH_REUSE: 'Phiên đăng nhập đã bị thu hồi vì lý do bảo mật. Vui lòng đăng nhập lại.',
    ACCOUNT_LOCKED: 'Tài khoản của bạn đã bị khóa.',
    PASSWORD_CHANGED: 'Mật khẩu đã được thay đổi. Vui lòng đăng nhập lại.',
    DEVICE_REVOKED: 'Thiết bị này đã bị thu hồi. Vui lòng đăng nhập lại.',
    EXPIRED: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  },
  // ui_ux_spec.md §3.0, §4.1
  connection: {
    reconnecting: 'Đang kết nối lại…',
    offline: 'Không có kết nối mạng',
  },
  // ui_ux_spec.md §3.8
  settings: {
    title: 'Cài đặt',
    sections: {
      profile: 'Hồ sơ',
      security: 'Bảo mật',
    },
    logout: 'Đăng xuất',
    saved: 'Đã lưu thay đổi',
    profile: {
      displayName: 'Tên hiển thị',
      avatarUrl: 'Ảnh đại diện (URL)',
      username: 'Tên người dùng',
      email: 'Email',
      counter: (n: number) => `${n}/${DISPLAY_NAME_MAX}`,
      invalidAvatarUrl: 'Ảnh đại diện phải là URL https://',
    },
    security: {
      changePassword: 'Đổi mật khẩu',
      currentPassword: 'Mật khẩu hiện tại',
      newPassword: 'Mật khẩu mới',
      confirmNewPassword: 'Nhập lại mật khẩu mới',
      wrongCurrentPassword: 'Mật khẩu hiện tại không đúng',
      changed: 'Đã đổi mật khẩu',
      othersLoggedOut: 'Các thiết bị khác đã được đăng xuất.',
    },
  },
} as const;
