// client/src/i18n/vi.ts — toàn bộ chuỗi UI tiếng Việt (development_guide.md §8.4, ui_ux_spec.md §5.1).
// Bổ sung theo milestone; không viết chuỗi UI trực tiếp trong component.
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
    showPassword: 'Hiện mật khẩu',
  },
  notFound: {
    title: 'Không tìm thấy trang',
    backHome: 'Về trang chính',
  },
  chat: {
    emptyRoom: 'Chọn một cuộc trò chuyện để bắt đầu nhắn tin',
  },
  auth: {
    loginTitle: 'Đăng nhập',
    registerTitle: 'Đăng ký',
  },
  settings: {
    title: 'Cài đặt',
  },
} as const;
