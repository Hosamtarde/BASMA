import { useQueryClient } from '@tanstack/react-query';
import { CloudOff, RefreshCw } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { session } from '@/api/session';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/field';
import { apiDown, staleDialog, useFlag } from './feedback';

export const useSessionToken = () =>
  useSyncExternalStore(
    (cb) => session.subscribe(cb),
    () => session.token(),
    () => session.token(),
  );

export function FullPageStatus() {
  const { t } = useTranslation();
  return (
    <div className="grid min-h-dvh place-items-center">
      <Spinner label={t('common.loading')} />
    </div>
  );
}

/** Retries the active queries; the banner closes as soon as one request succeeds. */
function useRetryConnection() {
  const queryClient = useQueryClient();
  return async () => {
    try {
      const res = await fetch('/api/v1/health/live');
      if (res.ok) apiDown.set(false);
    } catch {
      return;
    }
    await queryClient.refetchQueries({ type: 'active' });
  };
}

/** Full-width banner while the API cannot be reached (service stopped). */
export function ApiDownBanner() {
  const { t } = useTranslation();
  const down = useFlag(apiDown);
  const retry = useRetryConnection();
  if (!down) return null;
  return (
    <div
      role="alert"
      className="sticky top-0 z-40 flex flex-wrap items-center gap-3 bg-danger px-6 py-3 text-white"
    >
      <CloudOff aria-hidden="true" className="size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-extrabold">{t('errors.network.title')}</p>
        <p className="text-[14px]">{t('errors.network.body')}</p>
      </div>
      <Button variant="secondary" size="sm" onClick={() => void retry()}>
        <RefreshCw aria-hidden="true" />
        {t('common.retry')}
      </Button>
    </div>
  );
}

/** The API is down before anything could load (boot): a full page with "try again". */
export function ApiDownPage({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div
        role="alert"
        className="max-w-md rounded-[var(--radius-card)] border border-border bg-card p-8 text-center"
      >
        <CloudOff aria-hidden="true" className="mx-auto size-10 text-danger" />
        <h1 className="mt-3 text-[22px] font-extrabold">{t('errors.network.title')}</h1>
        <p className="mt-1.5 text-muted">{t('errors.network.body')}</p>
        <Button className="mt-5" onClick={onRetry}>
          <RefreshCw aria-hidden="true" />
          {t('common.retry')}
        </Button>
      </div>
    </main>
  );
}

/** 409 error.concurrency.stale: the data changed elsewhere; reload it before trying again. */
export function StaleDialog() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const open = useFlag(staleDialog);
  return (
    <Dialog.Root open={open} onOpenChange={(o) => staleDialog.set(o)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/40" />
        <Dialog.Content className="fixed inset-0 z-50 m-auto h-fit w-[min(440px,calc(100vw-32px))] rounded-[var(--radius-card)] bg-card p-6 shadow-[var(--shadow-dialog)]">
          <Dialog.Title className="text-[19px] font-extrabold">{t('errors.stale.title')}</Dialog.Title>
          <Dialog.Description className="mt-2 text-muted">{t('errors.stale.body')}</Dialog.Description>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <Button
              onClick={() => {
                void queryClient.invalidateQueries();
                staleDialog.set(false);
              }}
            >
              <RefreshCw aria-hidden="true" />
              {t('common.reload')}
            </Button>
            <Dialog.Close asChild>
              <Button variant="secondary">{t('common.close')}</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
