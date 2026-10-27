# HUSTALO — Quy tắc cho AI Agent

## Nguồn sự thật
- Mọi yêu cầu nằm trong `.spec/`. Đọc file spec liên quan TRƯỚC khi code.
- Không tự đổi tech stack, tên event, enum, mã lỗi, hằng số. Nếu spec sai/thiếu:
  DỪNG LẠI, đề xuất sửa spec, chờ tôi duyệt, rồi mới code.
- Enum, hằng số, Zod schema, kiểu event dùng chung đặt trong `packages/shared`.

## Quy trình mỗi tác vụ
1. Đọc spec liên quan + trích các ID (FR/AC/EC) sẽ xử lý.
2. Lập kế hoạch, liệt kê file sẽ tạo/sửa.
3. Viết test theo AC/EC trước, rồi code cho pass.
4. Chạy `npm run typecheck && npm run lint && npm test` — phải xanh mới báo xong.
5. Cập nhật Traceability Matrix nếu thêm/đổi hành vi.

## Cấm
- Commit secret, log token/nội dung tin nhắn/SDP.
- Dùng `dangerouslySetInnerHTML` với dữ liệu người dùng.
- Hiển thị "Mã hóa đầu-cuối" khi chưa xong milestone M7.
- `skip`-based pagination cho lịch sử tin nhắn.

## Lệnh
- Hạ tầng: `npm run infra:up` | Dev: `npm run dev` | Test: `npm test`