// server/src/modules/messages/message.crypto.ts — mã hóa nội dung tin DIRECT/GROUP (FR-SEC-002, kiến trúc §9.2):
// AES-256-GCM, AAD = `${conversationId}:${messageId}` — chép ciphertext sang tin/hội thoại khác thì giải mã thất bại.
import type { Types } from 'mongoose';
import { decryptField, encryptField, type EncryptedField } from '../../infra/crypto/aes-gcm';
import type { KeyRing } from '../../infra/crypto/key-ring';

export const messageAad = (conversationId: Types.ObjectId | string, messageId: Types.ObjectId | string) =>
  `${String(conversationId)}:${String(messageId)}`;

export const encryptContent = (
  conversationId: Types.ObjectId | string,
  messageId: Types.ObjectId | string,
  content: string,
  ring?: KeyRing,
): EncryptedField => encryptField(content, messageAad(conversationId, messageId), ring);

/** Giải mã lỗi (sai khóa/AAD, dữ liệu hỏng) → null: DTO trả `content: null` thay vì làm hỏng cả trang (api_spec Message). */
export function decryptContent(
  conversationId: Types.ObjectId | string,
  messageId: Types.ObjectId | string,
  enc: EncryptedField,
  ring?: KeyRing,
): string | null {
  try {
    return decryptField(enc, messageAad(conversationId, messageId), ring);
  } catch {
    return null;
  }
}
