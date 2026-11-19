import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Spinner } from '@/components/ui/field';
import { DataTable } from '@/components/ui/list';
import { Td, Th } from '@/components/ui/table';
import { MoneyCell } from '@/features/payments/parts';
import { OUTGOING_METHODS, outgoingSummaryQuery } from './api';
import type { OutgoingFilter } from './api';

/**
 * «تقرير المصاريف» (SPEC §5.9, §10): what counted in the period, per category, by the day the money
 * left (a cheque counts the day it cleared). The refunds to doctors are their own category row and
 * their subtotal is shown apart. Same filters as the table below it; the basis is said out loud.
 */
export function ExpensesSummary({ filter }: { filter: OutgoingFilter }) {
  const { t } = useTranslation();
  const { data, isError, refetch } = useQuery({ ...outgoingSummaryQuery(filter), throwOnError: false });
  if (isError && !data) {
    return (
      <section
        aria-label={t('expenses.title')}
        className="mb-4 rounded-[var(--radius-card)] border border-border bg-card px-5 py-4"
      >
        <p role="alert" className="font-semibold text-danger">
          {t('expenses.loadError')}
        </p>
        <button type="button" className="mt-2 font-bold text-cyan-ink underline" onClick={() => void refetch()}>
          {t('common.retry')}
        </button>
      </section>
    );
  }
  if (!data) return <Spinner label={t('common.loading')} />;
  const none = data.counted.count === 0 && data.pendingCheques.count === 0 && data.voided.count === 0;
  return (
    <section
      aria-label={t('expenses.title')}
      data-testid="expenses-summary"
      className="mb-4 rounded-[var(--radius-card)] border border-border bg-card px-5 py-4"
    >
      <h3 className="mb-2 text-[15px] font-extrabold">{t('expenses.title')}</h3>
      {none ? (
        <p className="text-[14px] text-muted">{t('expenses.none')}</p>
      ) : (
        <>
          <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-3 text-[14px] lg:grid-cols-4">
            <div>
              <dt className="text-[13px] font-bold text-muted">{t('expenses.counted')}</dt>
              <dd className="m-0 text-[20px] font-extrabold" data-testid="expenses-counted">
                <MoneyCell minor={data.counted.amount} />
              </dd>
              <dd className="m-0 text-[13px] text-muted">{t('expenses.count', { count: data.counted.count })}</dd>
            </div>
            {OUTGOING_METHODS.map((m) => (
              <div key={m}>
                <dt className="text-[13px] font-bold text-muted">{t(`payments.methods.${m}`)}</dt>
                <dd className="m-0 font-bold" data-method={m}>
                  <MoneyCell minor={data.counted.byMethod[m]} />
                </dd>
              </div>
            ))}
            <div>
              <dt className="text-[13px] font-bold text-muted">{t('expenses.refunds')}</dt>
              <dd className="m-0 font-bold" data-testid="expenses-refunds">
                <MoneyCell minor={data.refunds} />
              </dd>
            </div>
            <div>
              <dt className="text-[13px] font-bold text-muted">{t('expenses.pending')}</dt>
              <dd className="m-0 font-bold">
                <MoneyCell minor={data.pendingCheques.amount} />
              </dd>
              <dd className="m-0 text-[13px] text-muted">{t('expenses.count', { count: data.pendingCheques.count })}</dd>
            </div>
            <div>
              <dt className="text-[13px] font-bold text-muted">{t('expenses.voided')}</dt>
              <dd className="m-0 font-bold">
                <MoneyCell minor={data.voided.amount} />
              </dd>
              <dd className="m-0 text-[13px] text-muted">{t('expenses.count', { count: data.voided.count })}</dd>
            </div>
            {data.last && (
              <div>
                <dt className="text-[13px] font-bold text-muted">{t('expenses.last')}</dt>
                <dd className="m-0 font-bold">
                  <span className="num">{data.last.voucherNo}</span> · <MoneyCell minor={data.last.amount} />
                </dd>
                <dd className="num m-0 text-[13px] text-muted">{data.last.paidAt}</dd>
              </div>
            )}
          </dl>
          <DataTable
            caption={t('expenses.byCategory')}
            empty={data.byCategory.length === 0}
            emptyText={t('expenses.none')}
            head={
              <>
                <Th>{t('outgoing.category')}</Th>
                <Th kind="number">{t('expenses.countHead')}</Th>
                <Th kind="money">{t('expenses.countedHead')}</Th>
                <Th kind="money">{t('expenses.pendingHead')}</Th>
              </>
            }
          >
            {data.byCategory.map((c) => (
              <tr key={c.categoryId} data-category={c.categoryId}>
                <Td autoDir className="font-bold">
                  {c.name}
                  {c.kind === 'doctor_refund' && (
                    <span className="ms-2 text-[12.5px] font-semibold text-muted">{t('outgoing.kinds.doctor_refund')}</span>
                  )}
                </Td>
                <Td kind="number">{c.count}</Td>
                <Td kind="money" className="font-bold">
                  <MoneyCell minor={c.amount} />
                </Td>
                <Td kind="money">{c.pendingCheques.count > 0 ? <MoneyCell minor={c.pendingCheques.amount} /> : '—'}</Td>
              </tr>
            ))}
          </DataTable>
        </>
      )}
      <p className="mt-3 text-[12.5px] text-muted">{t('expenses.basis')}</p>
    </section>
  );
}
