import { i18next } from '@/i18n/i18n';
import { toApiError } from './errors';

/** What a file request returns: the bytes, the name the server chose and how many rows it holds. */
export interface Downloaded {
  blob: Blob;
  fileName: string;
  rows: number;
}

/** The ASCII file name from `Content-Disposition: attachment; filename="…"`. */
export function fileNameOf(header: string | null, fallback: string): string {
  const match = header ? /filename="([^"\\/]+)"/.exec(header) : null;
  return match?.[1] ?? fallback;
}

/**
 * Takes the result of a generated-client call made with `parseAs: 'blob'` (so the Bearer token and the
 * silent refresh apply, which a plain link cannot do) and throws the same typed errors as `unwrap`.
 */
export async function takeFile(
  call: Promise<{ data?: Blob; error?: unknown; response: Response }>,
  fallbackName: string,
): Promise<Downloaded> {
  const { data, error, response } = await call;
  if (!response.ok || error !== undefined || !data) {
    throw toApiError(response.status, error, i18next.t('errors.unexpected'));
  }
  return {
    blob: data,
    fileName: fileNameOf(response.headers.get('content-disposition'), fallbackName),
    rows: Number.parseInt(response.headers.get('x-export-rows') ?? '', 10) || 0,
  };
}

/** Hands the bytes to the browser as a download and releases the temporary address at once. */
export function saveFile({ blob, fileName }: Downloaded): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    document.body.append(a);
    a.click();
    a.remove();
  } finally {
    // The click has started the download by now; revoking on the next turn is the safe pattern.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
