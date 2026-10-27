// packages/shared/src/schemas/auth.schema.ts — hợp đồng REST /auth/* (api_spec RegisterRequest, LoginRequest,
// ChangePasswordRequest, AuthResponse; PRD FR-AUTH-001/002/005)
import { z } from 'zod';
import { PASSWORD_MAX, PASSWORD_MIN, USERNAME_PATTERN } from '../constants';
import { isoDate, uuidV4 } from './common.schema';
import { UserMeSchema, displayNameSchema } from './user.schema';

/** Email chuẩn hóa trim + lowercase trước khi kiểm (kiến trúc §9.4). */
export const emailSchema = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
  z.string().max(254).email('Email không hợp lệ'),
);

export const usernameSchema = z.string().regex(USERNAME_PATTERN, 'Tên người dùng không hợp lệ');

/** Ít nhất 1 chữ cái và 1 chữ số, PASSWORD_MIN..PASSWORD_MAX ký tự. */
export const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*[0-9]).{8,128}$/;
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN)
  .max(PASSWORD_MAX)
  .regex(PASSWORD_PATTERN, 'Mật khẩu cần ít nhất 8 ký tự, gồm chữ và số');

export const RegisterRequestSchema = z
  .object({
    email: emailSchema,
    username: usernameSchema,
    password: newPasswordSchema,
    displayName: displayNameSchema,
    deviceId: uuidV4,
  })
  .strict()
  .superRefine((v, ctx) => {
    const pw = v.password.toLowerCase();
    if (pw === v.email || pw === v.username) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['password'],
        message: 'Mật khẩu không được trùng email hoặc tên người dùng',
      });
    }
  });
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(PASSWORD_MAX),
    deviceId: uuidV4,
  })
  .strict();
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const ChangePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1).max(PASSWORD_MAX),
    newPassword: newPasswordSchema,
  })
  .strict();
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

export const AuthResponseSchema = z
  .object({
    accessToken: z.string(),
    accessTokenExpiresAt: isoDate,
    user: UserMeSchema,
  })
  .strict();
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

/** Tên cookie và header (kiến trúc §6.3). */
export const REFRESH_COOKIE_NAME = 'hustalo_rt';
export const CSRF_COOKIE_NAME = 'hustalo_csrf';
export const CSRF_HEADER_NAME = 'X-CSRF-Token';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
