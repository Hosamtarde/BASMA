import { z } from 'zod';
import { newPasswordSchema, usernameSchema } from '@/features/auth/policy';
import { LANGUAGES } from '@/i18n/i18n';
import { msg } from '@/lib/form-messages';

/** Mirrors the API limits (settings and identity DTOs); the server stays the authority. */
export const LAB_NAME_MAX_LENGTH = 100;
export const ADDRESS_MAX_LENGTH = 300;
export const PHONE_MAX_LENGTH = 30;
const PHONE_PATTERN = /^[\p{Nd}+\-() ]+$/u;

const optionalText = (max: number) => z.string().trim().max(max, msg('validation.maxLength', { max }));

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return value.length > 0;
  } catch {
    return false;
  }
}

/** The installation's time zone as Windows reports it (owner decision: initial value from Windows). */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return '';
  }
}

export const setupSchema = z
  .object({
    username: usernameSchema,
    password: newPasswordSchema,
    confirmPassword: z.string().min(1, msg('validation.required')),
    lab: z.object({
      nameAr: optionalText(LAB_NAME_MAX_LENGTH),
      nameEn: optionalText(LAB_NAME_MAX_LENGTH),
      phone: z
        .string()
        .trim()
        .min(1, msg('validation.required'))
        .max(PHONE_MAX_LENGTH, msg('validation.maxLength', { max: PHONE_MAX_LENGTH }))
        .regex(PHONE_PATTERN, msg('validation.phoneFormat')),
      address: optionalText(ADDRESS_MAX_LENGTH),
    }),
    currency: z.object({
      code: z
        .string()
        .trim()
        .min(1, msg('validation.required'))
        .max(10, msg('validation.maxLength', { max: 10 })),
      symbol: z
        .string()
        .trim()
        .min(1, msg('validation.required'))
        .max(5, msg('validation.maxLength', { max: 5 })),
      decimals: z.coerce
        .number()
        .int()
        .min(0, msg('validation.decimalsRange'))
        .max(3, msg('validation.decimalsRange')),
    }),
    language: z.enum(LANGUAGES),
    timeZone: z.string().trim().refine(isTimeZone, msg('validation.timeZone')),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: msg('validation.passwordsMismatch'),
  })
  .refine((v) => v.lab.nameAr !== '' || v.lab.nameEn !== '', {
    path: ['lab', 'nameAr'],
    message: msg('validation.labNameRequired'),
  });

export type SetupFormInput = z.input<typeof setupSchema>;
export type SetupForm = z.output<typeof setupSchema>;

/** Fields the server may name in details.fields (dotted API names). */
export const SETUP_SERVER_FIELDS = [
  'username',
  'password',
  'lab.nameAr',
  'lab.nameEn',
  'lab.phone',
  'lab.address',
  'currency.code',
  'currency.symbol',
  'currency.decimals',
  'language',
  'timeZone',
] as const;
