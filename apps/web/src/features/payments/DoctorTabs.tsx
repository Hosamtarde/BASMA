import { useQuery } from '@tanstack/react-query';
import { HandCoins, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOutletContext } from 'react-router';
import type { components } from '@/api/schema.gen';
import { ActionButton } from '@/components/ui/action-button';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Spinner } from '@/components/ui/field';
import { ExportButton } from '@/components/ui/export-button';
import { Card, DataTable, Pager } from '@/components/ui/list';
import { Td, Th } from '@/components/ui/table';
import { useCan } from '@/features/auth/permissions';
import type { Doctor } from '@/features/doctors/api';
import { RefundDialog } from '@/features/outgoing/RefundDialog';
import { settingsQuery } from '@/features/shell/settings';
import { todayIn } from '@/i18n/format';
import { isIsoDate } from '@/lib/dates';
import { useUrlState } from '@/lib/url-state';
import { doctorBalanceQuery, exportApi, paymentsQuery, statementQuery } from './api';
import { PaymentRows, PaymentsHead } from './PaymentsPage';
import { AddPaymentDialog, VoidPaymentDialog } from './PaymentDialogs';
import { BalanceText, MoneyCell } from './parts';
import type { Payment } from './api';

/**
 * The doctor's balance under his name: the number the whole ledger agrees on (SPEC §7.3), the
 * refunds already paid to him, and «استرداد رصيد» (limited to the refundable credit the API reports).
 */
export function DoctorBalanceCard({ doctor }: { doctor: Pick<Doctor, 'id' | 'name'> }) {
  const { t } = useTranslation();
  const can = useCan();
  const { data } = useQuery(doctorBalanceQuery(doctor.id));
  const [refunding, setRefunding] = useState(false);
  const mayRefund = can('expenses.write') && can('ledger.read');
  return (
    <section
      aria-label={t('balance.title')}
      data-testid="doctor-balance"
      className="mb-4 flex flex-wrap items-baseline gap-x-8 gap-y-1 rounded-[var(--radius-card)] border border-border bg-card px-5 py-3"
    >
      <span className="text-[13.5px] font-bold text-muted">{t('balance.title')}</span>
      <span className="text-[20px] font-extrabold">
        {data ? <BalanceText balance={data.balance} direction={data.direction} /> : '—'}
      </span>
      {data && data.pendingCheques > 0 && (
        <span className="text-[13.5px] text-muted">
          {t('balance.pendingCheques', { amount: '' })}
          <MoneyCell minor={data.pendingCheques} />
        </span>
      )}
      {data && data.paidOut > 0 && (
        <span className="text-[13.5px] text-muted" data-testid="balance-paid-out">
          {t('balance.paidOut', { amount: '' })}
          <MoneyCell minor={data.paidOut} />
        </span>
      )}
      {data && data.pendingRefundCheques > 0 && (
        <span className="text-[13.5px] text-muted" data-testid="balance-pending-refunds">
          {t('balance.pendingRefundCheques', { amount: '' })}
          <MoneyCell minor={data.pendingRefundCheques} />
        </span>
      )}
      {mayRefund && (
        <>
          <span className="flex-1" />
          <ActionButton
            variant="secondary"
            size="sm"
            disabled={!data}
            disabledReason={data && data.refundable === 0 ? t('outgoing.noCreditReason') : null}
            onClick={() => setRefunding(true)}
          >
            <HandCoins aria-hidden="true" />
            {t('outgoing.refundAction')}
          </ActionButton>
          {refunding && (
            <RefundDialog open onOpenChange={setRefunding} doctor={{ id: doctor.id, name: doctor.name }} />
          )}
        </>
      )}
    </section>
  );
}

/** «الدفعات» tab of the doctor account: his payments, with a way to add one. */
export function DoctorPaymentsTab() {
  const { t } = useTranslation();
  const doctor = useOutletContext<Doctor>();
  const [page, setPage] = useState(1);
  const { data } = useQuery(paymentsQuery({ search: '', doctorId: doctor.id, page }));
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState<Payment | null>(null);
  if (!data) return <Spinner label={t('common.loading')} />;
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="flex-1 text-[17px] font-extrabold">{t('doctorPayments.title', { name: doctor.name })}</h2>
        <Button onClick={() => setAdding(true)}>
          <Plus aria-hidden="true" />
          {t('doctorPayments.add')}
        </Button>
      </div>
      <DataTable
        caption={t('doctorPayments.title', { name: doctor.name })}
        empty={data.items.length === 0}
        emptyText={t('doctorPayments.empty')}
        head={<PaymentsHead showDoctor={false} withActions />}
      >
        <PaymentRows items={data.items} showDoctor={false} onVoid={setVoiding} />
      </DataTable>
      <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
      <AddPaymentDialog open={adding} onOpenChange={setAdding} doctor={{ id: doctor.id, name: doctor.name }} />
      {voiding && (
        <VoidPaymentDialog
          key={voiding.id}
          payment={data.items.find((p) => p.id === voiding.id) ?? voiding}
          open
          onOpenChange={(o) => !o && setVoiding(null)}
        />
      )}
    </Card>
  );
}

