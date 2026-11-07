import { QueryClientProvider } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { Direction } from 'radix-ui';
import { RouterProvider } from 'react-router';
import type { DataRouter } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Toaster } from 'sonner';
import { directionOf, isLanguage } from '@/i18n/i18n';

/** Providers: server state, RTL/LTR for Radix popovers and dialogs, toasts at the top-start corner. */
export function App({ queryClient, router }: { queryClient: QueryClient; router: DataRouter }) {
  const { t, i18n } = useTranslation();
  const dir = directionOf(isLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : 'ar');
  return (
    <QueryClientProvider client={queryClient}>
      <Direction.Provider dir={dir}>
        <RouterProvider router={router} />
        <Toaster
          dir={dir}
          position={dir === 'rtl' ? 'top-right' : 'top-left'}
          containerAriaLabel={t('shell.notifications')}
          // Own colours: Sonner's rich colours fail WCAG AA text contrast (axe).
          toastOptions={{
            classNames: {
              toast: 'font-sans! border-border! text-ink!',
              success: 'bg-success-bg! text-success-ink! border-success-ink/25!',
              error: 'bg-danger-bg! text-danger! border-danger/25!',
              info: 'bg-info-bg! text-ink!',
              description: 'text-ink! opacity-90',
            },
          }}
        />
      </Direction.Provider>
    </QueryClientProvider>
  );
}
