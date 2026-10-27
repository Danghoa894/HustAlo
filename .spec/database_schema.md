# HUSTALO — Database Schema

| Thuộc tính | Giá trị |
|---|---|
| Version | 1.0.0 |
| Status | Draft — chờ review (file 3/6) |
| Ngày | 2026-10-27 |
| Phụ thuộc | `system_architecture.md` v1.0.0, `product_requirements.md` v1.0.0 |

**File liên quan:**

| File | Quan hệ |
|---|---|
| `system_architecture.md` | Hằng số/enum (§4.4), luồng (§7), state machine cuộc gọi (§8), mã hóa AES-GCM (§9.2), Redis key tóm tắt (Phụ lục A). File này đặc tả chi tiết thao tác. |
| `product_requirements.md` | FR/AC/EC; §3.9 liệt kê các trường nghiệp vụ bắt buộc — tất cả có trong file này. |
| `api_spec.yaml` | DTO được dựng từ các collection này qua `toDTO` của service (không trả document thô). |
| `development_guide.md` | `npm run db:indexes`, `npm run db:seed`, `npm run db:migrate -w server`, `npm run job:reencrypt -w server`. |

**Thuật ngữ:**

| Thuật ngữ | Nghĩa |
|---|---|
| Tuple cursor | Cặp `(createdAt, _id)` dùng so sánh thứ tự tin nhắn; `a > b` ⇔ `a.createdAt > b.createdAt` hoặc (`a.createdAt == b.createdAt` và `a._id > b._id`). |
| Người tham gia | Bản ghi `conversationMembers` có `leftAt = null`. |
| Terminal | `CallStatus` thuộc `CALL_TERMINAL_STATUSES`. |
| Model file | `server/src/modules/<module>/<entity>.model.ts` theo cây thư mục kiến trúc §4.1. |

---

## 1. Quy ước

| Quy ước | Quy tắc |
|---|---|
| Khóa chính | `_id: ObjectId` do server sinh (`new Types.ObjectId()`), trừ khi ghi khác. `callHistory._id` = `callId`. |
| Tham chiếu | Trường `<x>Id` là `ObjectId` (user, conversation, message). `deviceId`, `tabId`, `clientMessageId` là chuỗi UUID v4. |
| Thời gian | `Date` UTC. Không lưu giờ địa phương. `createdAt` của `messages` do service gán tường minh (để ACK và AAD dùng cùng giá trị). |
| Tên trường | camelCase; tên collection camelCase số nhiều đúng danh sách ở mục 2. |
| `timestamps` | `{ timestamps: true }` cho mọi schema (`createdAt`, `updatedAt`) trừ khi ghi khác. |
| `strict` | `strict: 'throw'` — ghi trường không khai báo ném lỗi (phát hiện bug sớm). `strictQuery: true`. |
| `select: false` | `users.passwordHash`, `refreshSessions.tokenHash`, `refreshSessions.parentHash`. Service phải `.select('+passwordHash')` tường minh khi cần. |
| Mã hóa | `messages.contentEnc` là AES-256-GCM (kiến trúc §9.2); không lưu plaintext `content` ở bất kỳ đâu. |
| `versionKey` | `false` (không dùng `__v`); đồng thời dùng điều kiện nghiệp vụ trong filter thay cho optimistic version. |
| `autoIndex` | `false` ở mọi môi trường. Index tạo bằng `npm run db:indexes` (mục 6.3); global setup integration test gọi cùng hàm. |
| Transaction | Chỉ qua `withTxn()` (`server/src/infra/db/transaction.ts`), read concern `snapshot`, write concern `majority`, tối đa `MONGO_TXN_MAX_RETRIES` (3) lần. |
| Phân trang | Chỉ cursor tuple; **cấm `skip`** (CLAUDE.md). |
| Enum | Lấy mảng giá trị từ `@hustalo/shared` (`Object.values(CallStatus)`), không gõ lại chuỗi. |
| Lean | Truy vấn đọc dùng `.lean()`; service chuyển sang DTO. |

Tiện ích dùng chung cho mọi model:

```ts
// server/src/infra/db/schema-options.ts
import type { SchemaOptions } from 'mongoose';

export const baseSchemaOptions: SchemaOptions = {
  timestamps: true,
  strict: 'throw',
  strictQuery: true,
  versionKey: false,
  autoIndex: false,
  autoCreate: false, // collection tạo trong db:indexes
};
```

`server/src/infra/db/schema-options.ts` là file bổ sung vào cây `server/src/infra/db/` của kiến trúc §4.1.

---

## 2. Collection

Danh sách: `users`, `refreshSessions`, `userBlocks`, `conversations`, `conversationMembers`, `messages`, `messageReceipts`, `callHistory`, `userDevices`, `oneTimePreKeys`. Collection kỹ thuật duy nhất ngoài danh sách: `_migrations` (mục 6.4).

### 2.1 `users`

Model file: `server/src/modules/users/user.model.ts`.

| Field | Type | Required | Default | Constraint | Mô tả |
|---|---|---|---|---|---|
| `_id` | ObjectId | ✔ | auto | — | userId |
| `email` | String | ✔ | — | lowercase, trim, ≤ 254, unique | Email đăng nhập (FR-AUTH-001) |
| `username` | String | ✔ | — | khớp `USERNAME_PATTERN`, unique | Tên người dùng (FR-AUTH-001) |
| `passwordHash` | String | ✔ | — | PHC string bắt đầu `$argon2id$v=19$`, `select: false` | FR-SEC-004 |
| `displayName` | String | ✔ | — | NFC, trim, 1..`DISPLAY_NAME_MAX` (80) code point | Tên hiển thị |
| `displayNameNormalized` | String | ✔ | — | chữ thường, bỏ dấu, `đ→d`, ≤ 80 | Tìm kiếm tiền tố (FR-USER-001); service set mỗi khi đổi `displayName` |
| `avatarUrl` | String \| null | ✘ | `null` | `https://`, ≤ 2048 | FR-USER-002 |
| `status` | String | ✔ | `ACTIVE` | `UserStatus` | FR-AUTH-006 |
| `privacy.showLastSeen` | Boolean | ✔ | `true` | — | FR-USER-004 |
| `lastSeenAt` | Date \| null | ✘ | `null` | — | Ghi khi chuyển OFFLINE (FR-PRES-002) |
| `passwordChangedAt` | Date \| null | ✘ | `null` | — | FR-AUTH-005 |
| `createdAt`, `updatedAt` | Date | ✔ | auto | — | timestamps |

**Index:**

| Tên | Định nghĩa | Loại | Truy vấn dùng |
|---|---|---|---|
| `email_unique` | `{ email: 1 }` | unique | Login `findOne({ email })`; register chống trùng (EC-AUTH-001) |
| `username_unique` | `{ username: 1 }` | unique | Register chống trùng; tìm kiếm tiền tố `{ username: /^q/ }` (regex anchored dùng được index) |
| `displayName_search` | `{ displayNameNormalized: 1, _id: 1 }` | thường | Tìm kiếm tiền tố `{ displayNameNormalized: /^q/ }` |

**Quy tắc nghiệp vụ:**
- Email chuẩn hóa `trim().toLowerCase()` trước khi ghi/tra cứu; username client gửi chữ thường, server từ chối chữ hoa (`VALIDATION_ERROR`).
- `E11000` trên `email_unique`/`username_unique` → `CONFLICT` với `details.field`.
- Tìm kiếm escape ký tự regex trong `q` (`escapeRegExp`) trước khi dựng `^q`.
- Hàm `normalizeForSearch(s)` đặt ở `packages/shared/src/utils/text.ts`: `s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase().trim()`.

```ts
// server/src/modules/users/user.model.ts
import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { DISPLAY_NAME_MAX, USERNAME_PATTERN, UserStatus } from '@hustalo/shared';
import { baseSchemaOptions } from '../../infra/db/schema-options';

const privacySchema = new Schema(
  { showLastSeen: { type: Boolean, required: true, default: true } },
  { _id: false, strict: 'throw' },
);

const userSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    username: { type: String, required: true, match: USERNAME_PATTERN },
    passwordHash: { type: String, required: true, select: false },
    displayName: { type: String, required: true, trim: true, minlength: 1, maxlength: DISPLAY_NAME_MAX * 2 }, // code point kiểm ở Zod; *2 cho UTF-16
    displayNameNormalized: { type: String, required: true, maxlength: DISPLAY_NAME_MAX * 2 },
    avatarUrl: { type: String, default: null, maxlength: 2048, match: /^https:\/\// },
    status: { type: String, required: true, enum: Object.values(UserStatus), default: UserStatus.ACTIVE },
    privacy: { type: privacySchema, required: true, default: () => ({ showLastSeen: true }) },
    lastSeenAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
  },
  { ...baseSchemaOptions, collection: 'users' },
);

userSchema.index({ email: 1 }, { unique: true, name: 'email_unique' });
userSchema.index({ username: 1 }, { unique: true, name: 'username_unique' });
userSchema.index({ displayNameNormalized: 1, _id: 1 }, { name: 'displayName_search' });

export type User = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<User>;
export const UserModel = model('User', userSchema);
```

### 2.2 `refreshSessions`

Model file: `server/src/modules/auth/refreshSession.model.ts`. Mỗi document là **một thế hệ** refresh token; các thế hệ cùng một lần đăng nhập có chung `familyId` (= `sid` trong JWT).

| Field | Type | Required | Default | Constraint | Mô tả |
|---|---|---|---|---|---|
| `_id` | ObjectId | ✔ | auto | — | — |
| `familyId` | ObjectId | ✔ | — | — | Session family (`sid`) |
| `userId` | ObjectId | ✔ | — | ref users | — |
| `deviceId` | String | ✔ | — | UUID v4 | Device đăng nhập (`did`) |
| `tokenHash` | String | ✔ | — | hex 64, unique, `select: false` | `HMAC-SHA256(REFRESH_TOKEN_PEPPER, token)` |
| `parentHash` | String \| null | ✘ | `null` | hex 64, `select: false` | Hash thế hệ trước (null ở thế hệ đầu) |
| `replacedAt` | Date \| null | ✘ | `null` | — | Thời điểm bị xoay (có con) |
| `revokedAt` | Date \| null | ✘ | `null` | — | Thời điểm family bị thu hồi (ghi trên mọi thế hệ của family) |
| `revokeReason` | String \| null | ✘ | `null` | `SessionRevokeReason` | — |
| `expiresAt` | Date | ✔ | — | = phát hành + `REFRESH_TOKEN_TTL_S` | Hết hạn thế hệ này (trượt 30 ngày mỗi lần xoay) |
| `userAgent` | String | ✘ | `''` | ≤ 512 | Hiển thị/điều tra |
| `ip` | String | ✘ | `''` | ≤ 45 | IP lúc phát hành |
| `createdAt`, `updatedAt` | Date | ✔ | auto | — | — |

**Index:**

| Tên | Định nghĩa | Loại | Truy vấn dùng |
|---|---|---|---|
| `tokenHash_unique` | `{ tokenHash: 1 }` | unique | `POST /auth/refresh` tra token |
| `family` | `{ familyId: 1, createdAt: -1 }` | thường | Thu hồi family `updateMany({ familyId })`; tìm thế hệ con khi xét grace (D-19); fallback kiểm tra revoked khi Redis down |
| `user_device_active` | `{ userId: 1, deviceId: 1, revokedAt: 1 }` | thường | Login thu hồi family cũ cùng device; đổi mật khẩu thu hồi family khác; khóa tài khoản |
| `expires_ttl` | `{ expiresAt: 1 }` | TTL `expireAfterSeconds: 0` | Mongo tự xóa thế hệ đã hết hạn |

**Quy tắc nghiệp vụ:**
- Xoay (kiến trúc §7(a) trường hợp A) trong transaction: `updateOne({ _id: cur._id, replacedAt: null, revokedAt: null }, { $set: { replacedAt: now } })` — `modifiedCount = 0` nghĩa là tab khác vừa xoay → xử lý như trường hợp B; sau đó `create` thế hệ mới `{ familyId, parentHash: cur.tokenHash, expiresAt: now + 30d }`.
- Grace (B): `cur.replacedAt != null && now - cur.replacedAt ≤ REFRESH_REUSE_GRACE_S` và tồn tại thế hệ con `{ familyId, parentHash: cur.tokenHash, replacedAt: null, revokedAt: null }` → `409`.
- Reuse (C): `updateMany({ familyId }, { $set: { revokedAt: now, revokeReason: 'REFRESH_REUSE' } })`.
- Thế hệ cũ được giữ tới `expiresAt` để phát hiện reuse; TTL dọn dẹp sau đó.

```ts
// server/src/modules/auth/refreshSession.model.ts
import { Schema, model, type InferSchemaType } from 'mongoose';
import { SessionRevokeReason } from '@hustalo/shared';
import { baseSchemaOptions } from '../../infra/db/schema-options';

const HEX64 = /^[a-f0-9]{64}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const refreshSessionSchema = new Schema(
  {
    familyId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    deviceId: { type: String, required: true, match: UUID_V4 },
    tokenHash: { type: String, required: true, match: HEX64, select: false },
    parentHash: { type: String, default: null, match: HEX64, select: false },
    replacedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    revokeReason: { type: String, default: null, enum: [...Object.values(SessionRevokeReason), null] },
    expiresAt: { type: Date, required: true },
    userAgent: { type: String, default: '', maxlength: 512 },
    ip: { type: String, default: '', maxlength: 45 },
  },
  { ...baseSchemaOptions, collection: 'refreshSessions' },
);

refreshSessionSchema.index({ tokenHash: 1 }, { unique: true, name: 'tokenHash_unique' });
refreshSessionSchema.index({ familyId: 1, createdAt: -1 }, { name: 'family' });
refreshSessionSchema.index({ userId: 1, deviceId: 1, revokedAt: 1 }, { name: 'user_device_active' });
refreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expires_ttl' });

export type RefreshSession = InferSchemaType<typeof refreshSessionSchema>;
export const RefreshSessionModel = model('RefreshSession', refreshSessionSchema);
```

### 2.3 `userBlocks`

Model file: `server/src/modules/users/userBlock.model.ts`.

