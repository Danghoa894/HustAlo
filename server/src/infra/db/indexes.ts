// server/src/infra/db/indexes.ts — entry `npm run db:indexes` (database_schema.md §6.3)
// ALL_MODELS được bổ sung theo milestone tạo model (M2: conversations, M3: messages, M5: callHistory, M7: e2ee).
import mongoose from 'mongoose';
import { env } from '../../config/env';
import { logger } from '../logger/logger';
import { isMainModule } from '../runtime/is-main';
import { connectMongo } from './mongo';
import { RefreshSessionModel } from '../../modules/auth/refreshSession.model';
import { UserModel } from '../../modules/users/user.model';
import { UserBlockModel } from '../../modules/users/userBlock.model';

export interface IndexedModel {
  createCollection(): Promise<unknown>;
  syncIndexes(): Promise<string[]>;
  readonly collection: { readonly collectionName: string };
}

export const ALL_MODELS: readonly IndexedModel[] = [UserModel, RefreshSessionModel, UserBlockModel];

export async function ensureIndexes(models: readonly IndexedModel[] = ALL_MODELS): Promise<void> {
  for (const m of models) {
    await m.createCollection(); // idempotent
    const dropped = await m.syncIndexes(); // tạo index thiếu, XÓA index không khai báo trong schema
    logger.info({ collection: m.collection.collectionName, dropped }, 'indexes synced');
  }
}

if (isMainModule(import.meta.url)) {
  await connectMongo(env.MONGODB_URI);
  await ensureIndexes();
  await mongoose.disconnect();
}
