# Review thư viện Signal phía trình duyệt (R-04, D-12)

- **Thư viện:** `@privacyresearch/libsignal-protocol-typescript` **0.0.16**, ghim chính xác trong `client/package.json` và `package-lock.json`.
- **Phụ thuộc:**
  - `@privacyresearch/curve25519-typescript` 0.0.12: curve25519-donna và ed25519 biên dịch bằng Emscripten (asm.js).
  - `@privacyresearch/libsignal-protocol-protobuf-ts` 0.0.9: protobuf của WhisperMessage và PreKeyWhisperMessage.
  - `base64-js`.
- **Giấy phép:** cả ba gói `@privacyresearch/*` đều là **GPL-3.0-only**. Chủ dự án đã duyệt dùng GPL ngày 2026-11-04. Repo khai báo `"license": "GPL-3.0-only"` (root và mọi workspace), kèm `LICENSE`.
- **Người duy trì:** 2 maintainer trên npm. Lần cập nhật gói gần nhất là 2025-06-18; phiên bản vẫn ở 0.0.x.
- **Ngày review:** 2026-11-04. Phạm vi: mã phát hành trong `node_modules/.../lib`, đúng mã chạy trong bundle.

## 1. Cách dự án dùng thư viện

- Chỉ `client/src/lib/e2ee/signal-adapter.ts` import thư viện, và chỉ bằng `import()` động.
- Thư viện nằm ở chunk riêng (≈ 137 KB gzip), không vào JS khởi tạo (NFR-05: 177,9 KB gzip / 300 KB).
- Muốn thay thư viện chỉ cần cài lại interface của adapter:
  - sinh khóa;
  - `processBundle`, `encryptFor`, `decryptFrom`, `hasSession`;
  - `fingerprint`.
- Mọi thao tác mật mã chạy tuần tự qua `serial()`, để hai tin đến cùng lúc không ghi đè trạng thái ratchet của nhau.
- Store (`SignalStore`, IndexedDB `hustalo-signal-{userId}`) do dự án tự viết. Khóa riêng được lưu dạng base64.

## 2. Kết quả kiểm tra

| #   | Hạng mục                  | Mã nguồn                                                                                                                                                             | Đánh giá                                                                                                      |
| --- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | Nguồn ngẫu nhiên          | `internal/crypto.js` `getRandomBytes` dùng `globalThis.crypto.getRandomValues`. `msrcrypto` (có PRNG `Math.random`) chỉ là fallback khi không có `globalThis.crypto` | ✅ Mọi trình duyệt mục tiêu (Chrome, Firefox, Safari 17) đều có WebCrypto, nên không bao giờ rơi vào fallback |
| 2   | Khóa định danh / prekey   | `KeyHelper` sinh private key 32 byte ngẫu nhiên. `curve25519-typescript` (curve25519-donna) tính public key 33 byte, có tiền tố `0x05`                               | ✅ Khớp định dạng server: 44 ký tự base64 (`userDevice.model.ts`). Có unit test                               |
| 3   | Chữ ký signed prekey      | `session-builder.js` gọi `Ed25519Verify(identityKey, signedPreKey.publicKey, signature)` trước X3DH. Sai → throw                                                     | ✅ Có test "chữ ký sai → processBundle lỗi"                                                                   |
| 4   | X3DH / Double Ratchet     | HKDF (HMAC-SHA256) gồm 3 khối. Khóa tin nhắn dẫn xuất từ chain key và xóa ngay sau khi dùng (`delete chain.messageKeys[counter]`)                                    | ✅ Giống thiết kế libsignal v3                                                                                |
| 5   | Mã hóa nội dung           | AES-256-CBC + HMAC-SHA256 cắt còn 8 byte (định dạng WhisperMessage v3), qua WebCrypto                                                                                | ✅ Đúng giao thức gốc. Không tự cài AES/HMAC                                                                  |
| 6   | So sánh MAC               | `verifyMAC` dùng vòng lặp OR-XOR trên toàn bộ độ dài và kiểm độ dài trước                                                                                            | ✅ Thời gian so sánh không phụ thuộc vị trí byte sai. Test "sửa 1 byte → lỗi" ở cả unit và E2E (TC-AC-114)    |
| 7   | One-time prekey           | `session-cipher.js:237` gọi `removePreKey(preKeyId)` sau khi giải mã PreKey message thành công                                                                       | ✅ Khóa riêng OTPK bị xóa sau một lần dùng. Phía server, mỗi OTPK chỉ được cấp một lần (TC-DB-016)            |
| 8   | Phát lại tin cũ           | Khóa tin đã dùng bị xóa, nên giải mã lại cùng bản mã sẽ lỗi                                                                                                          | ✅ Có test. Đây cũng là lý do dự án lưu bản rõ cục bộ (kiến trúc §9.3)                                        |
| 9   | Tin tới không theo thứ tự | Lưu message key của các counter bị bỏ qua trong chain                                                                                                                | ✅ Hỗ trợ, theo giới hạn của thư viện                                                                         |

