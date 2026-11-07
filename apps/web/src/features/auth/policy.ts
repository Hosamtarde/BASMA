import { z } from 'zod';
import { msg } from '@/lib/form-messages';

/**
 * Mirrors apps/api/src/modules/identity/domain/credentials-policy.ts (the server stays the
 * authority; these only give early, localized feedback).
 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 50;
export const USERNAME_PATTERN = /^[\p{L}\p{N}._-]+$/u;

export const usernameSchema = z
  .string()
  .trim()
  .min(1, msg('validation.required'))
  .min(USERNAME_MIN_LENGTH, msg('validation.minLength', { count: USERNAME_MIN_LENGTH }))
  .max(USERNAME_MAX_LENGTH, msg('validation.maxLength', { max: USERNAME_MAX_LENGTH }))
  .regex(USERNAME_PATTERN, msg('validation.usernameFormat'));

export const newPasswordSchema = z
  .string()
  .min(1, msg('validation.required'))
  .min(PASSWORD_MIN_LENGTH, msg('validation.minLength', { count: PASSWORD_MIN_LENGTH }))
  .max(PASSWORD_MAX_LENGTH, msg('validation.maxLength', { max: PASSWORD_MAX_LENGTH }));

/** Login only bounds the input; the policy may change after an account was created. */
export const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, msg('validation.required'))
    .max(USERNAME_MAX_LENGTH, msg('validation.maxLength', { max: USERNAME_MAX_LENGTH })),
  password: z
    .string()
    .min(1, msg('validation.required'))
    .max(PASSWORD_MAX_LENGTH, msg('validation.maxLength', { max: PASSWORD_MAX_LENGTH })),
});
export type LoginForm = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, msg('validation.required')).max(PASSWORD_MAX_LENGTH),
    newPassword: newPasswordSchema,
    confirmPassword: z.string().min(1, msg('validation.required')),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: msg('validation.passwordsMismatch'),
  });
export type ChangePasswordForm = z.infer<typeof changePasswordSchema>;
