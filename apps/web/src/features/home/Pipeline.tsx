import { ChevronRight, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { CaseCounts, CaseStatus } from '@/features/cases/api';
import { STATUS_STYLE } from '@/features/cases/status';
import { formatNumber } from '@/i18n/format';
import { currentLanguage } from '@/i18n/i18n';
import { cn } from '@/lib/cn';

/** The lab's flow, left to right in reading order; returned and cancelled sit beside it. */
const FLOW: readonly CaseStatus[] = ['waiting', 'design', 'in_progress', 'ready', 'delivered'];
const SIDE: readonly CaseStatus[] = ['returned', 'cancelled'];

/** Top rule of each stage card, in the exact status colour. */
const RULE: Record<CaseStatus, string> = {
  waiting: 'before:bg-st-waiting',
  design: 'before:bg-st-design',
  in_progress: 'before:bg-st-in_progress',
  ready: 'before:bg-st-ready',
  delivered: 'before:bg-st-delivered',
  returned: 'before:bg-st-returned',
  cancelled: 'before:bg-st-cancelled',
};

/**
 * «مسار الحالات» (direction C's idea, drawn in direction A's language): one card per stage with
 * its live count, each opening the case list filtered on that stage; overdue beside them.
 */
export function Pipeline({ counts }: { counts: CaseCounts }) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const n = (v: number) => formatNumber(v, lang);
  return (
    <section aria-labelledby="pipeline-title">
      <div className="mt-[26px] mb-3 flex items-baseline justify-between gap-3">
        <h2 id="pipeline-title" className="text-[16px] font-extrabold">
          {t('home.pipeline.title')}
        </h2>
        <Link to="/cases" className="text-[13.5px] font-bold text-cyan-ink no-underline hover:underline">
          {t('home.pipeline.all')} <span className="num">({n(counts.total)})</span>
        </Link>
      </div>
      <div className="grid gap-3.5 sm:grid-cols-[minmax(0,5fr)_minmax(0,1.15fr)]">
        <ol className="m-0 grid list-none grid-cols-2 gap-3.5 p-0 sm:grid-cols-5">
          {FLOW.map((s, i) => (
            <li key={s} className="relative">
              <Link
                to={`/cases?status=${s}`}
                className={cn(
                  'relative flex h-full flex-col overflow-hidden rounded-[14px] border border-border bg-card px-4 pt-3.5 pb-3 text-ink no-underline transition-[transform,border-color] hover:-translate-y-0.5 hover:border-blue',
                  'before:absolute before:inset-x-0 before:top-0 before:h-1 before:content-[""]',
                  RULE[s],
                )}
              >
                <span
                  className={cn('flex items-center gap-1.5 text-[13.5px] font-bold', STATUS_STYLE[s].text)}
                >
                  <i aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', STATUS_STYLE[s].dot)} />
                  {t(`caseStatus.${s}`)}
                </span>{' '}
                <span className="num mt-1 text-start text-[28px] leading-tight font-extrabold">
                  {n(counts.byStatus[s])}
                </span>
              </Link>
              {i < FLOW.length - 1 && (
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 -end-[15px] z-[1] my-auto hidden size-[16px] place-items-center rounded-full border border-border bg-card text-muted sm:grid"
                >
                  <ChevronRight className="size-3 rtl:rotate-180" />
                </span>
              )}
            </li>
          ))}
        </ol>
        <ul className="m-0 grid list-none grid-cols-3 gap-1.5 p-0 sm:grid-cols-1">
          {SIDE.map((s) => (
            <li key={s}>
              <Link
                to={`/cases?status=${s}`}
                className={cn(
                  'flex h-full items-center justify-between gap-2 rounded-[10px] px-3 py-1 text-[13px] font-bold no-underline hover:brightness-95',
                  STATUS_STYLE[s].badge,
                )}
              >
                <span>{t(`caseStatus.${s}`)}</span>{' '}
                <span className="num font-extrabold">{n(counts.byStatus[s])}</span>
              </Link>
            </li>
          ))}
          <li>
            <Link
              to="/cases?overdue=1"
              className="flex h-full items-center justify-between gap-2 rounded-[10px] border border-danger/30 bg-danger-bg px-3 py-1 text-[13px] font-bold text-danger no-underline hover:brightness-95"
            >
              <span className="inline-flex items-center gap-1">
                <TriangleAlert aria-hidden="true" className="size-3.5" />
                {t('home.pipeline.overdue')}
              </span>{' '}
              <span className="num font-extrabold">{n(counts.overdue)}</span>
            </Link>
          </li>
        </ul>
      </div>
    </section>
  );
}