## 3. Vấn đề phát hiện và cách xử lý

| #   | Vấn đề                                                                                                                                                        | Mức                    | Xử lý trong dự án                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V-1 | `session-cipher.js:322` gọi `console.warn('no chain found for key', { key, session })`: in **cả object session (root key, chain key)** ra console trình duyệt | Cao (lộ bí mật cục bộ) | `signal-adapter.ts` bọc `console.warn`, bỏ các cảnh báo bắt đầu bằng `no chain found for key` / `Invalid public key` (`isLibraryWarning`, có unit test). Đề xuất gửi issue/PR cho upstream                                       |
| V-2 | `isTrustedIdentity(name)` chỉ nhận tên người dùng, không có device. Mỗi device có identity riêng, nên kiểm tra tin cậy theo tên là sai                        | Trung bình             | Store luôn trả `true`. Ứng dụng tự so identity theo từng device với bundle mới nhất trước khi gửi (`envelope.ts`). `saveIdentity(address)` đánh dấu `changed`/`wasVerified` khi đổi, và chặn gửi nếu device đã xác minh (AC-113) |
| V-3 | `encrypt` gọi `this.storage.saveIdentity(...)` không `await`                                                                                                  | Thấp                   | `saveIdentity` của store idempotent (cùng khóa → không ghi), nên không tạo trạng thái sai                                                                                                                                        |
| V-4 | `FingerprintGenerator` hash bằng `msrcrypto` (JS thuần): 2 × 5200 vòng SHA-512 mất hàng chục giây trên trình duyệt (E2E timeout)                              | Trung bình (UX)        | `fingerprint()` trong adapter cài lại cùng thuật toán (NumericFingerprint v0) bằng `crypto.subtle.digest` gốc. Unit test khẳng định kết quả trùng từng chữ số với `FingerprintGenerator` của thư viện                            |
| V-5 | `validatePubKeyFormat` in khóa công khai sai định dạng ra console                                                                                             | Thấp (khóa công khai)  | Cũng bị lọc như V-1                                                                                                                                                                                                              |
| V-6 | Kiểm tra `instanceof ArrayBuffer` thất bại với ArrayBuffer khác realm (IndexedDB clone, jsdom) → lỗi "Invalid private key"                                    | Thấp                   | Store lưu khóa dạng base64 và tạo `ArrayBuffer` mới khi đọc. Test mật mã chạy `@vitest-environment node`                                                                                                                         |
| V-7 | Phiên bản 0.0.x, ít người duy trì, chưa có audit độc lập công khai                                                                                            | Rủi ro dự án (R-04)    | Ghim phiên bản, cô lập sau adapter, theo dõi `npm audit`. Lúc review không có advisory nào cho 3 gói                                                                                                                             |

## 4. Không phát hiện

- Không có lời gọi mạng nào trong thư viện.
- Không ghi bản rõ hay khóa ra storage nào ngoài `StorageType` mà dự án cung cấp.
- Không có `eval` hay `new Function`, kể cả trong phần asm.js do Emscripten sinh. Quét chunk Signal của `client/dist` (bản build) cũng cho 0 kết quả, nên CSP production `script-src 'self'` không chặn thư viện. E2E chạy trên dev server (không có CSP này), nên điểm này còn cần xác nhận lại ở lần smoke trên production.

## 5. Kiểm chứng

- Unit test (`client/src/lib/e2ee/*.test.ts`) chạy thư viện thật cho các nội dung sau:
  - X3DH có và không có OTPK;
  - ratchet hai chiều;
  - sửa 1 byte → lỗi;
  - phát lại → lỗi;
  - chữ ký sai;
  - safety number trùng hai phía và trùng với thư viện;
  - lọc cảnh báo.
- E2E `client/e2e/e2ee.spec.ts` chạy trên 3 trình duyệt: AC-110..122.
- Mỗi lần nâng phiên bản thư viện: review lại các mục ở bảng 2 và 3, rồi chạy lại hai bộ test trên.
