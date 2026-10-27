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
