import { PRODUCT_NAME } from '@app/shared';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { labNameFor, settingsQuery } from '@/features/shell/settings';
import { formatIsoDate, formatWeekday, todayIn } from '@/i18n/format';
import { currentLanguage } from '@/i18n/i18n';

/**
 * F0 Home: the lab banner with today's date in the lab's time zone. The action cards and C's
 * pipeline strip (SPEC §1.1) arrive with the slices that make them work, so nothing here is dead.
 */
export function HomePage() {
  const { t } = useTranslation();
  const { data: settings } = useSuspenseQuery(settingsQuery);
  const lang = currentLanguage();
  const today = todayIn(settings.labProfile?.timeZone ?? 'UTC');
  return (
    <>
      <h1 className="sr-only">{t('home.title')}</h1>
      <section
        aria-label={t('home.title')}
        className="relative mt-4 flex flex-wrap items-center gap-7 overflow-hidden rounded-[20px] border border-border bg-card px-7 py-5"
      >
        <div className="min-w-0">
          <p dir="auto" className="text-[26px] leading-snug font-extrabold">
            {labNameFor(settings, lang)}
          </p>
          <p className="mt-0.5 text-[14px] font-bold text-cyan-ink">
            {t('home.welcome', { product: PRODUCT_NAME })}
          </p>
        </div>
        <div className="ms-auto text-end text-[14px] text-muted">
          <span className="block">{t('home.today')}</span>
          <span className="block text-[20px] font-extrabold text-ink">{formatWeekday(today, lang)}</span>
          <span className="num block">{formatIsoDate(today)}</span>
        </div>
        <div aria-hidden="true" className="bg-logo-rule absolute inset-x-0 bottom-0 h-[5px]" />
      </section>
    </>
  );
}