| Field | Type | Required | Default | Constraint | Mô tả |
|---|---|---|---|---|---|
| `_id` | ObjectId | ✔ | auto | — | — |
| `blockerId` | ObjectId | ✔ | — | ref users, ≠ `blockedId` | Người chặn |
| `blockedId` | ObjectId | ✔ | — | ref users | Người bị chặn |
| `createdAt`, `updatedAt` | Date | ✔ | auto | — | — |

**Index:**

| Tên | Định nghĩa | Loại | Truy vấn dùng |
|---|---|---|---|
| `blocker_blocked_unique` | `{ blockerId: 1, blockedId: 1 }` | unique | Chặn idempotent (upsert); `isBlockedEitherWay` nhánh 1; danh sách `blockedUserIds` của `/auth/me` |
| `blocked_blocker` | `{ blockedId: 1, blockerId: 1 }` | thường | `isBlockedEitherWay` nhánh 2; loại "người đã chặn mình" khỏi tìm kiếm (FR-USER-001) |

**Quy tắc nghiệp vụ:**
- Chặn: `updateOne({ blockerId, blockedId }, { $setOnInsert: { blockerId, blockedId } }, { upsert: true })`; `E11000` do đua → coi như thành công.
- Bỏ chặn: `deleteOne({ blockerId, blockedId })`, không tồn tại vẫn `204`.
- `isBlockedEitherWay(a, b)`: `exists({ $or: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] })` — mỗi nhánh dùng một index.
- `GET /auth/me` trả tối đa 1000 `blockedUserIds` (giới hạn MVP).

```ts
// server/src/modules/users/userBlock.model.ts
import { Schema, model, type InferSchemaType } from 'mongoose';
import { baseSchemaOptions } from '../../infra/db/schema-options';

const userBlockSchema = new Schema(
  {
    blockerId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    blockedId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: 'User',
      validate: {
        validator(this: { blockerId: unknown }, v: unknown) { return String(v) !== String(this.blockerId); },
        message: 'blockerId và blockedId phải khác nhau',
      },
    },
  },
  { ...baseSchemaOptions, collection: 'userBlocks' },
);

userBlockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true, name: 'blocker_blocked_unique' });
userBlockSchema.index({ blockedId: 1, blockerId: 1 }, { name: 'blocked_blocker' });

export type UserBlock = InferSchemaType<typeof userBlockSchema>;
export const UserBlockModel = model('UserBlock', userBlockSchema);
```

### 2.4 `conversations`

Model file: `server/src/modules/conversations/conversation.model.ts`.

| Field | Type | Required | Default | Constraint | Mô tả |
|---|---|---|---|---|---|
| `_id` | ObjectId | ✔ | auto | — | conversationId |
| `type` | String | ✔ | — | `ConversationType` | — |
| `title` | String \| null | ✘ | `null` | GROUP: bắt buộc, NFC, 1..`GROUP_TITLE_MAX` (100) code point; DIRECT/SECRET: `null` | Tên nhóm (plaintext — giới hạn đã ghi ở kiến trúc §9.2.1) |
| `directKey` | String \| null | ✘ | `null` | DIRECT/SECRET: `"${minUserId}:${maxUserId}"` (so sánh hex); GROUP: `null` | Khóa duy nhất cặp (FR-CHAT-001, D-11) |
| `createdBy` | ObjectId | ✔ | — | ref users | Người tạo |
| `idempotencyKey` | String \| null | ✘ | `null` | UUID v4 | `Idempotency-Key` của `POST /conversations` tạo GROUP |
| `memberCount` | Number | ✔ | — | int 1..`GROUP_MAX_MEMBERS` (DIRECT/SECRET = 2) | Số người tham gia hiện tại |
| `lastMessage` | Object \| null | ✘ | `null` | `{ messageId, senderId \| null, type, createdAt }` | Tin cuối (preview giải mã lúc đọc) |
| `lastMessageAt` | Date | ✔ | = `createdAt` | — | Sắp xếp danh sách hội thoại |
| `deletedAt` | Date \| null | ✘ | `null` | — | Soft delete khi OWNER duy nhất rời (FR-GROUP-004) |
| `createdAt`, `updatedAt` | Date | ✔ | auto | — | — |

**Index:**

| Tên | Định nghĩa | Loại | Truy vấn dùng |
|---|---|---|---|
| `type_directKey_unique` | `{ type: 1, directKey: 1 }` | unique, partial `{ directKey: { $type: 'string' } }` | Tạo DIRECT/SECRET an toàn khi đua (mục 4.3); tra cứu `findOne({ type, directKey })` |
| `creator_idem_unique` | `{ createdBy: 1, idempotencyKey: 1 }` | unique, partial `{ idempotencyKey: { $type: 'string' } }` | Idempotency tạo GROUP khi Redis không có cache (`idem:conv:*` chỉ là fast path) |
| `lastMessageAt_id` | `{ lastMessageAt: -1, _id: -1 }` | thường | `GET /conversations`: `find({ _id: { $in: myConvIds }, deletedAt: null }).sort({ lastMessageAt: -1, _id: -1 })` kèm điều kiện tuple cursor (mục 4.1) |

**Quy tắc nghiệp vụ:**
- `lastMessage`/`lastMessageAt` chỉ tiến về phía trước: update trong transaction gửi tin với điều kiện `lastMessageAt ≤ createdAt` mới.
- Sửa tin không đổi `lastMessage`; thu hồi tin cuối không đổi `lastMessage` (preview dựa vào `deletedAt` của message).
- DIRECT chỉ hiện với người không phải `createdBy` khi `lastMessage != null` (FR-CHAT-001).
- Giới hạn MVP: danh sách hội thoại của một user dựng từ `$in` trên `conversationMembers` — đủ nhanh tới khoảng 5.000 hội thoại/user; vượt mức này cần denormalize `lastMessageAt` sang `conversationMembers` (ghi chú cho sau MVP).

```ts
// server/src/modules/conversations/conversation.model.ts
import { Schema, model, type InferSchemaType } from 'mongoose';
import { ConversationType, GROUP_MAX_MEMBERS, GROUP_TITLE_MAX, MessageType } from '@hustalo/shared';
import { baseSchemaOptions } from '../../infra/db/schema-options';

const lastMessageSchema = new Schema(
  {
    messageId: { type: Schema.Types.ObjectId, required: true, ref: 'Message' },
    senderId: { type: Schema.Types.ObjectId, default: null, ref: 'User' },
    type: { type: String, required: true, enum: Object.values(MessageType) },
    createdAt: { type: Date, required: true },
  },
  { _id: false, strict: 'throw' },
);

const conversationSchema = new Schema(
  {
    type: { type: String, required: true, enum: Object.values(ConversationType) },
    title: {
      type: String,
      default: null,
      trim: true,
      maxlength: GROUP_TITLE_MAX * 2,
      required: [function (this: { type: string }) { return this.type === 'GROUP'; }, 'GROUP cần title'],
    },
    directKey: {
      type: String,
      default: null,
      match: /^[a-f0-9]{24}:[a-f0-9]{24}$/,
      required: [function (this: { type: string }) { return this.type !== 'GROUP'; }, 'DIRECT/SECRET cần directKey'],
    },
    createdBy: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    idempotencyKey: { type: String, default: null, maxlength: 36 },
    memberCount: { type: Number, required: true, min: 1, max: GROUP_MAX_MEMBERS },
    lastMessage: { type: lastMessageSchema, default: null },
    lastMessageAt: { type: Date, required: true, default: () => new Date() },
    deletedAt: { type: Date, default: null },
  },
  { ...baseSchemaOptions, collection: 'conversations' },
);

conversationSchema.index(
  { type: 1, directKey: 1 },
  { unique: true, partialFilterExpression: { directKey: { $type: 'string' } }, name: 'type_directKey_unique' },
);
conversationSchema.index(
  { createdBy: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } }, name: 'creator_idem_unique' },
);
conversationSchema.index({ lastMessageAt: -1, _id: -1 }, { name: 'lastMessageAt_id' });

export type Conversation = InferSchemaType<typeof conversationSchema>;
export const ConversationModel = model('Conversation', conversationSchema);

export function directKeyOf(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}
```

### 2.5 `conversationMembers`

Model file: `server/src/modules/conversations/conversationMember.model.ts`. Trường cursor receipt (`lastDelivered*`, `lastRead*`) thuộc quyền ghi của module `messages` (kiến trúc §5.1).

| Field | Type | Required | Default | Constraint | Mô tả |
|---|---|---|---|---|---|
| `_id` | ObjectId | ✔ | auto | — | — |
| `conversationId` | ObjectId | ✔ | — | ref conversations | — |
| `userId` | ObjectId | ✔ | — | ref users | — |
| `role` | String | ✔ | `MEMBER` | `MemberRole`; DIRECT/SECRET luôn `MEMBER`; mỗi GROUP đúng 1 `OWNER` | FR-GROUP-* |
| `joinedAt` | Date | ✔ | now | — | Lần tham gia gần nhất |
| `leftAt` | Date \| null | ✘ | `null` | — | Rời/bị xóa; `null` = người tham gia |
| `addedBy` | ObjectId \| null | ✘ | `null` | ref users | Người thêm (null với người tạo) |
| `lastDeliveredMessageId` | ObjectId \| null | ✘ | `null` | — | Cursor delivered |
| `lastDeliveredMessageAt` | Date \| null | ✘ | `null` | = `createdAt` của tin đó | Thành phần thời gian của cursor |
| `lastReadMessageId` | ObjectId \| null | ✘ | `null` | — | Cursor read |
| `lastReadMessageAt` | Date \| null | ✘ | `null` | — | — |
| `createdAt`, `updatedAt` | Date | ✔ | auto | — | — |

**Index:**

| Tên | Định nghĩa | Loại | Truy vấn dùng |
|---|---|---|---|
| `conv_user_unique` | `{ conversationId: 1, userId: 1 }` | unique | `assertMember` (AUTHZ-2); thêm lại thành viên (upsert); tiến cursor của một người |
| `user_active` | `{ userId: 1, leftAt: 1, conversationId: 1 }` | thường | Danh sách hội thoại của user (`find({ userId, leftAt: null })`, covered); `presence:subscribe` kiểm tra có chung hội thoại |
| `conv_active_role` | `{ conversationId: 1, leftAt: 1, role: 1 }` | thường | `listMemberIds` cho fan-out; đếm "đã đọc bởi X/Y"; tìm OWNER |

**Quy tắc nghiệp vụ:**
- Cursor receipt được duy trì cho **mọi** loại hội thoại (dùng tính `unreadCount`, `myLastDeliveredMessageId`, `myLastReadMessageId`); DIRECT/SECRET **thêm** `messageReceipts` theo từng tin (mục 3).
- Thêm lại người đã rời: `updateOne({ conversationId, userId }, { $set: { leftAt: null, joinedAt: now, role: 'MEMBER', addedBy } }, { upsert: true })` — giữ cursor cũ.
- Chuyển OWNER: hai update trong một transaction; sau commit kiểm tra bất biến "đúng 1 OWNER" trong test (TC-DB-012).
- Người gửi tin được tiến cả hai cursor tới tin của mình trong transaction gửi (kiến trúc §7(b) bước 5).

```ts
// server/src/modules/conversations/conversationMember.model.ts
import { Schema, model, type InferSchemaType } from 'mongoose';
import { MemberRole } from '@hustalo/shared';
import { baseSchemaOptions } from '../../infra/db/schema-options';

const conversationMemberSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, required: true, ref: 'Conversation' },
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    role: { type: String, required: true, enum: Object.values(MemberRole), default: MemberRole.MEMBER },
    joinedAt: { type: Date, required: true, default: () => new Date() },
    leftAt: { type: Date, default: null },
    addedBy: { type: Schema.Types.ObjectId, default: null, ref: 'User' },
    lastDeliveredMessageId: { type: Schema.Types.ObjectId, default: null, ref: 'Message' },
    lastDeliveredMessageAt: { type: Date, default: null },
    lastReadMessageId: { type: Schema.Types.ObjectId, default: null, ref: 'Message' },
    lastReadMessageAt: { type: Date, default: null },
  },
  { ...baseSchemaOptions, collection: 'conversationMembers' },
);

conversationMemberSchema.index({ conversationId: 1, userId: 1 }, { unique: true, name: 'conv_user_unique' });
conversationMemberSchema.index({ userId: 1, leftAt: 1, conversationId: 1 }, { name: 'user_active' });
conversationMemberSchema.index({ conversationId: 1, leftAt: 1, role: 1 }, { name: 'conv_active_role' });

export type ConversationMember = InferSchemaType<typeof conversationMemberSchema>;
export const ConversationMemberModel = model('ConversationMember', conversationMemberSchema);
```

### 2.6 `messages`

Model file: `server/src/modules/messages/message.model.ts`.

| Field | Type | Required | Default | Constraint | Mô tả |
|---|---|---|---|---|---|
| `_id` | ObjectId | ✔ | service sinh trước khi mã hóa | — | messageId (dùng trong AAD) |
| `conversationId` | ObjectId | ✔ | — | ref conversations | — |
| `senderId` | ObjectId | ✔ | — | ref users; lấy từ token. SYSTEM: `actorId` (cuộc gọi: `callerId`) | Người gửi |
| `senderDeviceId` | String \| null | ✘ | `null` | UUID v4; bắt buộc với SECRET; TEXT lưu `did` của token; SYSTEM `null` | Device gửi |
| `clientMessageId` | String \| null | ✘ | `null` | UUID v4; bắt buộc với TEXT; SYSTEM `null` | Khóa idempotency (FR-CHAT-002) |
| `type` | String | ✔ | — | `MessageType` | TEXT / SYSTEM |
| `contentEnc` | Object \| null | ✘ | `null` | `{ v: 1, keyId, iv, ct, tag }`; chỉ TEXT trong DIRECT/GROUP | AES-256-GCM (FR-SEC-002) |
| `ciphertext` | Object \| null | ✘ | `null` | Envelope `{ v: 1, senderDeviceId, recipients: [{ deviceId, type: 1\|3, body }] }`, 1..10 recipients; chỉ SECRET | E2EE (FR-E2EE-004) |
| `system` | Object \| null | ✘ | `null` | `{ kind: SystemEventKind, actorId, targetUserIds[], title, callId, callType, durationSec }`; chỉ SYSTEM | FR-CHAT-011 |
| `editedAt` | Date \| null | ✘ | `null` | — | FR-CHAT-007 |
| `deletedAt` | Date \| null | ✘ | `null` | Khi set: `contentEnc = null`, `ciphertext = null` | Thu hồi (FR-CHAT-008) |
| `createdAt` | Date | ✔ | service gán | — | Thời điểm server nhận; thành phần tuple cursor |
| `updatedAt` | Date | ✔ | auto | — | — |

