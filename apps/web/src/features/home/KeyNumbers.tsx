import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { CaseCounts } from '@/features/cases/api';
import { formatNumber } from '@/i18n/format';
import { currentLanguage } from '@/i18n/i18n';

type KeyNumber = 'doctors' | 'cases' | 'ready' | 'overdue';

/**
 * «الأرقام الرئيسية» (direction A): only figures the system really has today, each opening the
 * matching list. Receivables, income, expenses and invoices join with their slices (B3–B6).
 */
export function KeyNumbers({ counts, activeDoctors }: { counts: CaseCounts; activeDoctors?: number }) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const items: { key: KeyNumber; value: number | undefined; to: string }[] = [
    { key: 'doctors', value: activeDoctors, to: '/doctors' },
    { key: 'cases', value: counts.total, to: '/cases' },
    { key: 'ready', value: counts.byStatus.ready, to: '/cases?status=ready' },
    { key: 'overdue', value: counts.overdue, to: '/cases?overdue=1' },
  ];
  return (
    <ul className="m-0 grid list-none grid-cols-2 gap-x-4 gap-y-1 p-0">
      {items.map((i) => (
        <li key={i.key} className="min-w-0">
          <Link
            to={i.to}
            data-key-number={i.key}
            className="flex flex-col border-b border-border py-2 text-ink no-underline hover:bg-hover"
          >
            <span className="text-[13px] text-muted">{t(`home.keyNumbers.${i.key}`)}</span>{' '}
            {i.value === undefined ? (
              <span className="self-start text-[18px] font-extrabold">
                <span aria-hidden="true">–</span>
                <span className="sr-only">{t('common.loading')}</span>
              </span>
            ) : (
              <b className="num self-start text-[18px] font-extrabold">{formatNumber(i.value, lang)}</b>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
