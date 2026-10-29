// server/src/modules/messages/message.model.ts — database_schema.md §2.6 (M2: tạo SYSTEM; TEXT gửi/nhận ở M3)
import {
  CallType,
  DATA_ENCRYPTION_VERSION,
  E2EE_ENVELOPE_VERSION,
  E2EE_MAX_DEVICES_PER_USER,
  GROUP_TITLE_MAX,
  MessageType,
  SignalMessageType,
  SystemEventKind,
} from '@hustalo/shared';
import { Schema, model, type InferSchemaType } from 'mongoose';
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
    title: { type: String, default: null, maxlength: GROUP_TITLE_MAX * 2 }, // code point kiểm ở Zod; *2 cho UTF-16
    role: { type: String, default: null, enum: ['ADMIN', 'MEMBER', null] }, // chỉ ROLE_CHANGED: role mới của target
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

/** Các field mà bất biến theo loại cần đọc (InferSchemaType không suy được qua baseSchemaOptions). */
interface MessageShape {
  type: string;
  system: unknown;
  contentEnc: unknown;
  ciphertext: unknown;
  clientMessageId: string | null;
  deletedAt: Date | null;
}

messageSchema.pre('validate', function (this: MessageShape, next) {
  const isSystem = this.type === MessageType.SYSTEM;
  if (isSystem) {
    if (!this.system || this.contentEnc || this.ciphertext || this.clientMessageId) {
      next(new Error('SYSTEM message chỉ có trường system'));
      return;
    }
  } else {
    if (!this.clientMessageId || this.system) {
      next(new Error('TEXT cần clientMessageId, không có system'));
      return;
    }
    if (this.contentEnc && this.ciphertext) {
      next(new Error('Không được có cả contentEnc và ciphertext'));
      return;
    }
    if (!this.deletedAt && !this.contentEnc && !this.ciphertext) {
      next(new Error('TEXT chưa thu hồi cần contentEnc hoặc ciphertext'));
      return;
    }
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
