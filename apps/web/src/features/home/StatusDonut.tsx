import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { CASE_STATUSES } from '@/features/cases/api';
import type { CaseCounts } from '@/features/cases/api';
import { STATUS_STYLE } from '@/features/cases/status';
import { formatNumber } from '@/i18n/format';
import { currentLanguage } from '@/i18n/i18n';
import { cn } from '@/lib/cn';
import { donutArcs, withGaps } from './donut';

// Direction A: a 136 px ring whose hole reaches radius 54 (its mask is 56 % of the distance to
// the box corner, 0.56 × 68√2), so the ring is 14 px thick, centred on radius 61.
const SIZE = 136;
const R = 61;
const STROKE = 14;
const C = 2 * Math.PI * R;
/** White space between neighbouring statuses, along the ring. */
const GAP = 2.5;

/**
 * «بيان عام على جميع الحالات»: our own SVG donut. The picture is one image with a summary name;
 * the legend beside it is the text alternative (every status, its count, a link to the list).
 * The centre stays empty, as in the mockup.
 */
export function StatusDonut({ counts }: { counts: CaseCounts }) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const arcs = withGaps(
    donutArcs(
      CASE_STATUSES.map((s) => ({ key: s, count: counts.byStatus[s] })),
      C,
    ),
    GAP,
  );
  return (
    <div className="flex flex-wrap items-center gap-[18px]">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="size-[136px] shrink-0"
        role="img"
        aria-label={t('home.donut.label', { total: formatNumber(counts.total, lang) })}
      >
        {arcs.length === 0 && (
          // No cases: the bare ring, so the panel keeps its shape.
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            strokeWidth={STROKE}
            className="stroke-border"
          />
        )}
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
      <ul className="m-0 min-w-[136px] flex-1 list-none p-0 text-[13.5px]">
        {CASE_STATUSES.map((s) => (
          <li key={s}>
            <Link
              to={`/cases?status=${s}`}
              className="-mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-[3px] text-ink no-underline hover:bg-hover"
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
