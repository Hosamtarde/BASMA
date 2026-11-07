import { api, unwrap } from '@/api/client';
import type { components } from '@/api/schema.gen';

export type UpdateLabProfile = components['schemas']['UpdateLabProfileRequest'];
export type UpdateCurrency = components['schemas']['UpdateCurrencyRequest'];
export type UpdateLanguage = components['schemas']['UpdateLanguageRequest'];
export type UpdateNumbering = components['schemas']['UpdateNumberingRequest'];

/** Same limits as the API (apps/api/src/modules/settings/domain/logo.ts). */
export const MAX_LOGO_BYTES = 1_048_576;
export const LOGO_TYPES = ['image/png', 'image/jpeg'] as const;

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

export type LogoProblem = 'type' | 'size' | 'empty';

/**
 * Early check before uploading (the server checks the bytes again): PNG or JPEG by both the
 * declared type and the file's first bytes, and at most 1 MB.
 */
export async function checkLogoFile(file: File): Promise<LogoProblem | null> {
  if (file.size === 0) return 'empty';
  if (file.size > MAX_LOGO_BYTES) return 'size';
  if (!(LOGO_TYPES as readonly string[]).includes(file.type)) return 'type';
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const starts = (sig: number[]) => sig.every((b, i) => head[i] === b);
  return starts(PNG) || starts(JPEG) ? null : 'type';
}

export const settingsApi = {
  labProfile: (body: UpdateLabProfile) => unwrap(api.PATCH('/api/v1/settings/lab-profile', { body })),
  currency: (body: UpdateCurrency) => unwrap(api.PATCH('/api/v1/settings/currency', { body })),
  language: (body: UpdateLanguage) => unwrap(api.PATCH('/api/v1/settings/language', { body })),
  numbering: (body: UpdateNumbering) => unwrap(api.PATCH('/api/v1/settings/numbering', { body })),
  uploadLogo: (file: File) =>
    unwrap(
      api.PUT('/api/v1/settings/logo', {
        // OpenAPI types a binary part as a string; the serializer below sends the real file.
        body: { file } as unknown as { file: string },
        bodySerializer: () => {
          const form = new FormData();
          form.append('file', file);
          return form;
        },
      }),
    ),
  removeLogo: () => unwrap(api.DELETE('/api/v1/settings/logo')),
};
