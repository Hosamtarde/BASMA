import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { ApiError, NetworkError } from '@/api/errors';
import { i18next } from '@/i18n/i18n';

/** A tiny observable flag (no state library needed for two global signals). */
function flag(initial = false) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: boolean) {
      if (next === value) return;
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** True while the API cannot be reached: the full-width banner with "try again" shows. */
export const apiDown = flag();
/** True while the "changed elsewhere" (409 stale) dialog is open. */
export const staleDialog = flag();

export const useFlag = (f: ReturnType<typeof flag>) =>
  useSyncExternalStore(
    (cb) => f.subscribe(cb),
    () => f.get(),
    () => f.get(),
  );

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(i18next.t('common.copied'));
  } catch {
    // Clipboard blocked: the reference stays visible in the toast.
  }
}

/**
 * The approved F0 error table for anything not shown inline by a form:
 * network → banner · 409 stale → dialog · 5xx → message + copyable reference ·
 * 401 → nothing here (the session expiry handler signs out) · others → the server's message.
 */
export function reportError(err: unknown): void {
  if (err instanceof NetworkError) {
    apiDown.set(true);
    return;
  }
  if (!(err instanceof ApiError)) {
    toast.error(i18next.t('errors.unexpected'));
    return;
  }
  switch (err.kind) {
    case 'unauthenticated':
      return;
    case 'stale':
      staleDialog.set(true);
      return;
    case 'server':
      toast.error(err.message, {
        description: i18next.t('errors.correlation', { id: err.correlationId }),
        action: { label: i18next.t('common.copy'), onClick: () => void copy(err.correlationId) },
        duration: 15_000,
      });
      return;
    default:
      toast.error(err.message);
  }
}
