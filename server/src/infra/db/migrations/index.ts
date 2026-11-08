// server/src/infra/db/migrations/index.ts — danh sách migration dữ liệu (database_schema.md §6.4).
// Mỗi migration là file `NNN-<tên>.ts` cùng thư mục, export `{ id: 'NNN-<tên>', up }`; `up` idempotent, xử lý theo lô
// 500 document theo `_id` tăng dần. Thêm migration mới: tạo file rồi thêm vào mảng dưới (runner tự sắp theo id).
// MVP v1.0.0 không có migration nào.
import type { ClientSession } from 'mongoose';

export interface Migration {
  /** `NNN-<tên>`, ví dụ `001-backfill-member-count`; thứ tự chạy = thứ tự chuỗi id. */
  id: string;
  /** Idempotent; tự mở transaction (`withTxn`) nếu cần. */
  up(session?: ClientSession): Promise<void>;
}

export const MIGRATIONS: readonly Migration[] = [];
