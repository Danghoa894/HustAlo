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
