import { PRODUCT_NAME } from '@app/shared';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitch } from '@/features/shell/LanguageSwitch';
import { cn } from '@/lib/cn';

interface AuthLayoutProps {
  title: string;
  intro?: string;
  /** Wider card for the setup wizard. */
  wide?: boolean;
  children: ReactNode;
}

/**
 * Signed-out pages (login, first-run setup, password change): the product name, the language
 * switch and the vendor credit, which SPEC §2.3 allows on these screens only.
 */
export function AuthLayout({ title, intro, wide = false, children }: AuthLayoutProps) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-sidebar flex h-16 items-center gap-3 px-6 text-white">
        <span className="text-[18px] font-extrabold">{PRODUCT_NAME}</span>
        <span className="flex-1" />
        <div className="rounded-[var(--radius-control)] bg-white/95 text-ink">
          <LanguageSwitch />
        </div>
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 py-10 md:items-center">
        <section
          aria-labelledby="auth-title"
          className={cn(
            'relative w-full overflow-hidden rounded-[var(--radius-card)] border border-border bg-card px-6 pt-7 pb-8 md:px-8',
            wide ? 'max-w-3xl' : 'max-w-md',
          )}
        >
          <div aria-hidden="true" className="bg-logo-rule absolute inset-x-0 top-0 h-1.5" />
          <h1 id="auth-title" className="text-[24px] leading-tight font-extrabold">
            {title}
          </h1>
          {intro && <p className="mt-1.5 text-[14px] text-muted">{intro}</p>}
          <div className="mt-6">{children}</div>
        </section>
      </main>
      <footer className="pb-6 text-center text-[13px] text-muted">{t('app.vendorCredit')}</footer>
    </div>
  );
}
