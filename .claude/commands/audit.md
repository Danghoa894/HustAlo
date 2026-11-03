---
description: Kiểm tra tiến độ và mức độ tuân thủ .spec/ (chỉ đọc)
model: sonnet
---

# Kiểm tra tiến độ & tuân thủ spec HUSTALO

Phạm vi: $ARGUMENTS (để trống = milestone đầu tiên chưa "Đạt DoD" trong docs/STATUS.md; "all" = M0–M7).
Milestone ngoài phạm vi: chỉ kiểm file checklist có tồn tại không, không đối chiếu chi tiết.

## Luật bắt buộc
- CHỈ ĐỌC và CHẠY LỆNH KIỂM TRA. Không sửa code, test, spec, config. Không cài package, không commit.
- File được phép tạo/ghi duy nhất: `docs/STATUS.md` và `docs/SPEC_CONFORMANCE.md`.
- Mọi kết luận phải có bằng chứng: đường dẫn file + số dòng, tên test, hoặc output lệnh. Không tìm thấy thì ghi "Không tìm thấy", không suy đoán.
- `.spec/` là nguồn sự thật. Code khác spec thì ghi là lệch, kể cả khi code có vẻ hợp lý hơn; đánh dấu "đề xuất sửa spec" nếu bạn cho rằng spec sai.
- Không in secret (giá trị trong .env) ra báo cáo.

## Bước 1 — Trạng thái repo
Chạy và ghi lại: `git status`, `git branch --show-current`, `git log --oneline -15`, `git worktree list`.
Cảnh báo nếu: còn worktree ngoài thư mục gốc, có thay đổi chưa commit, thiếu file .env so với các .env.example.

## Bước 2 — Chạy kiểm tra tự động
Chạy từng lệnh, ghi số pass/fail và 5 lỗi đầu tiên (nếu có).
Ghi output mỗi lệnh ra file tạm; chỉ đọc dòng tổng kết (`Tests`, `Test Files`, `FAIL`, `exit=`) và tối đa 5 lỗi đầu.
0. Chạy `docker ps` trước. Docker không chạy → bỏ hẳn mục 4, ghi "Không xác minh (Docker tắt)".
1. `npm run typecheck`
2. `npm run lint`
3. `npm run test:unit`
4. `npm run test:integration` — chạy 1 lần; chỉ chạy lại riêng file fail (tối đa 2 lần) để phát hiện chập chờn
5. `npm run spec:check`
6. `npm run trace:check -- --milestone <Mx> --strict` cho từng milestone trong phạm vi
7. `npm run build` — chỉ khi phạm vi ≥ M6 hoặc client/ có thay đổi
Script không tồn tại thì ghi "Thiếu script" (đó cũng là một phát hiện). Docker chưa chạy thì ghi rõ và bỏ qua test cần DB.

## Bước 3 — Đối chiếu code với từng file spec
Chỉ đối chiếu lại các mục có file thay đổi kể từ commit ghi trong docs/STATUS.md
(`git diff --name-only <sha>..HEAD`). Mục không đổi: giữ nguyên bảng cũ, ghi "Không đổi từ audit <ngày>".
Với mỗi mục, lập bảng: `Hạng mục | Spec nói gì (file §mục) | Code thực tế (file:dòng) | Trạng thái: Khớp / Lệch / Thiếu / Thừa`.

**3.1 system_architecture.md**
- Cấu trúc thư mục monorepo và tên file theo quy ước (`*.routes.ts, *.controller.ts, *.service.ts, *.repository.ts, *.schema.ts, *.model.ts`, `realtime/handlers/*.handler.ts`).
- Ranh giới module: có import chéo model/repository giữa module không (grep thực tế, không chỉ tin ESLint).
- State machine cuộc gọi (nếu đã làm): bảng chuyển trạng thái trong code so với spec.
- Quy tắc chung: senderId lấy từ token, ACK sau commit, không log token/nội dung/SDP (grep logger).

**3.2 packages/shared vs spec**
- Hằng số: so từng hằng số trong spec với `constants.ts` (tên + giá trị + đơn vị).
- Enum, mã lỗi, tên socket event: so khớp từng phần tử; liệt kê phần tử thiếu/thừa/sai chính tả.

