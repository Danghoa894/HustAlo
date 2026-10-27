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
