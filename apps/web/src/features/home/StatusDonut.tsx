import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { CASE_STATUSES } from '@/features/cases/api';
import type { CaseCounts } from '@/features/cases/api';
import { STATUS_STYLE } from '@/features/cases/status';
import { formatNumber } from '@/i18n/format';
import { currentLanguage } from '@/i18n/i18n';
import { cn } from '@/lib/cn';
import { donutArcs } from './donut';

// 136 px ring, 56 % hole (direction A): stroke centred between radius 38 and 68.
const SIZE = 136;
const R = 53;
const STROKE = 30;
const C = 2 * Math.PI * R;

/**
 * «بيان عام على جميع الحالات»: our own SVG donut. The picture is one image with a summary name;
 * the legend beside it is the text alternative (every status, its count, a link to the list).
 */
export function StatusDonut({ counts }: { counts: CaseCounts }) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const arcs = donutArcs(
    CASE_STATUSES.map((s) => ({ key: s, count: counts.byStatus[s] })),
    C,
  );
  return (
    <div className="flex flex-wrap items-center gap-[18px]">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="size-[136px] shrink-0"
        role="img"
        aria-label={t('home.donut.label', { total: formatNumber(counts.total, lang) })}
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          strokeWidth={STROKE}
          className="stroke-border"
        />
        {/* Starts at 12 o'clock and runs clockwise in both languages (a chart, not text). */}
        <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
          {arcs.map((a) => (
            <circle
              key={a.key}
              data-status={a.key}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              strokeWidth={STROKE}
              style={{ stroke: `var(--color-st-${a.key})` }}
              strokeDasharray={`${a.length} ${C - a.length}`}
              strokeDashoffset={-a.start}
            />
          ))}
        </g>
      </svg>
      <ul className="m-0 min-w-40 flex-1 list-none p-0 text-[13.5px]">
        {CASE_STATUSES.map((s) => (
          <li key={s}>
            <Link
              to={`/cases?status=${s}`}
              className="flex items-center gap-2 rounded-md py-[3px] text-ink no-underline hover:bg-hover"
            >
              <i aria-hidden="true" className={cn('size-2.5 shrink-0 rounded-[3px]', STATUS_STYLE[s].dot)} />
              <span>{t(`caseStatus.${s}`)}</span>{' '}
              <span className="num ms-auto font-extrabold">{formatNumber(counts.byStatus[s], lang)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
