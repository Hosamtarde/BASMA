import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import type { CaseSummary } from '@/features/cases/api';
import { clickableRow, useRowOpen } from '@/features/cases/CaseActions';
import { StatusBadge } from '@/features/cases/status';
import { currentLanguage } from '@/i18n/i18n';
import { cn } from '@/lib/cn';

/** «آخر الحالات»: the newest cases, each opening its details (link, «فتح» button or the row). */
export function LatestCases({ items }: { items: CaseSummary[] }) {
  const { t } = useTranslation();
  const openRow = useRowOpen();
  const Forward = currentLanguage() === 'ar' ? ChevronLeft : ChevronRight;
  return (
    <>
      <ol className="m-0 list-none p-0">
        {items.map((c) => (
          // Mouse shortcut only: the keyboard path is the case-number link and the Open button.
          // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
          <li
            key={c.id}
            onClick={openRow(c.id)}
            className={cn(
              'grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 rounded-lg border-b border-border px-1.5 py-2 text-[13.5px] last:border-b-0',
              clickableRow,
            )}
          >
            <Link
              to={`/cases/${c.id}`}
              className="num text-start font-extrabold text-ink underline-offset-4 hover:underline"
            >
              {c.caseNo}
            </Link>
            <span className="min-w-0 truncate">
              <span dir="auto" className="font-bold">
                {c.patientName}
              </span>
              <span className="text-muted"> · </span>
              <span dir="auto" className="text-muted">
                {c.doctor.name}
              </span>
            </span>
            <StatusBadge status={c.status} />
            <Button asChild variant="ghost" size="sm" className="text-cyan-ink">
              <Link to={`/cases/${c.id}`} aria-label={t('home.latest.openCase', { no: c.caseNo })}>
                {t('home.latest.open')}
                <Forward aria-hidden="true" />
              </Link>
            </Button>
          </li>
        ))}
      </ol>
      <div className="mt-2 text-end">
        <Link to="/cases" className="text-[13.5px] font-bold text-cyan-ink no-underline hover:underline">
          {t('home.latest.all')}
        </Link>
      </div>
    </>
  );
}
