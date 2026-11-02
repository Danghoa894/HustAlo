# HUSTALO — Vấn đề đã biết

Ghi nhận hiện tượng, chưa sửa. Mỗi mục cần quyết định (sửa test, sửa code hay cập nhật spec) trước khi đóng.

## KI-01 — `TC-AC-003` chập chờn (M1, chênh lệch thời gian đăng nhập)

- **Test:** `server/src/modules/auth/auth.int.test.ts` › `POST /auth/login (FR-AUTH-002)` › `TC-AC-003 sai mật khẩu / email không tồn tại / LOCKED → 401 cùng message; chênh lệch trung vị < 50 ms`.
- **Hiện tượng:** 2026-11-01 fail 2/3 lần chạy (lần gần nhất `AssertionError: expected 78.95249999999942 to be less than 50`), pass ở lượt chạy toàn bộ sau đó. Máy dev Windows, Docker Desktop vừa khởi động, nhiều tiến trình test chạy song song.
- **Nghi nguyên nhân:** argon2id tốn CPU; khi máy tải nặng, độ lệch trung vị giữa nhánh "user tồn tại" và "dummy hash" vượt ngưỡng dù code chống timing vẫn đúng (`infra/crypto/password.ts`).
- **Ràng buộc:** KHÔNG nới ngưỡng 50 ms khi chưa cập nhật spec (PRD AC-003 / EC-AUTH-*).
- **Hướng xử lý cần duyệt:** tăng số mẫu / bỏ mẫu ngoại lai, hoặc chạy test này tuần tự (không song song với file khác), hoặc sửa spec nêu điều kiện đo.

## KI-02 — `TC-AC-061` chập chờn (M4, grace presence)

- **Test:** `server/src/modules/presence/presence.int.test.ts` › `TC-AC-061 đóng tab rồi mở lại trong grace → không OFFLINE; đóng hẳn → OFFLINE sau grace, lastSeenAt ≈ lúc đóng`.
- **Hiện tượng:** 2026-11-01 fail 1 lần khi chạy cả bộ integration ngay sau khi bật Docker; pass 2/2 khi chạy lại riêng file và pass ở các lượt chạy toàn bộ sau đó.
- **Nghi nguyên nhân:** test dùng thời gian rút ngắn (`graceMs` 500, `sweepMs` 50); dưới tải, độ trễ event lớn hơn biên của khẳng định `lastSeenAt ≈ lúc đóng`.
- **Hướng xử lý cần duyệt:** nới biên thời gian _trong test_ theo tỉ lệ với `TIMING` (không đổi hằng số spec), hoặc chạy file presence tuần tự.

## KI-03 — Test unit client hết thời gian chờ 5 s khi máy tải nặng

- **Hiện tượng:** khi `npm run test:unit` chạy cùng lúc với lint/integration, 1–8 test client (khác nhau giữa các lần: `LoginPage`, `RegisterPage`, `MessageRoom`, `ChatListPane`, `groups` › `TC-GROUP-001`, `SecuritySection`, `ProfileSection`, `ChatRoomPane`) báo `Test timed out in 5000ms`; vitest báo `environment` ~1170 s. Chạy riêng các file đó: 50/50 pass, mỗi test ~2 s.
- **Nghi nguyên nhân:** jsdom + nhiều worker song song trên máy dev; biên 5 s chỉ gấp ~2,5 lần thời gian thật của test chậm nhất.
- **Hướng xử lý cần duyệt:** giới hạn số worker cho client (`poolOptions`), tăng `testTimeout` cho các test tương tác dài, hoặc tối ưu các test dùng `findBy*` chuỗi dài.
