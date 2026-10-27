// packages/shared/src/schemas/common.schema.ts — primitive dùng chung (api_spec components/schemas)
import { z } from 'zod';
import { MESSAGE_MAX_LENGTH } from '../constants';
import { countCodePoints, normalizeMessageText } from '../utils/text';

export const objectId = z.string().regex(/^[a-f0-9]{24}$/, 'ObjectId không hợp lệ');

export const uuidV4 = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'UUID v4 không hợp lệ');

export const isoDate = z.string().datetime();

export const pageCursor = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'Cursor không hợp lệ');

/** NFC + trim hai đầu (gồm zero-width), 1..MESSAGE_MAX_LENGTH code point (D-17). Output là chuỗi đã chuẩn hóa. */
export const normalizedText = z
  .string()
  .transform(normalizeMessageText)
  .refine((s) => countCodePoints(s) >= 1, { message: 'Nội dung không được để trống' })
  .refine((s) => countCodePoints(s) <= MESSAGE_MAX_LENGTH, {
    message: `Nội dung tối đa ${MESSAGE_MAX_LENGTH} ký tự`,
  });

/** GET /health (api_spec HealthResponse). */
export const HealthResponseSchema = z
  .object({
    status: z.enum(['ok', 'degraded', 'draining']),
    mongo: z.enum(['up', 'down']),
    redis: z.enum(['up', 'down']),
  })
  .strict();
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
