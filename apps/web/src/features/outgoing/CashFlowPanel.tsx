import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Spinner } from '@/components/ui/field';
import { useCan } from '@/features/auth/permissions';
import { MoneyCell } from '@/features/payments/parts';
import { cashFlowQuery, OUTGOING_METHODS } from './api';

/**
 * «ملخص النقد للفترة» (SPEC §10): money that moved in and out in the chosen period, by the day it
 * moved (a cheque, the day it cleared), and the net. The period is the page's date range; with no
 * range the server uses the lab month so far, and the panel says which days it really covered.
 */
export function CashFlowPanel({ from, to }: { from: string; to: string }) {
  const { t } = useTranslation();
  const can = useCan();
  const allowed = can('ledger.read') && can('expenses.read');
  const { data, isError, refetch } = useQuery({ ...cashFlowQuery(from, to), enabled: allowed, throwOnError: false });
  if (!allowed) return null;
  if (isError && !data) {
    return (
      <section
        aria-label={t('cashFlow.title')}
        className="mb-4 rounded-[var(--radius-card)] border border-border bg-card px-5 py-4"
      >
        <p role="alert" className="font-semibold text-danger">
          {t('cashFlow.loadError')}
        </p>
        <button type="button" className="mt-2 font-bold text-cyan-ink underline" onClick={() => void refetch()}>
          {t('common.retry')}
        </button>
      </section>
    );
  }
  if (!data) return <Spinner label={t('common.loading')} />;
  return (
    <section
      aria-label={t('cashFlow.title')}
      data-testid="cash-flow"
      className="mb-4 rounded-[var(--radius-card)] border border-border bg-card px-5 py-4"
    >
      <h3 className="mb-1 text-[15px] font-extrabold">{t('cashFlow.title')}</h3>
      <p className="mb-3 text-[13px] text-muted">
        {t('cashFlow.period')}: <span className="num">{data.from}</span> – <span className="num">{data.to}</span>
      </p>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-[14px] sm:grid-cols-3">
        <div>
          <dt className="text-[13px] font-bold text-muted">{t('cashFlow.in')}</dt>
          <dd className="m-0 text-[18px] font-extrabold" data-testid="cash-in">
            <MoneyCell minor={data.in.total} />
          </dd>
          <dd className="m-0 text-[12.5px] text-muted">
            {OUTGOING_METHODS.map((m) => (
              <span key={m} className="me-3 inline-block">
                {t(`payments.methods.${m}`)} <MoneyCell minor={data.in[m]} />
              </span>
            ))}
          </dd>
        </div>
        <div>
          <dt className="text-[13px] font-bold text-muted">{t('cashFlow.out')}</dt>
          <dd className="m-0 text-[18px] font-extrabold" data-testid="cash-out">
            <MoneyCell minor={data.out.total} />
          </dd>
          <dd className="m-0 text-[12.5px] text-muted">
            <span className="me-3 inline-block">
              {t('cashFlow.expenses')} <MoneyCell minor={data.out.expenses} />
            </span>
            <span className="me-3 inline-block">
              {t('cashFlow.refunds')} <MoneyCell minor={data.out.refunds} />
            </span>
          </dd>
          <dd className="m-0 text-[12.5px] text-muted">
            {OUTGOING_METHODS.map((m) => (
              <span key={m} className="me-3 inline-block">
                {t(`payments.methods.${m}`)} <MoneyCell minor={data.out[m]} />
              </span>
            ))}
          </dd>
        </div>
        <div>
          <dt className="text-[13px] font-bold text-muted">{t('cashFlow.net')}</dt>
          <dd className="m-0 text-[18px] font-extrabold" data-testid="cash-net">
            {data.net < 0 && <span aria-hidden="true">−</span>}
            {data.net < 0 && <span className="sr-only">{t('cashFlow.negative')} </span>}
            <MoneyCell minor={Math.abs(data.net)} />
          </dd>
        </div>
      </dl>
    </section>
  );
}
