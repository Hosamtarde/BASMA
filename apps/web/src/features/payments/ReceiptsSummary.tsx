import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Spinner } from '@/components/ui/field';
import { PAYMENT_METHODS, receiptsSummaryQuery } from './api';
import type { ReceiptsParams } from './api';
import { MoneyCell } from './parts';

/**
 * «ملخص المقبوضات» above the receipts table (SPEC §5.8): what counted in the chosen period by method,
 * and the memo lines (cheques not cleared yet, cancelled payments, the last payment). Same filters as
 * the table; the period is read by collection date, which the note says out loud.
 */
export function ReceiptsSummary({ params }: { params: ReceiptsParams }) {
  const { t } = useTranslation();
  const { data, isError } = useQuery(receiptsSummaryQuery(params));
  if (isError && !data) return null;
  if (!data) return <Spinner label={t('common.loading')} />;
  const none = data.counted.count === 0 && data.pendingCheques.count === 0 && data.voided.count === 0;
  return (
    <section
      aria-label={t('receipts.title')}
      data-testid="receipts-summary"
      className="mb-4 rounded-[var(--radius-card)] border border-border bg-card px-5 py-4"
    >
      <h3 className="mb-2 text-[15px] font-extrabold">{t('receipts.title')}</h3>
      {none ? (
        <p className="text-[14px] text-muted">{t('receipts.none')}</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[14px] lg:grid-cols-4">
          <div>
            <dt className="text-[13px] font-bold text-muted">{t('receipts.counted')}</dt>
            <dd className="m-0 text-[20px] font-extrabold" data-testid="receipts-counted">
              <MoneyCell minor={data.counted.amount} />
            </dd>
            <dd className="m-0 text-[13px] text-muted">{t('receipts.count', { count: data.counted.count })}</dd>
          </div>
          {PAYMENT_METHODS.map((m) => (
            <div key={m}>
              <dt className="text-[13px] font-bold text-muted">{t(`payments.methods.${m}`)}</dt>
              <dd className="m-0 font-bold" data-method={m}>
                <MoneyCell minor={data.counted.byMethod[m]} />
              </dd>
            </div>
          ))}
          <div>
            <dt className="text-[13px] font-bold text-muted">{t('receipts.pending')}</dt>
            <dd className="m-0 font-bold">
              <MoneyCell minor={data.pendingCheques.amount} />
            </dd>
            <dd className="m-0 text-[13px] text-muted">{t('receipts.count', { count: data.pendingCheques.count })}</dd>
          </div>
          <div>
            <dt className="text-[13px] font-bold text-muted">{t('receipts.voided')}</dt>
            <dd className="m-0 font-bold">
              <MoneyCell minor={data.voided.amount} />
            </dd>
            <dd className="m-0 text-[13px] text-muted">{t('receipts.count', { count: data.voided.count })}</dd>
          </div>
          {data.last && (
            <div>
              <dt className="text-[13px] font-bold text-muted">{t('receipts.last')}</dt>
              <dd className="m-0 font-bold">
                <span className="num">{data.last.voucherNo}</span> · <MoneyCell minor={data.last.amount} />
              </dd>
              <dd className="num m-0 text-[13px] text-muted">{data.last.paidAt}</dd>
            </div>
          )}
        </dl>
      )}
      <p className="mt-3 text-[12.5px] text-muted">{t('receipts.basis')}</p>
    </section>
  );
}
