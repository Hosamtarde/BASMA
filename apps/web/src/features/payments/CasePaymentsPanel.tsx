import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionButton } from '@/components/ui/action-button';
import { DataTable } from '@/components/ui/list';
import { Td, Th } from '@/components/ui/table';
import type { CaseDetail } from '@/features/cases/api';
import { casePaymentsQuery } from './api';
import { AddPaymentDialog } from './PaymentDialogs';
import { MethodCell } from './PaymentsPage';
import { VoucherLink } from '@/features/vouchers/VoucherLink';
import { MoneyCell, PaymentStatusBadge } from './parts';

/** «الدفعات» of a case (SPEC §5.6): paid / remaining from the API and the payments bound to it. */
export function CasePaymentsPanel({ detail }: { detail: CaseDetail }) {
  const { t } = useTranslation();
  const { data } = useQuery(casePaymentsQuery(detail.id));
  const [adding, setAdding] = useState(false);
  const cancelled = detail.status === 'cancelled';
  const hasPending = data?.payments.some((p) => p.status === 'active' && p.cheque?.status === 'pending') ?? false;
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-3 gap-3 text-[14px]" data-testid="case-paid-figures">
        <div>
          <dt className="font-bold text-muted">{t('casePayments.total')}</dt>
          <dd className="m-0 font-extrabold">
            <MoneyCell minor={detail.total} />
          </dd>
        </div>
        <div>
          <dt className="font-bold text-muted">{t('casePayments.paid')}</dt>
          <dd className="m-0 font-extrabold text-success-ink" data-testid="case-paid">
            <MoneyCell minor={detail.paid} />
          </dd>
        </div>
        <div>
          <dt className="font-bold text-muted">{t('casePayments.remaining')}</dt>
          <dd className="m-0 font-extrabold text-warning-ink" data-testid="case-remaining">
            <MoneyCell minor={detail.remaining} />
          </dd>
        </div>
      </dl>
      {cancelled && <p className="text-[13px] font-semibold text-muted">{t('casePayments.creditNote')}</p>}
      {hasPending && <p className="text-[13px] text-muted">{t('casePayments.pendingNote')}</p>}
      <DataTable
        caption={t('casePayments.title')}
        empty={(data?.payments.length ?? 0) === 0}
        emptyText={t('casePayments.none')}
        head={
          <>
            <Th kind="number">{t('casePayments.voucher')}</Th>
            <Th>{t('casePayments.method')}</Th>
            <Th kind="money">{t('casePayments.amount')}</Th>
            <Th>{t('casePayments.status')}</Th>
            <Th kind="actions">
              <span className="sr-only">{t('list.actions')}</span>
            </Th>
          </>
        }
      >
        {data?.payments.map((p) => (
          <tr key={p.id}>
            <Td kind="number" className="font-extrabold">
              {p.voucherNo}
            </Td>
            <Td>
              <MethodCell payment={p} />
            </Td>
            <Td kind="money" className="font-bold">
              <MoneyCell minor={p.amount} />
            </Td>
            <Td>
              <PaymentStatusBadge payment={p} />
            </Td>
            <Td kind="actions">
              <VoucherLink to={`/payments/${p.id}/voucher`} voucherNo={p.voucherNo} />
            </Td>
          </tr>
        ))}
      </DataTable>
      <div>
        <ActionButton
          variant="secondary"
          disabledReason={cancelled ? t('casePayments.addWhy') : null}
          onClick={() => setAdding(true)}
        >
          <Plus aria-hidden="true" />
          {t('casePayments.add')}
        </ActionButton>
      </div>
      <AddPaymentDialog
        open={adding}
        onOpenChange={setAdding}
        doctor={detail.doctor}
        case={{ id: detail.id, caseNo: detail.caseNo }}
      />
    </div>
  );
}
