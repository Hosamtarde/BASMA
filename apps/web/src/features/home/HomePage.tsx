import { PRODUCT_NAME } from '@app/shared';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ToothIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/field';
import { caseCountsQuery, latestCasesQuery } from '@/features/cases/api';
import { doctorsQuery } from '@/features/doctors/api';
import { labNameFor, settingsQuery, useLogoUrl } from '@/features/shell/settings';
import { formatIsoDate, formatWeekday, todayIn } from '@/i18n/format';
import { currentLanguage } from '@/i18n/i18n';
import { ActionCards } from './ActionCards';
import { LatestCases } from './LatestCases';
import { Pipeline } from './Pipeline';
import { StatusDonut } from './StatusDonut';

const LATEST = 5;
const panel = 'min-w-0 rounded-[14px] border border-border bg-card px-5 py-[18px]';

/**
 * Home (direction A, SPEC §1.1): lab banner, case pipeline (C's idea in A's look), the seven
 * action cards, the status donut and the latest cases. Every number is live from the API.
 */
export function HomePage() {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const { data: settings } = useSuspenseQuery(settingsQuery);
  const logoUrl = useLogoUrl(settings);
  const { data: counts } = useQuery(caseCountsQuery());
  const { data: latest } = useQuery(latestCasesQuery(LATEST));
  const { data: doctors } = useQuery(doctorsQuery({ search: '', active: true, page: 1 }));
  const today = todayIn(settings.labProfile?.timeZone ?? 'UTC');
  const labName = labNameFor(settings, lang);
  const empty = counts?.total === 0;

  return (
    <>
      <section
        aria-labelledby="home-title"
        className="relative mt-[18px] flex flex-wrap items-center gap-x-7 gap-y-3 overflow-hidden rounded-[20px] border border-border bg-card px-7 py-5"
      >
        {logoUrl !== null && (
          // The logo is raster: never enlarged past its native size.
          <img
            src={logoUrl}
            alt={t('shell.logoAlt')}
            className="block h-auto max-h-[120px] w-auto max-w-[200px]"
          />
        )}
        <div className="min-w-0">
          <h1 id="home-title" dir="auto" className="text-[26px] leading-[1.35] font-extrabold">
            {labName ?? t('home.title')}
          </h1>
          <p className="mt-0.5 text-[13px] font-bold text-cyan-ink">
            {t('home.welcome', { product: PRODUCT_NAME })}
          </p>
        </div>
        <p className="ms-auto text-end text-[14px] text-muted">
          <span className="sr-only">{t('home.today')}: </span>
          <span className="block">{formatWeekday(today, lang)}</span>
          <b className="num block text-[20px] font-extrabold text-ink">{formatIsoDate(today)}</b>
        </p>
        <div aria-hidden="true" className="bg-logo-rule absolute inset-x-0 bottom-0 h-[5px]" />
      </section>

      {!counts ? (
        <div className="mt-6">
          <Spinner label={t('common.loading')} />
        </div>
      ) : empty ? (
        <section
          aria-labelledby="home-empty-title"
          className="mt-[26px] flex flex-col items-center rounded-[20px] border border-dashed border-control bg-card px-6 py-9 text-center"
        >
          <span className="knob grid size-[64px] place-items-center rounded-full text-white [&_svg]:size-[30px]">
            <ToothIcon />
          </span>
          <h2 id="home-empty-title" className="mt-4 text-[19px] font-extrabold">
            {t('home.empty.title')}
          </h2>
          <p className="mt-1 max-w-[46ch] text-[14px] text-muted">{t('home.empty.body')}</p>
          <Button asChild className="mt-5">
            <Link to="/cases/new">
              <Plus aria-hidden="true" />
              {t('home.empty.cta')}
            </Link>
          </Button>
        </section>
      ) : (
        <Pipeline counts={counts} />
      )}

      <ActionCards figures={{ newCase: counts?.byStatus.ready, doctors: doctors?.total }} />

      {counts && !empty && (
        <div className="mt-[22px] grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1.25fr)]">
          <section aria-labelledby="donut-title" className={panel}>
            <h2 id="donut-title" className="mb-3 text-[16px] font-extrabold">
              {t('home.donut.title')}
            </h2>
            <StatusDonut counts={counts} />
          </section>
          <section aria-labelledby="latest-title" className={panel}>
            <h2 id="latest-title" className="mb-2 text-[16px] font-extrabold">
              {t('home.latest.title')}
            </h2>
            {latest ? <LatestCases items={latest.items} /> : <Spinner label={t('common.loading')} />}
          </section>
        </div>
      )}
    </>
  );
}