**3.3 api_spec.yaml**
- Liệt kê toàn bộ route Express thực tế (method + path). So với các path trong spec: đã làm / chưa làm / có trong code nhưng không có trong spec.
- Với route đã làm: so request schema (Zod) với ràng buộc trong spec (minLength, maxLength, format), mã HTTP trả về và định dạng `ErrorResponse`.
- So `x-socket-events` với các handler socket đã đăng ký.

**3.4 database_schema.md**
- Với mỗi collection đã có model: so field, kiểu, required, default, `select: false`, và **index** (unique/partial/TTL) với spec.
- Collection có trong spec nhưng chưa có model: ghi theo milestone dự kiến.
- Key Redis: pattern + TTL trong code so với bảng key của spec.

**3.5 product_requirements.md**
- Với các FR thuộc phạm vi: đã cài đặt chưa (bằng chứng code).
- Với mỗi AC/EC thuộc phạm vi: có test mang đúng Test ID chưa, test đó đang pass hay fail.
- Ghi riêng: AC có test nhưng test chỉ kiểm hời hợt (ví dụ chỉ kiểm status 200 mà không kiểm dữ liệu/side effect).

**3.6 ui_ux_spec.md** (nếu client đã có màn hình)
- Route và route guard so với sơ đồ route trong spec.
- Màn hình đã làm: cây component, các trạng thái loading/empty/error.
- Chuỗi tiếng Việt trong code so với microcopy/ma trận trạng thái UI (khớp nguyên văn).
- Design tokens (Tailwind theme, Light/Dark) so với spec.

**3.7 development_guide.md**
- Script trong package.json gốc so với danh sách script trong spec.
- Biến môi trường: `.env.example` so với danh sách biến trong spec (thiếu/thừa/sai tên).
- docker-compose: service, replica set, healthcheck so với spec.

## Bước 4 — Tiến độ theo milestone
Đọc checklist từng milestone trong development_guide.md. Với mỗi mục checklist: `Xong / Dở / Chưa làm` + bằng chứng.
Một milestone chỉ được ghi "Đạt DoD" khi: mọi mục checklist Xong, mọi AC/test bắt buộc của milestone pass, typecheck/lint/test xanh.

## Bước 5 — Kiểm tra rủi ro bảo mật nhanh
- Có secret/mật khẩu hardcode trong code hoặc commit không (grep: secret, password, XIRSYS, JWT_, mongodb://...@).
- `.env` có bị git theo dõi không (`git ls-files | grep .env`).
- Có dùng `dangerouslySetInnerHTML` với dữ liệu người dùng không.
- Có phân trang lịch sử bằng `skip` không.
- Có hiển thị chữ "Mã hóa đầu-cuối" trước M7 không.

## Bước 6 — Ghi báo cáo
**docs/STATUS.md** (ngắn, để đọc nhanh):
1. Ngày kiểm tra, nhánh, commit cuối.
2. Bảng tổng: `Milestone | Trạng thái (Đạt DoD / Đang làm / Chưa bắt đầu) | % checklist | AC pass/tổng | Ghi chú`.
3. Kết quả bước 2 (bảng lệnh → pass/fail).
4. Top 10 việc cần làm tiếp theo, xếp theo mức độ: Chặn > Cao > TB > Thấp, mỗi việc ghi file liên quan và ID spec.

**docs/SPEC_CONFORMANCE.md** (chi tiết):
- Chỉ cập nhật các mục đã đối chiếu lại ở bước 3; giữ nguyên phần còn lại.
- Mục "Đề xuất sửa spec": chỗ nào spec sai/thiếu/mâu thuẫn với thực tế, kèm lý do. KHÔNG tự sửa.

## Bước 7 — Trả lời trong chat
Tóm tắt tối đa 15 dòng: milestone hiện tại, số lỗi Chặn/Cao, 3 việc nên làm ngay, câu hỏi cần tôi quyết định (nếu có). Sau đó DỪNG, chờ tôi.