**Bất biến theo loại** (kiểm trong `pre('validate')`):

| Hội thoại / type | `contentEnc` | `ciphertext` | `system` | `clientMessageId` |
|---|---|---|---|---|
| DIRECT/GROUP, TEXT, chưa thu hồi | bắt buộc | `null` | `null` | bắt buộc |
| SECRET, TEXT, chưa thu hồi | `null` | bắt buộc | `null` | bắt buộc |
| Mọi loại, TEXT, đã thu hồi | `null` | `null` | `null` | bắt buộc |
| DIRECT/SECRET/GROUP, SYSTEM | `null` | `null` | bắt buộc | `null` |

(Model không biết loại hội thoại; bất biến "DIRECT/GROUP ↔ contentEnc, SECRET ↔ ciphertext" do `messages.service` bảo đảm và test TC-DB-005 kiểm.)

**Index:**

| Tên | Định nghĩa | Loại | Truy vấn dùng |
|---|---|---|---|
| `conv_created_id` | `{ conversationId: 1, createdAt: -1, _id: -1 }` | thường | Lịch sử cursor `before`/`after` (mục 4.2); đếm chưa đọc (mục 3.3); sync `after` (FR-CHAT-010) |
| `idempotency_unique` | `{ conversationId: 1, senderId: 1, clientMessageId: 1 }` | unique, partial `{ clientMessageId: { $type: 'string' } }` | Chống trùng `message:send` (EC-NET-004); đọc bản cũ khi `E11000` |
| `reencrypt_keyId` | `{ 'contentEnc.keyId': 1, _id: 1 }` | partial `{ contentEnc: { $type: 'object' } }` | Job xoay khóa `find({ 'contentEnc.keyId': from, _id: { $gt: after } }).sort({ _id: 1 })` (kiến trúc §9.2.4) |

**Quy tắc nghiệp vụ:**
- `_id` và `createdAt` sinh **trước** khi mã hóa: `const _id = new Types.ObjectId(); const createdAt = new Date();` → `encryptField(content, `${conversationId}:${_id}`)`.
- Sửa (FR-CHAT-007): `updateOne({ _id, senderId: me, deletedAt: null, type: 'TEXT', createdAt: { $gte: now - MESSAGE_EDIT_WINDOW_MS } }, { $set: { contentEnc: encryptField(newContent, aad), editedAt: now } })`; `matchedCount = 0` → đọc lại để chọn `NOT_FOUND`/`FORBIDDEN`.
- Thu hồi (FR-CHAT-008): `updateOne({ _id, senderId: me, type: 'TEXT', createdAt: { $gte: now - 15m } }, [{ $set: { deletedAt: { $ifNull: ['$deletedAt', now] }, contentEnc: null, ciphertext: null } }])` (pipeline update giữ `deletedAt` cũ nếu thu hồi lặp — idempotent).
- Cửa sổ 15 phút luôn so với `createdAt` server (EC-MSG-012, EC-MSG-015).
- Envelope SECRET lưu nguyên; khi trả về cho device X, service lọc `recipients` chỉ giữ `deviceId === X` (FR-CHAT-003).
- Kích thước tối đa một document: 10 recipient × 16 KB ≈ 160 KB, xa giới hạn 16 MB.

```ts
// server/src/modules/messages/message.model.ts
import { Schema, model, type InferSchemaType } from 'mongoose';
import {
  CallType, E2EE_ENVELOPE_VERSION, E2EE_MAX_DEVICES_PER_USER, DATA_ENCRYPTION_VERSION,
  MessageType, SignalMessageType, SystemEventKind,
} from '@hustalo/shared';
import { baseSchemaOptions } from '../../infra/db/schema-options';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const contentEncSchema = new Schema(
  {
    v: { type: Number, required: true, enum: [DATA_ENCRYPTION_VERSION] },
    keyId: { type: String, required: true, match: /^[A-Za-z0-9_-]{1,32}$/ },
    iv: { type: String, required: true, match: BASE64, minlength: 16, maxlength: 16 }, // 12 byte
    ct: { type: String, required: true, match: BASE64 },
    tag: { type: String, required: true, match: BASE64, minlength: 24, maxlength: 24 }, // 16 byte
  },
  { _id: false, strict: 'throw' },
);

const recipientSchema = new Schema(
  {
    deviceId: { type: String, required: true, match: UUID_V4 },
    type: { type: Number, required: true, enum: Object.values(SignalMessageType) },
    body: { type: String, required: true, match: BASE64, maxlength: 16384 },
  },
  { _id: false, strict: 'throw' },
);

const envelopeSchema = new Schema(
  {
    v: { type: Number, required: true, enum: [E2EE_ENVELOPE_VERSION] },
    senderDeviceId: { type: String, required: true, match: UUID_V4 },
    recipients: {
      type: [recipientSchema],
      required: true,
      validate: {
        validator: (arr: unknown[]) => arr.length >= 1 && arr.length <= 2 * E2EE_MAX_DEVICES_PER_USER,
        message: 'recipients phải có 1..10 phần tử',
      },
    },
  },
  { _id: false, strict: 'throw' },
);

const systemSchema = new Schema(
  {
    kind: { type: String, required: true, enum: Object.values(SystemEventKind) },
    actorId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    targetUserIds: { type: [Schema.Types.ObjectId], default: [], ref: 'User' },
    title: { type: String, default: null, maxlength: 200 },
    callId: { type: Schema.Types.ObjectId, default: null, ref: 'CallHistory' },
    callType: { type: String, default: null, enum: [...Object.values(CallType), null] },
    durationSec: { type: Number, default: null, min: 0 },
  },
  { _id: false, strict: 'throw' },
);

const messageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, required: true, ref: 'Conversation' },
    senderId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    senderDeviceId: { type: String, default: null, match: UUID_V4 },
    clientMessageId: { type: String, default: null, match: UUID_V4 },
    type: { type: String, required: true, enum: Object.values(MessageType) },
    contentEnc: { type: contentEncSchema, default: null },
    ciphertext: { type: envelopeSchema, default: null },
    system: { type: systemSchema, default: null },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    createdAt: { type: Date, required: true },
  },
  { ...baseSchemaOptions, collection: 'messages', timestamps: { createdAt: false, updatedAt: true } },
);

messageSchema.pre('validate', function (next) {
  const isSystem = this.type === MessageType.SYSTEM;
  if (isSystem) {
    if (!this.system || this.contentEnc || this.ciphertext || this.clientMessageId) {
      return next(new Error('SYSTEM message chỉ có trường system'));
    }
  } else {
    if (!this.clientMessageId || this.system) return next(new Error('TEXT cần clientMessageId, không có system'));
    const hasBody = Boolean(this.contentEnc) || Boolean(this.ciphertext);
    if (this.contentEnc && this.ciphertext) return next(new Error('Không được có cả contentEnc và ciphertext'));
    if (!this.deletedAt && !hasBody) return next(new Error('TEXT chưa thu hồi cần contentEnc hoặc ciphertext'));
  }
  next();
});

messageSchema.index({ conversationId: 1, createdAt: -1, _id: -1 }, { name: 'conv_created_id' });
messageSchema.index(
  { conversationId: 1, senderId: 1, clientMessageId: 1 },
  { unique: true, partialFilterExpression: { clientMessageId: { $type: 'string' } }, name: 'idempotency_unique' },
);
messageSchema.index(
  { 'contentEnc.keyId': 1, _id: 1 },
  { partialFilterExpression: { contentEnc: { $type: 'object' } }, name: 'reencrypt_keyId' },
);

export type Message = InferSchemaType<typeof messageSchema>;
export const MessageModel = model('Message', messageSchema);
```

### 2.7 `messageReceipts`

Model file: `server/src/modules/messages/messageReceipt.model.ts`. Chỉ dùng cho DIRECT và SECRET (một bản ghi cho mỗi tin TEXT × người nhận; DIRECT/SECRET chỉ có 1 người nhận).

| Field | Type | Required | Default | Constraint | Mô tả |
|---|---|---|---|---|---|
| `_id` | ObjectId | ✔ | auto | — | — |
| `messageId` | ObjectId | ✔ | — | ref messages | — |
| `conversationId` | ObjectId | ✔ | — | ref conversations | — |
| `userId` | ObjectId | ✔ | — | người nhận, ≠ `senderId` | — |
| `senderId` | ObjectId | ✔ | — | người gửi | Để người gửi tra trạng thái tin của mình |
| `messageCreatedAt` | Date | ✔ | — | = `messages.createdAt` | Cập nhật theo khoảng cursor |
| `deliveredAt` | Date \| null | ✘ | `null` | — | DELIVERED |
| `readAt` | Date \| null | ✘ | `null` | `readAt != null` ⇒ `deliveredAt != null` | READ |
| `createdAt`, `updatedAt` | Date | ✔ | auto | — | — |

**Index:**

| Tên | Định nghĩa | Loại | Truy vấn dùng |
|---|---|---|---|
| `message_user_unique` | `{ messageId: 1, userId: 1 }` | unique | Tạo receipt trong transaction gửi; trạng thái của một trang tin (`find({ messageId: { $in } })`) |
| `conv_user_created` | `{ conversationId: 1, userId: 1, messageCreatedAt: 1 }` | thường | `markDelivered`/`markRead` theo khoảng (mục 4.5) |

**Quy tắc:** không bao giờ đặt `deliveredAt`/`readAt` về `null`; `markRead` set `deliveredAt` bằng `$ifNull` nếu chưa có. Tin thu hồi giữ receipt.

```ts
// server/src/modules/messages/messageReceipt.model.ts
import { Schema, model, type InferSchemaType } from 'mongoose';
import { baseSchemaOptions } from '../../infra/db/schema-options';

const messageReceiptSchema = new Schema(
  {
    messageId: { type: Schema.Types.ObjectId, required: true, ref: 'Message' },
    conversationId: { type: Schema.Types.ObjectId, required: true, ref: 'Conversation' },
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    senderId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    messageCreatedAt: { type: Date, required: true },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
  },
  { ...baseSchemaOptions, collection: 'messageReceipts' },
);

messageReceiptSchema.index({ messageId: 1, userId: 1 }, { unique: true, name: 'message_user_unique' });
messageReceiptSchema.index({ conversationId: 1, userId: 1, messageCreatedAt: 1 }, { name: 'conv_user_created' });

export type MessageReceipt = InferSchemaType<typeof messageReceiptSchema>;
export const MessageReceiptModel = model('MessageReceipt', messageReceiptSchema);
```

### 2.8 `callHistory`

Model file: `server/src/modules/calls/callHistory.model.ts`. `_id` = `callId`. Ghi sau **mỗi** chuyển trạng thái thành công (kiến trúc §8.1).

| Field | Type | Required | Default | Constraint | Mô tả |
|---|---|---|---|---|---|
| `_id` | ObjectId | ✔ | service sinh | — | callId |
| `conversationId` | ObjectId | ✔ | — | DIRECT/SECRET | — |
| `callType` | String | ✔ | — | `CallType` | — |
| `callerId` | ObjectId | ✔ | — | — | — |
| `calleeId` | ObjectId | ✔ | — | ≠ `callerId` | — |
| `participantIds` | ObjectId[2] | ✔ | `[callerId, calleeId]` | đúng 2 phần tử | Truy vấn lịch sử của một user |
| `callerDeviceId` | String | ✔ | — | UUID v4 | — |
| `callerTabId` | String | ✔ | — | UUID v4 | — |
| `acceptedDeviceId` | String \| null | ✘ | `null` | UUID v4 | — |
| `acceptedTabId` | String \| null | ✘ | `null` | UUID v4 | — |
| `status` | String | ✔ | `INITIATED` | `CallStatus` (đủ 12 giá trị) | Nguồn bền của trạng thái |
| `endReason` | String \| null | ✘ | `null` | `CallEndReason`; ≠ null ⇔ terminal | — |
| `version` | Number | ✔ | 1 | = `call:active.version` tại lần ghi | Bỏ qua ghi cũ đến muộn |
| `iceRestarts` | Number | ✔ | 0 | 0..`CALL_MAX_ICE_RESTARTS` | — |
| `acceptedAt` | Date \| null | ✘ | `null` | — | — |
| `connectedAt` | Date \| null | ✘ | `null` | Set lần đầu CONNECTED | Bắt đầu tính thời lượng |
| `endedAt` | Date \| null | ✘ | `null` | Set khi terminal | — |
| `durationSec` | Number \| null | ✘ | `null` | = `floor((endedAt - connectedAt)/1000)` khi có `connectedAt` | — |
| `createdAt`, `updatedAt` | Date | ✔ | auto | — | — |

**Index:**

| Tên | Định nghĩa | Loại | Truy vấn dùng |
|---|---|---|---|
| `participant_created` | `{ participantIds: 1, createdAt: -1, _id: -1 }` | multikey | `GET /calls` (FR-CALL-008): `find({ participantIds: me, ...tupleLt(cursor) }).sort({ createdAt: -1, _id: -1 })` |
| `active_reconcile` | `{ status: 1, updatedAt: 1 }` | partial `{ status: { $in: CALL_ACTIVE_STATUSES } }` | `jobs/reconcile-calls.ts` tìm record active mồ côi (kiến trúc §8.5) |
| `created_ttl` | `{ createdAt: 1 }` | TTL `expireAfterSeconds: 31536000` (365 ngày) | Chính sách lưu trữ (mục 6.2) |

