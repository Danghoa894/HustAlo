// packages/shared/src/schemas/user.schema.ts — UserPublic, UserMe, Privacy, cập nhật hồ sơ, tìm kiếm
// (api_spec components/schemas; PRD FR-USER-001..003)
import { z } from 'zod';
import { DISPLAY_NAME_MAX, USER_SEARCH_LIMIT, USER_SEARCH_MAX_QUERY, USER_SEARCH_MIN_QUERY } from '../constants';
import { countCodePoints, normalizeDisplayName } from '../utils/text';
import { isoDate, objectId } from './common.schema';

export const avatarUrlSchema = z.string().max(2048).url().regex(/^https:\/\//, 'Ảnh đại diện phải là URL https://');

export const PrivacySchema = z.object({ showLastSeen: z.boolean() }).strict();
export type Privacy = z.infer<typeof PrivacySchema>;

export const UserPublicSchema = z
  .object({
    id: objectId,
    username: z.string(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
    blockedByMe: z.boolean().optional(), // chỉ có trong kết quả tìm kiếm
  })
  .strict();
export type UserPublic = z.infer<typeof UserPublicSchema>;

export const UserMeSchema = z
  .object({
    id: objectId,
    email: z.string(),
    username: z.string(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
    privacy: PrivacySchema,
    blockedUserIds: z.array(objectId).max(1000),
    createdAt: isoDate,
  })
  .strict();
export type UserMe = z.infer<typeof UserMeSchema>;

/** NFC + trim, 1..DISPLAY_NAME_MAX code point, không chỉ khoảng trắng (FR-AUTH-001, FR-USER-002). */
export const displayNameSchema = z
  .string()
  .transform(normalizeDisplayName)
  .refine((s) => countCodePoints(s) >= 1, { message: 'Tên hiển thị không được để trống' })
  .refine((s) => countCodePoints(s) <= DISPLAY_NAME_MAX, {
    message: `Tên hiển thị tối đa ${DISPLAY_NAME_MAX} ký tự`,
  });

export const UpdateMeRequestSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    avatarUrl: avatarUrlSchema.nullable().optional(),
    privacy: PrivacySchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Cần ít nhất một trường' });
export type UpdateMeRequest = z.infer<typeof UpdateMeRequestSchema>;

export const UserSearchQuerySchema = z
  .object({
    q: z
      .string()
      .transform((s) => s.trim())
      .pipe(z.string().min(USER_SEARCH_MIN_QUERY).max(USER_SEARCH_MAX_QUERY)),
  })
  .strict();
export type UserSearchQuery = z.infer<typeof UserSearchQuerySchema>;

export const UserSearchResponseSchema = z
  .object({ items: z.array(UserPublicSchema).max(USER_SEARCH_LIMIT) })
  .strict();
export type UserSearchResponse = z.infer<typeof UserSearchResponseSchema>;

export const UserIdParamsSchema = z.object({ userId: objectId }).strict();
export type UserIdParams = z.infer<typeof UserIdParamsSchema>;