type Range = { from: string; to: string; page: string };
const parseRange = (p: URLSearchParams): Range => ({
  from: p.get('from') ?? '',
  to: p.get('to') ?? '',
  page: p.get('page') ?? '',
});
function serializeRange(r: Range): URLSearchParams {
  const out = new URLSearchParams();
  if (isIsoDate(r.from)) out.set('from', r.from);
  if (isIsoDate(r.to)) out.set('to', r.to);
  if (r.page !== '' && r.page !== '1') out.set('page', r.page);
  return out;
}

/** «كشف الحساب»: cases, cleared payments and bounced cheques with a running balance. */
export function DoctorStatementTab() {
  const { t } = useTranslation();
  const doctor = useOutletContext<Doctor>();
  const { data: settings } = useQuery(settingsQuery);
  const today = todayIn(settings?.labProfile?.timeZone ?? 'UTC');
  const [r, setRange] = useUrlState(parseRange, serializeRange);
  const page = Math.max(1, Number.parseInt(r.page || '1', 10) || 1);
  const from = isIsoDate(r.from) ? r.from : '';
  const to = isIsoDate(r.to) ? r.to : '';
  const { data } = useQuery(statementQuery(doctor.id, from, to, page));
  const update = (patch: Partial<Range>) => setRange((prev) => ({ ...prev, page: '', ...patch }));
  // B4b widened the line kinds (refund, refund_cheque_return); the labels follow the generated type.
  const kind = (k: components['schemas']['StatementResponse']['lines'][number]['kind']) => t(`statement.kinds.${k}`);
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <h2 className="mb-1 flex-1 text-[17px] font-extrabold">{t('statement.title', { name: doctor.name })}</h2>
        <DateField label={t('statement.from')} today={today} value={r.from} onChange={(v) => update({ from: v })} className="w-44" />
        <DateField label={t('statement.to')} today={today} value={r.to} onChange={(v) => update({ to: v })} className="w-44" />
        {(r.from !== '' || r.to !== '') && (
          <Button variant="link" className="h-10" onClick={() => update({ from: '', to: '' })}>
            {t('statement.clearFilters')}
          </Button>
        )}
        <ExportButton
          needs={['ledger.read']}
          label={t('statement.exportLabel')}
          run={() => exportApi.statement(doctor.id, from, to)}
        />
      </div>
      <p className="mb-3 text-[13px] text-muted">{t('statement.note')}</p>
      {!data ? (
        <Spinner label={t('common.loading')} />
      ) : (
        <>
          <dl className="mb-3 flex flex-wrap gap-x-8 gap-y-1 text-[14px]">
            <div className="flex gap-2">
              <dt className="font-bold text-muted">{t('statement.opening')}:</dt>
              <dd className="m-0 font-extrabold" data-testid="statement-opening">
                <MoneyCell minor={data.periodOpening} />
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-bold text-muted">{t('statement.closing')}:</dt>
              <dd className="m-0 font-extrabold" data-testid="statement-closing">
                <MoneyCell minor={data.closing} />
              </dd>
            </div>
          </dl>
          <DataTable
            caption={t('statement.title', { name: doctor.name })}
            empty={data.lines.length === 0}
            emptyText={t('statement.empty')}
            head={
              <>
                <Th kind="number">{t('statement.date')}</Th>
                <Th>{t('statement.type')}</Th>
                <Th kind="number">{t('statement.reference')}</Th>
                <Th>{t('statement.description')}</Th>
                <Th kind="money">{t('statement.debit')}</Th>
                <Th kind="money">{t('statement.credit')}</Th>
                <Th kind="money">{t('statement.balance')}</Th>
              </>
            }
          >
            {data.lines.map((l, i) => (
              <tr key={`${l.kind}-${l.refId}-${i}`}>
                <Td kind="number">{l.date}</Td>
                <Td>{kind(l.kind)}</Td>
                <Td kind="number">{l.voucher ?? l.ref}</Td>
                <Td autoDir className="text-muted">
                  {l.kind === 'case'
                    ? (l.patientName ?? '—')
                    : [l.method ? t(`payments.methods.${l.method}`) : '', l.chequeNo ?? '', l.bank ?? '']
                        .filter((x) => x !== '')
                        .join(' · ')}
                </Td>
                <Td kind="money">{l.debit > 0 ? <MoneyCell minor={l.debit} /> : '—'}</Td>
                <Td kind="money">{l.credit > 0 ? <MoneyCell minor={l.credit} /> : '—'}</Td>
                <Td kind="money" className="font-bold">
                  <MoneyCell minor={l.running} />
                </Td>
              </tr>
            ))}
          </DataTable>
          <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={(p) => setRange((prev) => ({ ...prev, page: String(p) }))} />
        </>
      )}
    </Card>
  );
}
