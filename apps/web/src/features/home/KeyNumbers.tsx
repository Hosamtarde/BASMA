import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { CaseCounts } from '@/features/cases/api';
import type { components } from '@/api/schema.gen';
import { useCurrency } from '@/features/shell/currency';
import { formatNumber } from '@/i18n/format';
import { currentLanguage } from '@/i18n/i18n';

type KeyNumber = 'doctors' | 'cases' | 'ready' | 'overdue' | 'income' | 'expenses' | 'owed' | 'chequesPending';
type LedgerSummary = components['schemas']['LedgerSummaryResponse'];

/**
 * «الأرقام الرئيسية» (direction A): only figures the system really has today, each opening the
 * matching list. Receivables, income, expenses and invoices join with their slices (B3–B6).
 */
export function KeyNumbers({
  counts,
  activeDoctors,
  ledger,
}: {
  counts: CaseCounts;
  activeDoctors?: number;
  ledger?: LedgerSummary | undefined;
}) {
  const currency = useCurrency();
  const money = (minor: number | undefined) =>
    minor === undefined ? undefined : `${currency.format(minor)} ${currency.symbol}`;
  const { t } = useTranslation();
  const lang = currentLanguage();
  const count = (n: number | undefined) => (n === undefined ? undefined : formatNumber(n, lang));
  const items: { key: KeyNumber; value: string | undefined; to: string }[] = [
    { key: 'doctors', value: count(activeDoctors), to: '/doctors' },
    { key: 'cases', value: count(counts.total), to: '/cases' },
    { key: 'ready', value: count(counts.byStatus.ready), to: '/cases?status=ready' },
    { key: 'overdue', value: count(counts.overdue), to: '/cases?overdue=1' },
    { key: 'income', value: money(ledger?.receivedThisMonth), to: '/payments' },
    // Absent (null) for a user who may not read expenses: the line is left out, not shown as zero.
    ...(ledger?.outgoingThisMonth === null
      ? []
      : [{ key: 'expenses' as const, value: money(ledger?.outgoingThisMonth), to: '/outgoing' }]),
    { key: 'owed', value: money(ledger?.owedToLab), to: '/debts' },
    { key: 'chequesPending', value: count(ledger?.pendingChequesCount), to: '/cheques?status=pending' },
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
              <b className="num self-start text-[18px] font-extrabold">{i.value}</b>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