```ts
// server/src/modules/calls/callHistory.model.ts
import { Schema, model, type InferSchemaType } from 'mongoose';
import {
  CALL_ACTIVE_STATUSES, CALL_MAX_ICE_RESTARTS, CallEndReason, CallStatus, CallType,
} from '@hustalo/shared';
import { baseSchemaOptions } from '../../infra/db/schema-options';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const callHistorySchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, required: true, ref: 'Conversation' },
    callType: { type: String, required: true, enum: Object.values(CallType) },
    callerId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    calleeId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    participantIds: {
      type: [Schema.Types.ObjectId],
      required: true,
      validate: { validator: (v: unknown[]) => v.length === 2, message: 'participantIds phải có 2 phần tử' },
    },
    callerDeviceId: { type: String, required: true, match: UUID_V4 },
    callerTabId: { type: String, required: true, match: UUID_V4 },
    acceptedDeviceId: { type: String, default: null, match: UUID_V4 },
    acceptedTabId: { type: String, default: null, match: UUID_V4 },
    status: { type: String, required: true, enum: Object.values(CallStatus), default: CallStatus.INITIATED },
    endReason: { type: String, default: null, enum: [...Object.values(CallEndReason), null] },
    version: { type: Number, required: true, default: 1, min: 1 },
    iceRestarts: { type: Number, required: true, default: 0, min: 0, max: CALL_MAX_ICE_RESTARTS },
    acceptedAt: { type: Date, default: null },
    connectedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    durationSec: { type: Number, default: null, min: 0 },
  },
  { ...baseSchemaOptions, collection: 'callHistory' },
);

callHistorySchema.index({ participantIds: 1, createdAt: -1, _id: -1 }, { name: 'participant_created' });
callHistorySchema.index(
  { status: 1, updatedAt: 1 },
  { partialFilterExpression: { status: { $in: [...CALL_ACTIVE_STATUSES] } }, name: 'active_reconcile' },
);
callHistorySchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60, name: 'created_ttl' });

export type CallHistory = InferSchemaType<typeof callHistorySchema>;
export const CallHistoryModel = model('CallHistory', callHistorySchema);
```

### 2.9 `userDevices`

Model file: `server/src/modules/e2ee/userDevice.model.ts`. Chỉ lưu **khóa công khai**.

| Field | Type | Required | Default | Constraint | Mô tả |
|---|---|---|---|---|---|
| `_id` | ObjectId | ✔ | auto | — | — |
| `userId` | ObjectId | ✔ | — | ref users | — |
| `deviceId` | String | ✔ | — | UUID v4; unique theo `(userId, deviceId)` | `did` |
| `signalDeviceId` | Number | ✔ | — | int 1..2147483647, unique theo user, cấp `max + 1` | Địa chỉ Signal `(userId, signalDeviceId)` |
| `registrationId` | Number | ✔ | — | int 1..16380 | Signal registrationId |
| `identityKey` | String | ✔ | — | base64, 44 ký tự (33 byte khóa công khai có tiền tố kiểu) | Khóa công khai danh tính |
| `signedPreKey.keyId` | Number | ✔ | — | int ≥ 0 | — |
| `signedPreKey.publicKey` | String | ✔ | — | base64, 44 ký tự | — |
| `signedPreKey.signature` | String | ✔ | — | base64, 88 ký tự (64 byte) | Chữ ký bằng identity key |
| `signedPreKey.createdAt` | Date | ✔ | now | — | Xoay mỗi `E2EE_SIGNED_PREKEY_ROTATION_MS` |
| `status` | String | ✔ | `ACTIVE` | `DeviceStatus` | — |
| `revokedAt` | Date \| null | ✘ | `null` | — | FR-E2EE-007 |
| `createdAt`, `updatedAt` | Date | ✔ | auto | — | — |

(Độ dài base64 dựa trên định dạng khóa Curve25519 có byte kiểu `0x05` của Signal. `// Xác minh với tài liệu chính thức của @privacyresearch/libsignal-protocol-typescript: độ dài serialize của public key và signature; nếu khác, đổi minlength/maxlength tương ứng.`)

**Index:**

| Tên | Định nghĩa | Loại | Truy vấn dùng |
|---|---|---|---|
| `user_device_unique` | `{ userId: 1, deviceId: 1 }` | unique | `PUT /e2ee/devices/{deviceId}/keys` (upsert); kiểm tra device ACTIVE khi `message:send` SECRET |
| `user_signalDevice_unique` | `{ userId: 1, signalDeviceId: 1 }` | unique | Cấp `signalDeviceId` không trùng khi đua |
| `user_status` | `{ userId: 1, status: 1 }` | thường | Bundle cho mọi device ACTIVE; đếm ≤ `E2EE_MAX_DEVICES_PER_USER`; `assertEnvelopeRecipients` |

**Quy tắc nghiệp vụ:**
- Đăng ký trong transaction: đếm device ACTIVE của user (khác `deviceId` hiện tại) ≥ 5 → `CONFLICT`. Device mới: `signalDeviceId = (max hiện có) + 1`; `E11000` trên `user_signalDevice_unique` → retry tối đa 3 lần.
- Đăng ký lại cùng `deviceId` (IndexedDB bị xóa, EC-E2EE-006): ghi đè `identityKey`, `registrationId`, `signedPreKey`; giữ `signalDeviceId`; xóa mọi `oneTimePreKeys` cũ của device; `status = ACTIVE`, `revokedAt = null`.
- Device REVOKED đăng ký lại (cùng `deviceId`, phiên đăng nhập mới): như trên — được phép.
- Một trình duyệt có thể đăng nhập nhiều tài khoản lần lượt với cùng `deviceId`; uniqueness theo `(userId, deviceId)` nên không xung đột.

```ts
// server/src/modules/e2ee/userDevice.model.ts
import { Schema, model, type InferSchemaType } from 'mongoose';
import { DeviceStatus } from '@hustalo/shared';
import { baseSchemaOptions } from '../../infra/db/schema-options';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const signedPreKeySchema = new Schema(
  {
    keyId: { type: Number, required: true, min: 0 },
    publicKey: { type: String, required: true, match: BASE64, minlength: 44, maxlength: 44 },
    signature: { type: String, required: true, match: BASE64, minlength: 88, maxlength: 88 },
    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { _id: false, strict: 'throw' },
);

const userDeviceSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    deviceId: { type: String, required: true, match: UUID_V4 },
    signalDeviceId: { type: Number, required: true, min: 1, max: 2147483647 },
    registrationId: { type: Number, required: true, min: 1, max: 16380 },
    identityKey: { type: String, required: true, match: BASE64, minlength: 44, maxlength: 44 },
    signedPreKey: { type: signedPreKeySchema, required: true },
    status: { type: String, required: true, enum: Object.values(DeviceStatus), default: DeviceStatus.ACTIVE },
    revokedAt: { type: Date, default: null },
  },
  { ...baseSchemaOptions, collection: 'userDevices' },
);

userDeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true, name: 'user_device_unique' });
userDeviceSchema.index({ userId: 1, signalDeviceId: 1 }, { unique: true, name: 'user_signalDevice_unique' });
userDeviceSchema.index({ userId: 1, status: 1 }, { name: 'user_status' });

export type UserDevice = InferSchemaType<typeof userDeviceSchema>;
export const UserDeviceModel = model('UserDevice', userDeviceSchema);
```

### 2.10 `oneTimePreKeys`

Model file: `server/src/modules/e2ee/oneTimePreKey.model.ts`. Tách khỏi `userDevices` để mỗi lần cấp là **một** thao tác nguyên tử trên **một** document.

| Field | Type | Required | Default | Constraint | Mô tả |
|---|---|---|---|---|---|
| `_id` | ObjectId | ✔ | auto | — | — |
| `userId` | ObjectId | ✔ | — | ref users | — |
| `deviceId` | String | ✔ | — | UUID v4 | — |
| `keyId` | Number | ✔ | — | int 0..16777215, unique theo `(userId, deviceId)` | Signal prekey id |
| `publicKey` | String | ✔ | — | base64, 44 ký tự | Khóa công khai |
| `consumedAt` | Date \| null | ✘ | `null` | — | Thời điểm cấp phát; `null` = còn dùng được |
| `consumedBy` | ObjectId \| null | ✘ | `null` | ref users | User đã lấy bundle |
| `createdAt`, `updatedAt` | Date | ✔ | auto | — | — |

**Index:**

| Tên | Định nghĩa | Loại | Truy vấn dùng |
|---|---|---|---|
| `device_key_unique` | `{ userId: 1, deviceId: 1, keyId: 1 }` | unique | Upload prekey (trùng `keyId` → `CONFLICT`) |
| `available` | `{ userId: 1, deviceId: 1, consumedAt: 1, keyId: 1 }` | thường | Tiêu thụ nguyên tử `findOneAndUpdate({ userId, deviceId, consumedAt: null }, { $set: { consumedAt, consumedBy } }, { sort: { keyId: 1 } })` (mục 4.8); đếm còn lại `countDocuments({ userId, deviceId, consumedAt: null })` |
| `consumed_ttl` | `{ consumedAt: 1 }` | TTL `expireAfterSeconds: 604800` (7 ngày) | Dọn prekey đã cấp (document có `consumedAt: null` không bị TTL xóa vì không phải Date) |

```ts
// server/src/modules/e2ee/oneTimePreKey.model.ts
import { Schema, model, type InferSchemaType } from 'mongoose';
import { baseSchemaOptions } from '../../infra/db/schema-options';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const oneTimePreKeySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    deviceId: { type: String, required: true, match: UUID_V4 },
    keyId: { type: Number, required: true, min: 0, max: 16777215 },
    publicKey: { type: String, required: true, match: BASE64, minlength: 44, maxlength: 44 },
    consumedAt: { type: Date, default: null },
    consumedBy: { type: Schema.Types.ObjectId, default: null, ref: 'User' },
  },
  { ...baseSchemaOptions, collection: 'oneTimePreKeys' },
);

oneTimePreKeySchema.index({ userId: 1, deviceId: 1, keyId: 1 }, { unique: true, name: 'device_key_unique' });
oneTimePreKeySchema.index({ userId: 1, deviceId: 1, consumedAt: 1, keyId: 1 }, { name: 'available' });
oneTimePreKeySchema.index({ consumedAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60, name: 'consumed_ttl' });

export type OneTimePreKey = InferSchemaType<typeof oneTimePreKeySchema>;
export const OneTimePreKeyModel = model('OneTimePreKey', oneTimePreKeySchema);
```

---

## 3. Mô hình receipt

### 3.1 Hai mô hình lưu trữ, một API

| | DIRECT / SECRET | GROUP |
|---|---|---|
| Đầu vào client | `message:delivered` / `message:read` / `POST /conversations/{id}/read` với `{ conversationId, upToMessageId }` (D-15) | Như trái |
| Lưu theo tin | `messageReceipts` (1 bản ghi / tin / người nhận), tạo trong transaction gửi | Không có |
| Lưu theo người | Cursor trên `conversationMembers` của người nhận | Cursor trên `conversationMembers` của từng thành viên |
| Event phát ra | `message:status { scope: 'MESSAGE', messageIds, status, byUserId, at }` | `message:status { scope: 'GROUP_AGGREGATE', userId, lastDeliveredMessageId, lastReadMessageId }` |
| Số bản ghi ghi / lần đọc | 1 `updateMany` (≤ số tin chưa đọc) + 1 update cursor | 1 update cursor |

Lý do GROUP không dùng receipt theo tin: một tin trong nhóm 100 người cần 99 bản ghi, mỗi lần đọc cập nhật hàng loạt; cursor chỉ cần một bản ghi cho mỗi người.

### 3.2 Trạng thái hiển thị của tin mình gửi

- **DIRECT/SECRET:** `READ` nếu receipt có `readAt`; `DELIVERED` nếu có `deliveredAt`; ngược lại `SENT`.
- **GROUP**, tin `M` (tuple `t = (M.createdAt, M._id)`), tập `O` = thành viên hiện tại khác người gửi:
  - `X_read = |{ m ∈ O : (m.lastReadMessageAt, m.lastReadMessageId) ≥ t }|`, tương tự `X_delivered`.
  - `Y = |O| = memberCount - 1`.
  - Hiển thị "Đã xem bởi X_read/Y" dưới tin cuối của mình; ✓✓ xanh khi `X_read = Y`; ✓✓ khi `X_delivered = Y`; ngược lại ✓.
  - Thành viên tham gia **sau** khi tin được gửi vẫn tính vào `Y` (quyết định thiết kế: đơn giản, nhất quán với số thành viên hiện tại).

```ts
// receipts.service.ts — đếm "đã đọc bởi X/Y" cho một tin trong GROUP
export async function groupReadStats(conversationId: Types.ObjectId, msg: { _id: Types.ObjectId; createdAt: Date; senderId: Types.ObjectId }) {
  const base = { conversationId, leftAt: null, userId: { $ne: msg.senderId } };
  const reached = (field: 'Read' | 'Delivered') => ({
    ...base,
    $or: [
      { [`last${field}MessageAt`]: { $gt: msg.createdAt } },
      { [`last${field}MessageAt`]: msg.createdAt, [`last${field}MessageId`]: { $gte: msg._id } },
    ],
  });
  const [total, read, delivered] = await Promise.all([
    ConversationMemberModel.countDocuments(base),
    ConversationMemberModel.countDocuments(reached('Read')),
    ConversationMemberModel.countDocuments(reached('Delivered')),
  ]);
  return { total, read, delivered }; // dùng index conv_active_role (lọc conversationId, leftAt)
}
```

Client tính X/Y cục bộ từ danh sách thành viên (trả trong `Conversation.members` với cursor) và cập nhật qua `message:status GROUP_AGGREGATE`; hàm trên dùng cho test và cho `GET /conversations/{id}`.

### 3.3 Số tin chưa đọc

`unreadCount(me, conv)` = số tin thỏa:
- `conversationId = conv`, `senderId ≠ me`, `deletedAt = null`,
- `type = 'TEXT'` hoặc `system.kind = 'CALL_MISSED'` (SYSTEM cuộc gọi có `senderId = callerId`, nên chỉ callee bị tính),
- tuple `(createdAt, _id) > (my.lastReadMessageAt, my.lastReadMessageId)` (cursor `null` = mọi tin),
- đếm tối đa `UNREAD_COUNT_CAP + 1` = 100 (`countDocuments(filter, { limit: 100 })`), UI hiển thị "99+" khi > 99.

