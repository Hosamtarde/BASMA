export const MAX_LOGO_BYTES = 1_048_576;

export type LogoMimeType = 'image/png' | 'image/jpeg';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

const startsWith = (data: Uint8Array, signature: number[]) =>
  data.length >= signature.length && signature.every((byte, i) => data[i] === byte);

/**
 * The type comes from the file's own bytes, never from its name or the client's Content-Type.
 * Only PNG and JPEG are accepted (no SVG: it can carry scripts).
 */
export function detectLogoType(data: Uint8Array): LogoMimeType | null {
  if (startsWith(data, PNG_SIGNATURE)) return 'image/png';
  if (startsWith(data, JPEG_SIGNATURE)) return 'image/jpeg';
  return null;
}