Dùng index `conv_created_id` (lọc `conversationId` + khoảng `createdAt`, phần còn lại lọc trên document).

---

## 4. Truy vấn mẫu

Các đoạn code dưới đây là hiện thực chuẩn trong `*.repository.ts` / `*.service.ts`; chữ ký `withTxn` và cursor dùng chung:

```ts
// server/src/infra/db/transaction.ts
import mongoose, { type ClientSession } from 'mongoose';
import { MONGO_TXN_MAX_RETRIES } from '@hustalo/shared';
import { AppError } from '../../http/errors/app-error';

export async function withTxn<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    const session = await mongoose.startSession();
    try {
      let result!: T;
      await session.withTransaction(async () => { result = await fn(session); }, {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
      });
      return result;
    } catch (err) {
      const transient = err instanceof mongoose.mongo.MongoError &&
        (err.hasErrorLabel('TransientTransactionError') || err.hasErrorLabel('UnknownTransactionCommitResult'));
      attempt += 1;
      if (transient && attempt < MONGO_TXN_MAX_RETRIES) continue;
      if (transient) throw new AppError('SERVICE_UNAVAILABLE', 'Máy chủ đang bận, vui lòng thử lại');
      throw err;
    } finally {
      await session.endSession();
    }
  }
}
// session.withTransaction tự retry nội bộ; vòng ngoài giới hạn tổng số lần (EC-INFRA-003).
// Xác minh với tài liệu chính thức của MongoDB Node driver: hành vi retry của withTransaction.
```

```ts
// packages/shared/src/utils/cursor.ts
export interface TupleCursor { createdAt: string; id: string } // createdAt ISO UTC, id ObjectId hex
export const encodeCursor = (c: TupleCursor) =>
  Buffer.from(JSON.stringify([c.createdAt, c.id]), 'utf8').toString('base64url');
export function decodeCursor(s: string): TupleCursor {
  const arr = JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as unknown;
  if (!Array.isArray(arr) || typeof arr[0] !== 'string' || typeof arr[1] !== 'string' ||
      Number.isNaN(Date.parse(arr[0])) || !/^[a-f0-9]{24}$/.test(arr[1])) throw new Error('INVALID_CURSOR');
  return { createdAt: arr[0], id: arr[1] };
}
// Client dùng bản tương đương với btoa/atob (TextEncoder); decode lỗi → VALIDATION_ERROR.
```

Bộ lọc tuple dùng chung:

```ts
// server/src/infra/db/tuple.ts
import { Types } from 'mongoose';
export const tupleLt = (t: Date, id: Types.ObjectId, f = 'createdAt') =>
  ({ $or: [{ [f]: { $lt: t } }, { [f]: t, _id: { $lt: id } }] });
export const tupleGt = (t: Date, id: Types.ObjectId, f = 'createdAt') =>
  ({ $or: [{ [f]: { $gt: t } }, { [f]: t, _id: { $gt: id } }] });
```

### 4.1 Danh sách hội thoại kèm tin cuối và số chưa đọc (FR-CHAT-009)

```ts
// conversations.repository.ts + messages.service.ts
export async function listConversationSummaries(me: Types.ObjectId, cursor: TupleCursor | null, limit: number) {
  // 1. Hội thoại của tôi (index user_active, covered)
  const memberships = await ConversationMemberModel
    .find({ userId: me, leftAt: null }, { conversationId: 1, lastDeliveredMessageId: 1, lastReadMessageId: 1, lastReadMessageAt: 1, role: 1 })
    .lean();
  const byConv = new Map(memberships.map((m) => [String(m.conversationId), m]));

  // 2. Trang hội thoại theo (lastMessageAt, _id) giảm dần (index lastMessageAt_id)
  const filter: Record<string, unknown> = {
    _id: { $in: memberships.map((m) => m.conversationId) },
    deletedAt: null,
    $or: [{ lastMessage: { $ne: null } }, { createdBy: me }, { type: 'GROUP' }], // FR-CHAT-001
  };
  if (cursor) Object.assign(filter, { $and: [tupleLt(new Date(cursor.createdAt), new Types.ObjectId(cursor.id), 'lastMessageAt')] });
  const convs = await ConversationModel.find(filter).sort({ lastMessageAt: -1, _id: -1 }).limit(limit + 1).lean();
  const page = convs.slice(0, limit);

  // 3. Tin cuối (1 truy vấn) — giải mã preview ở service
  const lastIds = page.flatMap((c) => (c.lastMessage ? [c.lastMessage.messageId] : []));
  const lastMessages = await MessageModel.find({ _id: { $in: lastIds } }).lean();

  // 4. Số chưa đọc — song song, mỗi truy vấn dùng index conv_created_id, giới hạn 100
  const unread = await Promise.all(page.map((c) => {
    const m = byConv.get(String(c._id))!;
    const f: Record<string, unknown> = {
      conversationId: c._id,
      senderId: { $ne: me },
      deletedAt: null,
      $or: [{ type: 'TEXT' }, { 'system.kind': 'CALL_MISSED' }],
    };
    if (m.lastReadMessageAt && m.lastReadMessageId) f.$and = [tupleGt(m.lastReadMessageAt, m.lastReadMessageId)];
    return MessageModel.countDocuments(f, { limit: UNREAD_COUNT_CAP + 1 });
  }));

  const next = convs.length > limit
    ? encodeCursor({ createdAt: page[page.length - 1]!.lastMessageAt.toISOString(), id: String(page[page.length - 1]!._id) })
    : null;
  return { page, lastMessages, unread, memberships: byConv, nextCursor: next };
}
```

`blockedByMe`, `canMessage`, `peer` (DIRECT/SECRET) được service bổ sung bằng một truy vấn `userBlocks` (`$in` các peer) và một truy vấn `users` (`$in`).

### 4.2 Phân trang lịch sử theo cursor (FR-CHAT-003)

```ts
// messages.repository.ts
export async function findPage(conversationId: Types.ObjectId, q: { before?: TupleCursor; after?: TupleCursor; limit: number }) {
  const base: Record<string, unknown> = { conversationId };
  if (q.before && q.after) throw new AppError('VALIDATION_ERROR', 'Chỉ dùng before hoặc after');

  if (q.after) {
    const items = await MessageModel
      .find({ ...base, ...tupleGt(new Date(q.after.createdAt), new Types.ObjectId(q.after.id)) })
      .sort({ createdAt: 1, _id: 1 })            // index conv_created_id quét ngược
      .limit(q.limit + 1).lean();
    const hasMore = items.length > q.limit;
    const page = items.slice(0, q.limit);
    return { items: page, hasMoreAfter: hasMore, hasMoreBefore: true };
  }

  const cond = q.before ? tupleLt(new Date(q.before.createdAt), new Types.ObjectId(q.before.id)) : {};
  const items = await MessageModel.find({ ...base, ...cond })
    .sort({ createdAt: -1, _id: -1 })
    .limit(q.limit + 1).lean();
  const hasMore = items.length > q.limit;
  const page = items.slice(0, q.limit).reverse(); // trả tăng dần
  return { items: page, hasMoreBefore: hasMore, hasMoreAfter: Boolean(q.before) };
}
// Service: nextBefore = hasMoreBefore ? cursor(items[0]) : null; nextAfter = hasMoreAfter ? cursor(items.at(-1)) : null.
// Trang mới nhất (không before/after): nextAfter = null.
```

### 4.3 Tạo DIRECT / SECRET an toàn khi đua (FR-CHAT-001, D-11)

```ts
// conversations.service.ts
export async function getOrCreatePair(type: 'DIRECT' | 'SECRET', me: Types.ObjectId, other: Types.ObjectId) {
  const directKey = directKeyOf(String(me), String(other));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await withTxn(async (session) => {
        const res = await ConversationModel.findOneAndUpdate(
          { type, directKey },
          { $setOnInsert: { type, directKey, createdBy: me, memberCount: 2, lastMessageAt: new Date() } },
          { upsert: true, new: true, session, includeResultMetadata: true },
          // Xác minh với tài liệu chính thức của Mongoose 8: tùy chọn includeResultMetadata (thay rawResult).
        );
        const conv = res.value!;
        const created = Boolean(res.lastErrorObject?.upserted);
        if (created) {
          await ConversationMemberModel.insertMany([
            { conversationId: conv._id, userId: me, role: 'MEMBER' },
            { conversationId: conv._id, userId: other, role: 'MEMBER' },
          ], { session });
        }
        return { conv, created };
      });
    } catch (err) {
      // Hai upsert đồng thời: một bên E11000 trên type_directKey_unique → thử lại thì findOneAndUpdate tìm thấy bản đã có
      if (isDuplicateKey(err) && attempt === 0) continue;
      throw err;
    }
  }
  throw new AppError('INTERNAL_ERROR', 'Đã có lỗi xảy ra');
}
// Controller: created → 201, ngược lại → 200 (AC-017).
```

### 4.4 Gửi tin trong transaction (FR-CHAT-002, kiến trúc §7(b))

```ts
// messages.service.ts
export async function sendMessage(auth: AuthCtx, p: MessageSendPayload) {
  const conv = await conversations.getActive(p.conversationId);                   // NOT_FOUND
  await conversations.assertMember(conv._id, auth.userId);                         // AUTHZ-2
  assertKindMatchesType(p.kind, conv.type);                                       // VALIDATION_ERROR
  if (conv.type !== 'GROUP') await assertNotBlocked(conv, auth.userId);           // USER_BLOCKED
  if (conv.type === 'SECRET') await e2ee.assertEnvelopeRecipients(conv, auth, p.ciphertext); // FORBIDDEN/CONFLICT/E2EE_KEYS_UNAVAILABLE

  const _id = new Types.ObjectId();
  const createdAt = new Date();
  const doc = {
    _id, conversationId: conv._id, senderId: auth.userId, senderDeviceId: auth.deviceId,
    clientMessageId: p.clientMessageId, type: 'TEXT' as const, createdAt,
    contentEnc: p.kind === 'PLAINTEXT' ? encryptField(p.content, `${conv._id}:${_id}`) : null,
    ciphertext: p.kind === 'E2EE' ? p.ciphertext : null,
  };

  try {
    const { memberIds } = await withTxn(async (session) => {
      await MessageModel.create([doc], { session });                                       // 1 (E11000 → duplicate)
      const members = await ConversationMemberModel
        .find({ conversationId: conv._id, leftAt: null }, { userId: 1 }).session(session).lean(); // 2 re-check
      if (!members.some((m) => m.userId.equals(auth.userId))) throw new AppError('NOT_A_MEMBER', 'Bạn không còn là thành viên của cuộc trò chuyện này');
      await ConversationModel.updateOne(                                                    // 3
        { _id: conv._id, lastMessageAt: { $lte: createdAt } },
        { $set: { lastMessage: { messageId: _id, senderId: auth.userId, type: 'TEXT', createdAt }, lastMessageAt: createdAt } },
        { session },
      );
      if (conv.type !== 'GROUP') {                                                          // 4
        const recipient = members.find((m) => !m.userId.equals(auth.userId));
        if (recipient) await MessageReceiptModel.create([{
          messageId: _id, conversationId: conv._id, userId: recipient.userId, senderId: auth.userId, messageCreatedAt: createdAt,
        }], { session });
      }
      await advanceCursors(conv._id, auth.userId, { id: _id, at: createdAt }, ['Delivered', 'Read'], session); // 5 (mục 4.5)
      return { memberIds: members.map((m) => m.userId) };
    });
    return { message: doc, duplicate: false, memberIds };                                   // ACK sau commit
  } catch (err) {
    if (isDuplicateKey(err, 'idempotency_unique')) {
      const old = await MessageModel.findOne({ conversationId: conv._id, senderId: auth.userId, clientMessageId: p.clientMessageId }).lean();
      return { message: old!, duplicate: true, memberIds: null };                           // DUPLICATE_MESSAGE, không fan-out lại
    }
    throw err;
  }
}
```

Lưu ý: E11000 trong transaction làm abort toàn bộ transaction (không có ghi một phần). Bản cũ được đọc **ngoài** transaction sau khi abort.

### 4.5 Tiến cursor một chiều (FR-CHAT-004, kiến trúc §7(b).1)

```ts
// receipts.service.ts
type Field = 'Delivered' | 'Read';

export async function advanceCursors(
  conversationId: Types.ObjectId, userId: Types.ObjectId,
  to: { id: Types.ObjectId; at: Date }, fields: Field[], session?: ClientSession,
): Promise<Field[]> {
  const advanced: Field[] = [];
  for (const f of fields) {
    const atKey = `last${f}MessageAt`, idKey = `last${f}MessageId`;
    const res = await ConversationMemberModel.updateOne(
      {
        conversationId, userId, leftAt: null,
        $or: [
          { [atKey]: null },
          { [atKey]: { $lt: to.at } },
          { [atKey]: to.at, [idKey]: { $lt: to.id } },
        ],
      },
      { $set: { [atKey]: to.at, [idKey]: to.id } },
      { session },
    );
    if (res.modifiedCount === 1) advanced.push(f);
  }
  return advanced; // rỗng → ACK advanced:false, không phát event (AC-025)
}

export async function markRead(auth: AuthCtx, conversationId: Types.ObjectId, upToMessageId: Types.ObjectId) {
  const conv = await conversations.getActive(conversationId);
  await conversations.assertMember(conv._id, auth.userId);
  const msg = await MessageModel.findOne({ _id: upToMessageId, conversationId }, { createdAt: 1 }).lean();
  if (!msg) throw new AppError('NOT_FOUND', 'Không tìm thấy tin nhắn');
  const to = { id: msg._id, at: msg.createdAt };

  // Read cũng nâng Delivered nếu đang thấp hơn
  const advanced = await advanceCursors(conv._id, auth.userId, to, ['Delivered', 'Read']);

  let changedIds: Types.ObjectId[] = [];
  if (conv.type !== 'GROUP') {
    const filter = {
      conversationId, userId: auth.userId, readAt: null,
      messageCreatedAt: { $lte: msg.createdAt },          // index conv_user_created
    };
    changedIds = (await MessageReceiptModel.find(filter, { messageId: 1 }).lean()).map((r) => r.messageId);
    const now = new Date();
    await MessageReceiptModel.updateMany(
      { ...filter, messageId: { $in: changedIds } },
      [{ $set: { readAt: now, deliveredAt: { $ifNull: ['$deliveredAt', now] } } }], // không bao giờ hạ cấp
    );
  }
  return { advanced: advanced.includes('Read') || changedIds.length > 0, changedIds };
}
// markDelivered giống hệt với field 'Delivered' và điều kiện deliveredAt: null.
// Tin có cùng createdAt với cursor nhưng _id lớn hơn: chỉ thuộc cursor khi so tuple; receipts dùng
// messageCreatedAt ≤ t nên có thể đánh dấu thêm tin cùng mili-giây — chấp nhận (sai lệch tối đa vài tin trong cùng 1 ms).
```

### 4.6 Kết thúc cuộc gọi idempotent (kiến trúc §8.2 T32)

```ts
// calls.repository.ts
export async function finalize(callId: Types.ObjectId, upd: {
  status: CallStatus; endReason: CallEndReason; endedAt: Date; version: number;
}) {
  const res = await CallHistoryModel.findOneAndUpdate(
    { _id: callId, status: { $nin: [...CALL_TERMINAL_STATUSES] }, version: { $lt: upd.version } },
    [{
      $set: {
        status: upd.status, endReason: upd.endReason, endedAt: upd.endedAt, version: upd.version,
        durationSec: {
          $cond: [{ $ne: ['$connectedAt', null] },
            { $floor: { $divide: [{ $subtract: [upd.endedAt, '$connectedAt'] }, 1000] } }, null],
        },
      },
    }],
    { new: true },
  ).lean();
  if (res) return { record: res, changed: true };
  // Đã terminal (hoặc ghi cũ đến muộn) → trả bản hiện tại, không phát lại event, không tạo SYSTEM message
  const current = await CallHistoryModel.findById(callId).lean();
  if (!current) throw new AppError('CALL_NOT_FOUND', 'Không tìm thấy cuộc gọi');
  return { record: current, changed: false };
}
```

Chuyển trạng thái không terminal dùng cùng mẫu với `status: { $in: expectedFrom }` và `version: { $lt: newVersion }`.

### 4.7 Thêm thành viên nhóm với giới hạn (FR-GROUP-002, EC-GROUP-001, EC-GROUP-006)

```ts
// conversations.service.ts
export async function addMembers(auth: AuthCtx, convId: Types.ObjectId, userIds: Types.ObjectId[]) {
  return withTxn(async (session) => {
    const actor = await ConversationMemberModel.findOne({ conversationId: convId, userId: auth.userId, leftAt: null }).session(session).lean();
    if (!actor) throw new AppError('NOT_A_MEMBER', 'Bạn không còn là thành viên của nhóm này');
    if (actor.role === 'MEMBER') throw new AppError('FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này');

    const { toAdd, skipped } = await classifyCandidates(convId, auth.userId, dedupe(userIds), session); // CONFLICT/NOT_FOUND/USER_BLOCKED
    if (toAdd.length === 0) return { added: [], skipped };

    const res = await ConversationModel.updateOne(
      { _id: convId, type: 'GROUP', deletedAt: null, memberCount: { $lte: GROUP_MAX_MEMBERS - toAdd.length } },
      { $inc: { memberCount: toAdd.length } },
      { session },
    );
    if (res.modifiedCount === 0) throw new AppError('CONVERSATION_FULL', 'Nhóm đã đạt tối đa 100 thành viên');

    const now = new Date();
    await ConversationMemberModel.bulkWrite(toAdd.map((userId) => ({
      updateOne: {
        filter: { conversationId: convId, userId },
        update: { $set: { leftAt: null, joinedAt: now, role: 'MEMBER', addedBy: auth.userId } },
        upsert: true,
      },
    })), { session });
    await messages.createSystemMessage(convId, { kind: 'MEMBER_ADDED', actorId: auth.userId, targetUserIds: toAdd }, session);
    return { added: toAdd, skipped };
  });
}
// Hai admin đồng thời: transaction snapshot + updateOne có điều kiện memberCount → một bên WriteConflict
// (retry trong withTxn) rồi thấy memberCount mới → CONVERSATION_FULL nếu vượt (AC-058).
```

### 4.8 Tiêu thụ one-time prekey nguyên tử (FR-E2EE-002)

```ts
// e2ee.repository.ts
export async function consumeOneTimePreKey(userId: Types.ObjectId, deviceId: string, consumer: Types.ObjectId) {
  return OneTimePreKeyModel.findOneAndUpdate(
    { userId, deviceId, consumedAt: null },                // index available
    { $set: { consumedAt: new Date(), consumedBy: consumer } },
    { sort: { keyId: 1 }, new: true, projection: { keyId: 1, publicKey: 1 } },
  ).lean();                                                // null → bundle không có OTPK (EC-E2EE-002)
}

export const countAvailable = (userId: Types.ObjectId, deviceId: string) =>
  OneTimePreKeyModel.countDocuments({ userId, deviceId, consumedAt: null });
// Service: remaining < E2EE_PREKEY_LOW_THRESHOLD và SET e2ee:lowsent:{deviceId} NX EX 3600 thành công → emit e2ee:prekeys-low.
```

### 4.9 Chuyển quyền OWNER (FR-GROUP-004)

```ts
export async function transferOwner(auth: AuthCtx, convId: Types.ObjectId, target: Types.ObjectId) {
  await withTxn(async (session) => {
    const demoted = await ConversationMemberModel.updateOne(
      { conversationId: convId, userId: auth.userId, role: 'OWNER', leftAt: null }, { $set: { role: 'ADMIN' } }, { session });
    if (demoted.modifiedCount === 0) throw new AppError('FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này');
    const promoted = await ConversationMemberModel.updateOne(
      { conversationId: convId, userId: target, leftAt: null }, { $set: { role: 'OWNER' } }, { session });
    if (promoted.matchedCount === 0) throw new AppError('NOT_A_MEMBER', 'Người này không còn trong nhóm');
    await messages.createSystemMessage(convId, { kind: 'OWNER_TRANSFERRED', actorId: auth.userId, targetUserIds: [target] }, session);
  });
}
```

---

## 5. Thiết kế key Redis

### 5.1 Quy ước

- Mọi key có tiền tố `REDIS_KEY_PREFIX` (mặc định `hustalo:`), được ghép **tường minh** trong `server/src/infra/redis/keys.ts` (không dùng tùy chọn `keyPrefix` của ioredis, để key truyền vào Lua và key Lua tự dựng nhất quán).
- Thời gian trong ZSET score là epoch **mili-giây** của server.
- Script Lua nạp bằng `redis.defineCommand(name, { numberOfKeys, lua })` lúc boot. Một số script dựng key từ `ARGV[prefix]` bên trong (call-invite) → **không tương thích Redis Cluster**; MVP dùng Redis đơn node (ghi chú khi scale: chuyển sang hash tag `{callId}`).

```ts
// server/src/infra/redis/keys.ts
import { env } from '../../config/env';
const p = env.REDIS_KEY_PREFIX; // 'hustalo:'
export const keys = {
  presenceConns: (userId: string) => `${p}presence:conns:${userId}`,
  presenceUsers: () => `${p}presence:users`,
  presenceOfflinePending: () => `${p}presence:offline-pending`,
  typing: (conversationId: string, userId: string) => `${p}typing:${conversationId}:${userId}`,
  rateLimitPrefix: (rule: string) => `${p}rl:${rule}`,
  sessionRevoked: (sid: string) => `${p}session:revoked:${sid}`,
  callActive: (callId: string) => `${p}call:active:${callId}`,
  userInCall: (userId: string) => `${p}user:incall:${userId}`,
  callDeadlines: () => `${p}call:deadlines`,
  callPending: (calleeId: string) => `${p}call:pending:${calleeId}`,
  iceServersXirsys: () => `${p}ice:servers:xirsys`,
  e2eeLowSent: (deviceId: string) => `${p}e2ee:lowsent:${deviceId}`,
  idemConversation: (userId: string, key: string) => `${p}idem:conv:${userId}:${key}`,
  prefix: p,
} as const;
```

### 5.2 Bảng key

| Pattern (sau prefix) | Kiểu | TTL | Thao tác | Atomic bằng | FR/EC |
|---|---|---|---|---|---|
| `presence:conns:{userId}` | ZSET member `{instanceId}:{socketId}`, score = hạn lease (ms) | `PEXPIRE` = `PRESENCE_LEASE_TTL_MS` mỗi lần touch | touch, drop, `ZCOUNT key now +inf` | `presence-touch.lua`, `presence-drop.lua` | FR-PRES-001, EC-PRES-001..003 |
| `presence:users` | ZSET member `userId`, score = hạn lease lớn nhất | không | `ZADD GT` khi touch; sweeper claim score ≤ now | `presence-touch.lua`, `call-deadlines-claim.lua` (dùng chung) | EC-PRES-003 (instance chết) |
| `presence:offline-pending` | ZSET member `userId`, score = thời điểm phát OFFLINE | không | `ZADD` khi socket cuối ngắt; `ZREM` khi reconnect; sweeper claim | `presence-drop.lua`, `presence-touch.lua`, claim script | FR-PRES-001 grace 10 s |
| `typing:{conversationId}:{userId}` | STRING `1` | `TYPING_TTL_MS` | `SET key 1 PX 5000` / `DEL` / `SCAN typing:{conv}:*` khi `conversation:join` | lệnh đơn | FR-CHAT-005 |
| `rl:{rule}:{subject}` | quản lý bởi `rate-limiter-flexible` | `windowSec` của rule | consume | atomic của thư viện (Lua/MULTI) | FR-SEC-005 |
| `session:revoked:{sid}` | STRING lý do | `ACCESS_TOKEN_TTL_S` | `SET key <reason> EX 900` khi thu hồi; `EXISTS` khi xác thực | lệnh đơn | FR-AUTH-003..006 |
| `call:active:{callId}` | HASH (mục 5.3) | `CALL_STATE_TTL_S`; terminal → 300 s | tạo, CAS chuyển trạng thái | `call-invite.lua`, `call-transition.lua` | FR-CALL-* |
| `user:incall:{userId}` | STRING `callId` | `CALL_STATE_TTL_S` | set khi invite; xóa khi terminal nếu giá trị = callId | `call-invite.lua`, `call-transition.lua` | D-06, EC-CALL-SIG-002/003 |
| `call:deadlines` | ZSET member `{callId}:{RING\|CONNECT\|RECONNECT\|PEER:{tabId}}`, score = hạn (ms) | không | thêm/xóa trong transition; sweeper claim | `call-transition.lua`, `call-deadlines-claim.lua` | D-05 |
| `call:pending:{calleeId}` | SET `callId` | `CALL_RING_TIMEOUT_MS` (PEXPIRE) | `SADD` khi invite và chưa tab nào ACK; `SREM` khi RINGING/terminal; `SMEMBERS` khi callee kết nối | `call-invite.lua` + lệnh đơn | D-08, EC-CALL-SIG-001 |
| `ice:servers:xirsys` | STRING JSON `{ iceServers, fetchedAt }` | `ICE_SERVERS_CACHE_TTL_S` | `GET`; `SET key <json> EX 300` | lệnh đơn | FR-CALL-007 |
| `e2ee:lowsent:{deviceId}` | STRING `1` | `E2EE_PREKEYS_LOW_NOTIFY_COOLDOWN_S` | `SET NX EX 3600` | lệnh đơn | FR-E2EE-003 |
| `idem:conv:{userId}:{key}` | STRING `conversationId` | 86400 s | `SET NX EX` sau khi tạo GROUP; `GET` trước khi tạo | lệnh đơn (DB unique index là nguồn sự thật) | FR-GROUP-001 |

Subject rate limit: `ip+email` → `${ip}:${sha256(email).slice(0,16)}` (không đưa email thô vào key); `user` → userId; `socket` → `${userId}:${tabId}`; `user+target` → `${userId}:${targetUserId}`.

### 5.3 Hash `call:active:{callId}`

| Field | Ví dụ | Ghi chú |
|---|---|---|
| `status` | `RINGING` | `CallStatus` |
| `version` | `3` | tăng mỗi chuyển trạng thái |
| `callType` | `VIDEO` | — |
| `conversationId`, `callerId`, `calleeId` | ObjectId hex | — |
| `callerDeviceId`, `callerTabId` | UUID | — |
| `acceptedDeviceId`, `acceptedTabId` | UUID hoặc `""` | `""` khi chưa accept |
| `offerRevision`, `answeredRevision` | `0` | D-04, kiến trúc §4.5 |
| `iceRestarts` | `0` | ≤ `CALL_MAX_ICE_RESTARTS` |
| `createdAt`, `acceptedAt`, `connectedAt` | epoch ms hoặc `""` | — |
| `endReason` | `""` hoặc `CallEndReason` | — |

### 5.4 Script Lua

**`call-invite.lua`** — kiểm tra bận/glare và tạo cuộc gọi trong một bước (kiến trúc §7(e), §7(g)).

```lua
-- KEYS[1]=user:incall:{caller} KEYS[2]=user:incall:{callee} KEYS[3]=call:active:{newCallId}
-- KEYS[4]=call:deadlines KEYS[5]=call:pending:{calleeId}
-- ARGV: 1 newCallId, 2 callerId, 3 calleeId, 4 conversationId, 5 callType, 6 callerDeviceId,
--       7 callerTabId, 8 nowMs, 9 ringTimeoutMs, 10 stateTtlS, 11 keyPrefix, 12 connectTimeoutMs
local now = tonumber(ARGV[8])
local mine = redis.call('GET', KEYS[1])
if mine then return {'CALLER_IN_CALL', mine} end

local theirs = redis.call('GET', KEYS[2])
if theirs then
  local otherKey = ARGV[11] .. 'call:active:' .. theirs
  local h = redis.call('HMGET', otherKey, 'status', 'callerId', 'calleeId', 'conversationId', 'version', 'callType')
  local st = h[1]
  if h[2] == ARGV[3] and h[3] == ARGV[2] and h[4] == ARGV[4] and (st == 'INITIATED' or st == 'RINGING') then
    -- GLARE: lời mời ngược chiều của chính callee → ACCEPTED, người mời thứ hai là tab đã accept
    local v = tonumber(h[5]) + 1
    redis.call('HSET', otherKey, 'status', 'ACCEPTED', 'version', v,
      'acceptedDeviceId', ARGV[6], 'acceptedTabId', ARGV[7], 'acceptedAt', now)
    redis.call('ZREM', KEYS[4], theirs .. ':RING')
    redis.call('ZADD', KEYS[4], now + tonumber(ARGV[12]), theirs .. ':CONNECT')
    redis.call('SREM', ARGV[11] .. 'call:pending:' .. ARGV[2], theirs)
    return {'GLARE', theirs, tostring(v), h[6]}
  end
  return {'BUSY', theirs}
end

redis.call('HSET', KEYS[3],
  'status', 'INITIATED', 'version', 1, 'callType', ARGV[5], 'conversationId', ARGV[4],
  'callerId', ARGV[2], 'calleeId', ARGV[3], 'callerDeviceId', ARGV[6], 'callerTabId', ARGV[7],
  'acceptedDeviceId', '', 'acceptedTabId', '', 'offerRevision', 0, 'answeredRevision', 0,
  'iceRestarts', 0, 'createdAt', now, 'acceptedAt', '', 'connectedAt', '', 'endReason', '')
redis.call('EXPIRE', KEYS[3], tonumber(ARGV[10]))
redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[10]))
redis.call('SET', KEYS[2], ARGV[1], 'EX', tonumber(ARGV[10]))
redis.call('ZADD', KEYS[4], now + tonumber(ARGV[9]), ARGV[1] .. ':RING')
redis.call('SADD', KEYS[5], ARGV[1])
redis.call('PEXPIRE', KEYS[5], tonumber(ARGV[9]))
return {'CREATED', ARGV[1]}
```

Kết quả → service: `CREATED` → T01; `GLARE` → T05 (ACK `merged: true`); `BUSY` → T02 (`CALL_BUSY`); `CALLER_IN_CALL` → `CALL_INVALID_STATE`.

**`call-transition.lua`** — compare-and-set (kiến trúc §8.1).

```lua
-- KEYS[1]=call:active:{callId} KEYS[2]=call:deadlines KEYS[3]=user:incall:{callerId} KEYS[4]=user:incall:{calleeId}
-- KEYS[5]=call:pending:{calleeId}
-- ARGV: 1 callId, 2 expectedFrom (CSV), 3 to, 4 isTerminal ('1'|'0'), 5 fieldsJson (object),
--       6 removeDeadlinesJson (array of suffix), 7 addDeadlinesJson (array of [suffix, scoreMs])
if redis.call('EXISTS', KEYS[1]) == 0 then return {-1} end
local st = redis.call('HGET', KEYS[1], 'status')
local ok = false
for s in string.gmatch(ARGV[2], '([^,]+)') do if s == st then ok = true end end
local ver = tonumber(redis.call('HGET', KEYS[1], 'version'))
if not ok then return {0, st, tostring(ver)} end

ver = ver + 1
redis.call('HSET', KEYS[1], 'status', ARGV[3], 'version', ver)
local fields = cjson.decode(ARGV[5])
for k, v in pairs(fields) do redis.call('HSET', KEYS[1], k, tostring(v)) end
for _, suffix in ipairs(cjson.decode(ARGV[6])) do redis.call('ZREM', KEYS[2], ARGV[1] .. ':' .. suffix) end
for _, pair in ipairs(cjson.decode(ARGV[7])) do redis.call('ZADD', KEYS[2], pair[2], ARGV[1] .. ':' .. pair[1]) end
if ARGV[3] ~= 'INITIATED' then redis.call('SREM', KEYS[5], ARGV[1]) end

if ARGV[4] == '1' then
  if redis.call('GET', KEYS[3]) == ARGV[1] then redis.call('DEL', KEYS[3]) end
  if redis.call('GET', KEYS[4]) == ARGV[1] then redis.call('DEL', KEYS[4]) end
  -- xóa mọi deadline còn lại của call (RING/CONNECT/RECONNECT/PEER:*)
  local all = redis.call('ZRANGE', KEYS[2], 0, -1)
  local pfx = ARGV[1] .. ':'
  for _, m in ipairs(all) do if string.sub(m, 1, #pfx) == pfx then redis.call('ZREM', KEYS[2], m) end end
  redis.call('EXPIRE', KEYS[1], 300)
end
return {1, ARGV[3], tostring(ver)}
```

Ghi chú hiệu năng: vòng `ZRANGE 0 -1` khi terminal là O(N) theo số deadline đang chờ (≤ vài trăm ở MVP: tối đa 4 deadline/cuộc gọi × 200 cuộc gọi). Khi scale, chuyển sang ZSET deadline riêng mỗi cuộc gọi.

**`call-deadlines-claim.lua`** — claim nguyên tử, dùng cho `call:deadlines`, `presence:offline-pending`, `presence:users`.

```lua
-- KEYS[1]=zset ARGV[1]=nowMs ARGV[2]=limit
local items = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, tonumber(ARGV[2]))
for _, m in ipairs(items) do redis.call('ZREM', KEYS[1], m) end
return items
```

**`presence-touch.lua`** — connect và heartbeat.

```lua
-- KEYS[1]=presence:conns:{u} KEYS[2]=presence:users KEYS[3]=presence:offline-pending
-- ARGV: 1 connId, 2 nowMs, 3 leaseMs, 4 userId
local now = tonumber(ARGV[2])
local exp = now + tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
local before = redis.call('ZCOUNT', KEYS[1], now, '+inf')
redis.call('ZADD', KEYS[1], exp, ARGV[1])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]))
redis.call('ZADD', KEYS[2], 'GT', exp, ARGV[4])
local pendingRemoved = redis.call('ZREM', KEYS[3], ARGV[4])
if before == 0 and pendingRemoved == 0 then return 1 end -- vừa ONLINE → phát presence:update
return 0
```

**`presence-drop.lua`** — socket ngắt.

```lua
-- KEYS[1]=presence:conns:{u} KEYS[2]=presence:offline-pending
-- ARGV: 1 connId, 2 nowMs, 3 graceMs, 4 userId
redis.call('ZREM', KEYS[1], ARGV[1])
local alive = redis.call('ZCOUNT', KEYS[1], tonumber(ARGV[2]), '+inf')
if alive == 0 then
  redis.call('ZADD', KEYS[2], tonumber(ARGV[2]) + tonumber(ARGV[3]), ARGV[4])
  return 1
end
return 0
```

Sweeper presence (mỗi `PRESENCE_SWEEP_INTERVAL_MS`): claim `presence:offline-pending` và `presence:users` (score ≤ now) → với mỗi `userId`, nếu `ZCOUNT presence:conns:{u} now +inf = 0` thì ghi `users.lastSeenAt` và phát OFFLINE; ngược lại bỏ qua (user đã quay lại; `presence:users` sẽ được `ZADD GT` lại ở lần touch tiếp).

---

## 6. Quan hệ dữ liệu, lưu trữ, migration

### 6.1 ERD

```text
 ┌──────────────┐ 1      * ┌──────────────────┐
 │    users     │──────────│ refreshSessions  │  (familyId gom các thế hệ token; TTL expiresAt)
 │ _id          │          └──────────────────┘
 │ email  (U)   │ 1      * ┌──────────────────┐
 │ username (U) │──────────│   userBlocks     │  blockerId → users, blockedId → users (U: blocker+blocked)
 └──────┬───────┘          └──────────────────┘
        │ 1
        │            * ┌───────────────────────┐ *        1 ┌──────────────────────┐
        ├──────────────│ conversationMembers   │────────────│    conversations     │
        │              │ (U: conversationId+   │            │ type, directKey (U*) │
        │              │  userId), role,       │            │ memberCount,         │
        │              │ lastDelivered*/       │            │ lastMessage ─────────┼──┐
        │              │ lastRead* cursor      │            └──────────┬───────────┘  │
        │              └───────────────────────┘                       │ 1            │ 0..1
        │                                                              │ *            ▼
        │ 1                                              *  ┌──────────────────────────┐
        ├───────────────────────────────────────────────────│        messages          │
        │                               senderId            │ (U*: conversationId+     │
        │                                                   │  senderId+clientMessageId)│
        │                                                   │ contentEnc | ciphertext |│
        │                                                   │ system{callId?}          │
        │                                                   └──────────┬───────────────┘
        │ 1                                                            │ 1 (chỉ DIRECT/SECRET)
        │                                              *  ┌────────────┴─────────────┐
        ├─────────────────────────────────────────────────│     messageReceipts      │
        │                         userId (người nhận)     │ (U: messageId+userId)    │
        │                                                 └──────────────────────────┘
        │ 2 (caller, callee)                   *  ┌──────────────────────────┐ *    1
        ├─────────────────────────────────────────│       callHistory        │────────── conversations
        │                    participantIds       │ _id = callId, status     │
        │                                         └──────────────────────────┘
        │ 1                           *  ┌──────────────────────┐ 1      * ┌────────────────────┐
        └────────────────────────────────│     userDevices      │──────────│  oneTimePreKeys    │
                                         │ (U: userId+deviceId) │ (userId+ │ (U: userId+device- │
                                         │ (U: userId+signal-   │ deviceId)│  Id+keyId)         │
                                         │  DeviceId)           │          │ TTL consumedAt     │
                                         └──────────────────────┘          └────────────────────┘
 (U) unique   (U*) unique partial
```

Không dùng `populate` trong đường nóng (gửi tin, receipt, signaling); service join bằng `$in` có chủ đích.

### 6.2 Chính sách lưu trữ và xóa dữ liệu

| Dữ liệu | Thời gian giữ | Cơ chế | Ghi chú |
|---|---|---|---|
| `users` | Vĩnh viễn trong MVP | — | MVP không có API xóa tài khoản; khóa tài khoản qua `user:lock` |
| `refreshSessions` | Tới `expiresAt` (≤ 30 ngày sau lần xoay cuối) | TTL `expires_ttl` | Thế hệ bị thu hồi vẫn giữ tới hết hạn để phát hiện reuse |
| `userBlocks` | Tới khi bỏ chặn | `deleteOne` | — |
| `conversations` | Vĩnh viễn; GROUP soft delete khi OWNER duy nhất rời | `deletedAt` | Không hard delete ở MVP |
| `conversationMembers` | Vĩnh viễn (giữ `leftAt` để phân biệt NOT_FOUND / NOT_A_MEMBER) | — | EC-SEC-001 |
| `messages` | Vĩnh viễn trong MVP | — | Tin thu hồi giữ document placeholder (không còn nội dung); xem ghi chú dung lượng bên dưới |
| `messageReceipts` | Theo `messages` | — | — |
| `callHistory` | 365 ngày | TTL `created_ttl` | SYSTEM message `CALL_*` vẫn còn sau khi record bị xóa; `system.callId` có thể trỏ tới record không còn — UI chỉ dùng `callType`, `durationSec` trong `system` |
| `userDevices` | Vĩnh viễn (REVOKED giữ lại để từ chối tin từ device đã thu hồi) | — | — |
| `oneTimePreKeys` | Chưa cấp: tới khi cấp hoặc device bị thu hồi; đã cấp: 7 ngày | TTL `consumed_ttl`; `deleteMany` khi thu hồi/đăng ký lại | — |
| Redis | Theo TTL ở mục 5.2 | — | Mất Redis chấp nhận được (kiến trúc §10.2) |
| Backup Mongo | 30 ngày | Kiến trúc §9.7 | Ciphertext; key ring lưu riêng |

Ghi chú dung lượng: ước tính 1 tin TEXT ≈ 0,5–1 KB (kèm index). Khi `messages` vượt 50 GB cần quyết định chính sách lưu trữ có thời hạn (ngoài MVP).

### 6.3 Tạo index — `npm run db:indexes`

Script gốc `db:indexes` gọi `npm run db:indexes -w server` → `tsx src/infra/db/indexes.ts`:

```ts
// server/src/infra/db/indexes.ts
import mongoose from 'mongoose';
import { env } from '../../config/env';
import { logger } from '../logger/logger';
import { UserModel } from '../../modules/users/user.model';
import { UserBlockModel } from '../../modules/users/userBlock.model';
import { RefreshSessionModel } from '../../modules/auth/refreshSession.model';
import { ConversationModel } from '../../modules/conversations/conversation.model';
import { ConversationMemberModel } from '../../modules/conversations/conversationMember.model';
import { MessageModel } from '../../modules/messages/message.model';
import { MessageReceiptModel } from '../../modules/messages/messageReceipt.model';
import { CallHistoryModel } from '../../modules/calls/callHistory.model';
import { UserDeviceModel } from '../../modules/e2ee/userDevice.model';
import { OneTimePreKeyModel } from '../../modules/e2ee/oneTimePreKey.model';

export const ALL_MODELS = [
  UserModel, RefreshSessionModel, UserBlockModel, ConversationModel, ConversationMemberModel,
  MessageModel, MessageReceiptModel, CallHistoryModel, UserDeviceModel, OneTimePreKeyModel,
] as const;

export async function ensureIndexes(): Promise<void> {
  for (const m of ALL_MODELS) {
    await m.createCollection();              // idempotent
    const dropped = await m.syncIndexes();   // tạo index thiếu, XÓA index không khai báo trong schema
    logger.info({ collection: m.collection.collectionName, dropped }, 'indexes synced');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await mongoose.connect(env.MONGODB_URI);
  await ensureIndexes();
  await mongoose.disconnect();
}
```

- `syncIndexes()` xóa index lạ: **không** tạo index thủ công ngoài schema. Ở production chạy trong cửa sổ bảo trì; index lớn tạo nền (MongoDB 7 build index không khóa ghi lâu dài). `// Xác minh với tài liệu chính thức của Mongoose 8: hành vi syncIndexes và giá trị trả về (danh sách index bị xóa).`
- Khi đổi định nghĩa một index đang tồn tại (khác option, cùng tên): đổi **tên** index để `syncIndexes` xóa bản cũ và tạo bản mới.
- Server khi khởi động kiểm tra `rs.status()` (thông qua `db.admin().command({ replSetGetStatus: 1 })`); không phải replica set → thoát (AC-ARCH-003).

### 6.4 Migration dữ liệu

- File `server/src/infra/db/migrations/NNN-<tên>.ts` (bổ sung vào cây kiến trúc §4.1), mỗi file export `{ id: 'NNN-<tên>', up(session?) }`; `up` phải **idempotent** và xử lý theo lô 500 document theo `_id` tăng dần.
- Chạy: `npm run db:migrate -w server` → `tsx src/infra/db/migrate.ts`: đọc collection kỹ thuật `_migrations` (`{ _id: id, appliedAt }`), chạy các migration chưa áp dụng theo thứ tự tên, ghi `_migrations` sau khi `up` hoàn tất.
- Không có migration down; sửa sai bằng migration mới.
- Thứ tự triển khai bản có thay đổi schema: `db:migrate` → `db:indexes` → khởi động server mới. Code mới phải đọc được cả dữ liệu dạng cũ trong lúc migration chạy (đổi schema theo kiểu mở rộng rồi thu hẹp).
- MVP v1.0.0 không có migration nào (`_migrations` rỗng).

### 6.5 Seed — `npm run db:seed`

`server/src/infra/db/seed.ts` tạo (idempotent theo email) 3 user: `alice@hustalo.local` (username `alice`, "Alice Nguyễn"), `bob@hustalo.local` (`bob`, "Bob Trần"), `carol@hustalo.local` (`carol`, "Carol Lê"), mật khẩu dev lấy từ biến `SEED_PASSWORD` `[NEW env, chỉ dev]` (mặc định trong `.env.example` do `development_guide.md` quy định); một DIRECT alice–bob có 3 tin mẫu; một GROUP "Nhóm HUSTALO" (alice OWNER, bob ADMIN, carol MEMBER). Từ chối chạy khi `NODE_ENV=production`.

---

## 7. Test database bắt buộc

Tầng: I (integration, `*.int.test.ts`, MongoMemoryReplSet + Redis test). Mỗi test gọi `ensureIndexes()` trong global setup.

| Test ID | Nội dung | Kỳ vọng | Liên kết |
|---|---|---|---|
| TC-DB-001 | `ensureIndexes()` hai lần liên tiếp | Lần 2 không tạo/xóa index nào; mọi index ở mục 2 tồn tại đúng option (unique/partial/TTL) | §6.3 |
| TC-DB-002 | Hai `UserModel.create` song song cùng email | Đúng một thành công, một `E11000` trên `email_unique` | EC-AUTH-001, AC-002 |
| TC-DB-003 | `passwordHash`, `tokenHash`, `parentHash` | Không xuất hiện trong `find()` mặc định; có khi `.select('+passwordHash')` / `.select('+tokenHash +parentHash')` | §1 |
| TC-DB-004 | Ghi trường không khai báo | Ném lỗi (`strict: 'throw'`) | §1 |
| TC-DB-005 | Bất biến `messages` (mục 2.6) | SYSTEM có `contentEnc` → lỗi; TEXT không body và chưa thu hồi → lỗi; có cả `contentEnc` và `ciphertext` → lỗi; service gửi SECRET không bao giờ tạo `contentEnc` | §2.6, EC-MSG-016 |
| TC-DB-006 | Hai `sendMessage` cùng `clientMessageId` song song | 1 document; một kết quả `duplicate: true` cùng `_id`; chỉ 1 receipt | EC-NET-004, AC-021 |
| TC-DB-007 | `sendMessage` khi người gửi bị xóa giữa bước 1 và 2 (hook test) | Transaction abort, không còn message/receipt/lastMessage thay đổi, lỗi `NOT_A_MEMBER` | EC-MSG-010 |
| TC-DB-008 | `getOrCreatePair` song song 20 lần cùng cặp | Đúng 1 conversation, đúng 2 member; 1 kết quả `created: true` | AC-017 |
| TC-DB-009 | `findPage` trên 250 tin, nhiều tin cùng `createdAt` (cùng mili-giây) | Duyệt `before` hết: đủ 250, không trùng, không thiếu; duyệt `after` từ đầu cũng vậy; `explain()` dùng `conv_created_id`, không có `SKIP` stage | AC-037, CLAUDE.md |
| TC-DB-010 | `advanceCursors` với cursor cũ hơn, bằng, mới hơn | Chỉ "mới hơn" làm `modifiedCount = 1`; không bao giờ lùi | AC-025 |
| TC-DB-011 | `markRead` DIRECT | Mọi receipt ≤ cursor có `readAt` và `deliveredAt`; receipt đã READ giữ nguyên `readAt` cũ | FR-CHAT-004 |
| TC-DB-012 | `transferOwner` và hai `addMembers` song song ở 97 thành viên | Luôn đúng 1 OWNER; `memberCount` = số member `leftAt: null` và ≤ 100 | AC-058, EC-GROUP-006 |
| TC-DB-013 | `unreadCount` | Bỏ qua tin của mình, tin thu hồi, SYSTEM trừ `CALL_MISSED` của người khác; dừng ở 100 | FR-CHAT-009, AC-039 |
| TC-DB-014 | `groupReadStats` | X/Y đúng khi thành viên có cursor null, bằng, vượt tin; người đã rời không tính | §3.2 |
| TC-DB-015 | `finalize` gọi 2 lần và gọi với `version` cũ | Lần 2 `changed: false`, record không đổi; `durationSec` chỉ khi có `connectedAt` | AC-084, EC-CALL-SIG-015 |
| TC-DB-016 | `consumeOneTimePreKey` song song 50 lần trên 30 prekey | Đúng 30 kết quả khác nhau, 20 kết quả `null`; không keyId nào bị cấp hai lần | FR-E2EE-002, EC-E2EE-002 |
| TC-DB-017 | Đăng ký device thứ 6 | `CONFLICT`; đăng ký lại device REVOKED cùng `deviceId` được, giữ `signalDeviceId` | FR-E2EE-001 |
| TC-DB-018 | Refresh rotation: xoay song song 2 lần cùng token | Một xoay thành công, một rơi vào nhánh grace (409); family không bị thu hồi | EC-AUTH-003, AC-007 |
| TC-DB-019 | Reuse token ngoài grace | `updateMany` thu hồi mọi thế hệ trong family | EC-AUTH-004, AC-006 |
| TC-DB-020 | `job:reencrypt` bị ngắt rồi chạy lại với `--after`, có sửa tin đồng thời | Không còn `keyId` cũ; tin vừa sửa giữ nội dung mới | AC-101 |
| TC-DB-021 | `call-invite.lua`: tạo, bận, glare, caller đang trong cuộc gọi | Trả đúng `CREATED`/`BUSY`/`GLARE`/`CALLER_IN_CALL`; glare chuyển call cũ sang ACCEPTED, xóa deadline RING, thêm CONNECT | EC-CALL-SIG-002/003, AC-077 |
| TC-DB-022 | `call-transition.lua` với `expectedFrom` sai | Trả `{0, status, version}`, không đổi gì; terminal xóa `user:incall` chỉ khi khớp callId và xóa mọi deadline của call | §5.4, T32 |
| TC-DB-023 | `call-deadlines-claim.lua` gọi đồng thời từ 2 client | Mỗi member chỉ được trả cho đúng một client | D-05 |
| TC-DB-024 | `presence-touch`/`presence-drop` với 2 kết nối | Chỉ lần touch đầu trả 1; drop kết nối đầu trả 0, drop kết nối cuối trả 1; touch trong grace xóa offline-pending và trả 0 | EC-PRES-001/002, AC-060, AC-061 |
| TC-DB-025 | Xóa toàn bộ Redis giữa chừng (`FLUSHDB`) rồi heartbeat | Lease tái tạo, user ONLINE lại sau ≤ 1 chu kỳ heartbeat | EC-PRES-005 |
| TC-DB-026 | TTL index | `refreshSessions.expiresAt`, `oneTimePreKeys.consumedAt`, `callHistory.createdAt` có `expireAfterSeconds` đúng giá trị | §6.2 |

---

## Consistency Check

- [x] **Enum, event, mã lỗi, hằng số khớp mục 2 và 3:**
  - Mọi enum lấy từ `@hustalo/shared` bằng `Object.values(Enum)`: `ConversationType`, `MemberRole` (OWNER/ADMIN/MEMBER; người tạo nhóm là OWNER), `MessageType`, `CallType`, `CallStatus` (đủ 12 giá trị trong `callHistory.status` — sửa mâu thuẫn #3), `CallEndReason`, `UserStatus`, `DeviceStatus`, `SessionRevokeReason`, `SystemEventKind`, `SignalMessageType`. `MessageClientStatus` và `PresenceStatus` không lưu trong Mongo (client-only / Redis).
  - Mã lỗi dùng: `CONFLICT`, `NOT_FOUND`, `NOT_A_MEMBER`, `FORBIDDEN`, `CONVERSATION_FULL`, `CALL_NOT_FOUND`, `SERVICE_UNAVAILABLE`, `VALIDATION_ERROR`, `INTERNAL_ERROR`; `DUPLICATE_MESSAGE` thể hiện bằng `duplicate: true`.
  - Hằng số: `DISPLAY_NAME_MAX`, `GROUP_TITLE_MAX`, `GROUP_MAX_MEMBERS`, `USERNAME_PATTERN`, `MESSAGE_EDIT_WINDOW_MS`, `UNREAD_COUNT_CAP`, `REFRESH_TOKEN_TTL_S`, `REFRESH_REUSE_GRACE_S`, `ACCESS_TOKEN_TTL_S`, `PRESENCE_LEASE_TTL_MS`, `PRESENCE_OFFLINE_GRACE_MS`, `PRESENCE_SWEEP_INTERVAL_MS`, `TYPING_TTL_MS`, `CALL_RING_TIMEOUT_MS`, `CALL_CONNECT_TIMEOUT_MS`, `CALL_STATE_TTL_S`, `CALL_MAX_ICE_RESTARTS`, `ICE_SERVERS_CACHE_TTL_S`, `E2EE_*`, `DATA_ENCRYPTION_VERSION`, `MONGO_TXN_MAX_RETRIES` dùng đúng tên và giá trị kiến trúc §4.4.1.
  - Event nhắc tới (`message:status`, `e2ee:prekeys-low`, `presence:update`) đúng tên §4.5.
- [x] **FR/AC tham chiếu bằng ID:** FR-AUTH-001..006, FR-USER-001..004, FR-CHAT-001..004/007..009/011, FR-GROUP-001/002/004, FR-PRES-001/002, FR-CALL-007/008, FR-SEC-002/004, FR-E2EE-001..004/007; AC-002, AC-006, AC-007, AC-017, AC-021, AC-025, AC-037, AC-039, AC-058, AC-060, AC-061, AC-077, AC-084, AC-101; AC-ARCH-003.
- [x] **Edge case có ID:** EC-AUTH-001/003/004, EC-NET-004, EC-MSG-010/012/015/016, EC-GROUP-001/006, EC-PRES-001/002/003/005, EC-CALL-SIG-001/002/003/015, EC-E2EE-002/006, EC-SEC-001, EC-INFRA-003 — đều thuộc ma trận PRD §5; 26 test DB `TC-DB-001..026` bổ sung cho Test ID của ma trận.
- [x] **Không có secret thật, không chỗ trống:** không có key/mật khẩu; mật khẩu seed lấy từ `SEED_PASSWORD`; không có "TODO" hay "tương tự như trên"; điểm chưa chắc về API thư viện đánh dấu `// Xác minh với tài liệu chính thức của <nhà cung cấp>` (Mongoose `includeResultMetadata`/`syncIndexes`, MongoDB driver `withTransaction`, độ dài khóa libsignal TS).
- [x] **Không mâu thuẫn với các file trước — điểm đã đối chiếu:**
  - Kiến trúc §4.1: model file đúng vị trí; bổ sung `infra/db/schema-options.ts`, `infra/db/tuple.ts`, `infra/db/migrate.ts`, `infra/db/migrations/` (mở rộng, không đổi cấu trúc).
  - Kiến trúc §7(b): thứ tự 5 bước của transaction gửi tin giữ nguyên (mục 4.4); ACK sau commit.
  - Kiến trúc §8: `callHistory` ghi sau mỗi chuyển trạng thái, finalize idempotent (T32), `active_reconcile` phục vụ §8.5; Redis hash/deadline khớp §8.3.
  - Kiến trúc §9.2: `contentEnc { v, keyId, iv (12 byte), ct, tag }`, AAD `conversationId:messageId`, index `reencrypt_keyId` cho job xoay khóa.
  - Kiến trúc Phụ lục A: mọi key Redis giữ nguyên pattern và TTL; chi tiết hóa thêm hash `call:active` và script Lua.
  - PRD §3.9: đủ các trường `username`, `displayNameNormalized`, `status`, `privacy.showLastSeen`, `lastSeenAt`, `avatarUrl`, `directKey`, `memberCount`, `lastMessage`, `lastMessageAt`, `deletedAt`, `createdBy`, `idempotencyKey`, `role`, `joinedAt`, `leftAt`, cursor receipt, `clientMessageId`, `contentEnc`, `ciphertext`, `system`, `editedAt`, `senderDeviceId`, `callerTabId`, `acceptedDeviceId/TabId`, `endReason`, `connectedAt`, `endedAt`, `durationSec`, `signalDeviceId`, `registrationId`, `identityKey`, `signedPreKey`, `revokedAt`.
  - **Điều chỉnh đã áp vào file trước:** cách tiêu thụ one-time prekey chốt là `findOneAndUpdate` set `consumedAt` (theo yêu cầu gốc), đã sửa tương ứng ở kiến trúc §7(h), §9.3 và PRD FR-E2EE-002, AC-111.
  - **Quyết định mới trong file này (các file sau phải phản ánh):** SYSTEM message có `senderId` = người thực hiện (cuộc gọi: caller) để đếm chưa đọc đúng; cursor receipt duy trì cho mọi loại hội thoại, `messageReceipts` bổ sung cho DIRECT/SECRET; `callHistory` giữ 365 ngày; idempotency GROUP có unique index DB làm nguồn sự thật, Redis `idem:conv` chỉ là fast path; biến `SEED_PASSWORD` cho seed.
