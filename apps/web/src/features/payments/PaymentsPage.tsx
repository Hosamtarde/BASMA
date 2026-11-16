import { useQuery } from '@tanstack/react-query';
import { Ban } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ActionButton } from '@/components/ui/action-button';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { ExportButton } from '@/components/ui/export-button';
import { Card, DataTable, PageHeader, Pager, SearchBox } from '@/components/ui/list';
import { Td, Th } from '@/components/ui/table';
import { DoctorPicker } from '@/features/cases/pickers';
import { doctorQuery } from '@/features/doctors/api';
import { settingsQuery } from '@/features/shell/settings';
import { todayIn } from '@/i18n/format';
import { cn } from '@/lib/cn';
import { isIsoDate } from '@/lib/dates';
import { useUrlState } from '@/lib/url-state';
import { exportApi, PAYMENT_METHODS, paymentsQuery } from './api';
import type { Payment, PaymentListParams, PaymentMethod } from './api';
import { PaymentForm } from './PaymentForm';
import { VoidPaymentDialog } from './PaymentDialogs';
import { MoneyCell, PaymentStatusBadge } from './parts';
import { ReceiptsSummary } from './ReceiptsSummary';

type Key = 'q' | 'doctor' | 'method' | 'status' | 'from' | 'to' | 'page';
type Filters = Record<Key, string>;
type Patch = Partial<Record<Key, string | undefined>>;
const KEYS: Key[] = ['q', 'doctor', 'method', 'status', 'from', 'to', 'page'];
const parseFilters = (p: URLSearchParams): Filters =>
  Object.fromEntries(KEYS.map((k) => [k, p.get(k) ?? ''])) as Filters;

/** Only complete values reach the address: a half-typed date stays in the box. */
function serializeFilters(f: Filters): URLSearchParams {
  const out = new URLSearchParams();
  for (const k of KEYS) {
    const v = f[k].trim();
    if (v === '' || (k === 'page' && v === '1')) continue;
    if ((k === 'from' || k === 'to') && !isIsoDate(v)) continue;
    out.set(k, v);
  }
  return out;
}

/** The report filters live in the URL (useUrlState), like the cases list. */
export function usePaymentListParams() {
  const [f, setFilters] = useUrlState(parseFilters, serializeFilters);
  const doctorId = Number.parseInt(f.doctor, 10);
  const list: PaymentListParams = {
    search: f.q,
    doctorId: Number.isSafeInteger(doctorId) && doctorId > 0 ? doctorId : undefined,
    method: PAYMENT_METHODS.includes(f.method as PaymentMethod) ? (f.method as PaymentMethod) : undefined,
    status: f.status === 'active' || f.status === 'void' ? (f.status) : undefined,
    from: isIsoDate(f.from) ? f.from : undefined,
    to: isIsoDate(f.to) ? f.to : undefined,
    page: Math.max(1, Number.parseInt(f.page || '1', 10) || 1),
  };
  const update = (patch: Patch) =>
    setFilters((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(patch) as [Key, string | undefined][]) next[k] = v ?? '';
      if (!('page' in patch)) next.page = '';
      return next;
    });
  const clear = () => setFilters(() => parseFilters(new URLSearchParams()));
  return { list, from: f.from, to: f.to, update, clear };
}

/** A payment row's description of what it is: method and, for a cheque, its number and bank. */
export function MethodCell({ payment }: { payment: Payment }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col">
      <span>{t(`payments.methods.${payment.method}`)}</span>
      {payment.cheque && (
        <span className="text-[12.5px] text-muted">
          <span dir="auto">
            {t('payments.chequeInfo', { no: payment.cheque.chequeNo, bank: payment.cheque.bank })}
          </span>
        </span>
      )}
    </div>
  );
}

/** Rows shared by the payments report, the doctor's tab and the case panel. */
export function PaymentRows({
  items,
  showDoctor,
  onVoid,
}: {
  items: Payment[];
  showDoctor: boolean;
  onVoid?: (p: Payment) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {items.map((p) => (
        <tr key={p.id} data-payment={p.voucherNo} className={cn(p.status === 'void' && 'text-muted')}>
          <Td kind="number" className={cn('font-extrabold', p.status === 'void' && 'line-through')}>
            {p.voucherNo}
          </Td>
          <Td kind="number">{p.paidAt}</Td>
          {showDoctor && (
            <Td autoDir>
              <Link to={`/doctors/${p.doctor.id}`} className="text-ink underline-offset-4 hover:underline">
                {p.doctor.name}
              </Link>
            </Td>
          )}
          <Td>
            <MethodCell payment={p} />
          </Td>
          <Td kind="number">
            {p.case ? (
              <Link to={`/cases/${p.case.id}`} className="num text-ink underline-offset-4 hover:underline">
                {p.case.caseNo}
              </Link>
            ) : (
              '—'
            )}
          </Td>
          <Td kind="money" className={cn('font-bold', p.status === 'void' && 'line-through')}>
            <MoneyCell minor={p.amount} />
          </Td>
          <Td>
            <div className="flex flex-col items-start gap-1">
              <PaymentStatusBadge payment={p} />
              {p.status === 'active' && !p.counted && (
                <span className="text-[12.5px] text-muted">{t('payments.countedNo')}</span>
              )}
              {p.status === 'void' && p.voidReason && (
                <span dir="auto" className="text-[12.5px]">
                  {t('payments.voidedReason', { reason: p.voidReason })}
                </span>
              )}
            </div>
          </Td>
          {onVoid && (
            <Td kind="actions">
              <ActionButton
                variant="ghost"
                size="sm"
                aria-label={`${t('payments.void')} ${p.voucherNo}`}
                disabledReason={p.status === 'void' ? t('payments.voidWhy') : null}
                onClick={() => onVoid(p)}
              >
                <Ban aria-hidden="true" />
              </ActionButton>
            </Td>
          )}
        </tr>
      ))}
    </>
  );
}

export function PaymentsHead({ showDoctor, withActions }: { showDoctor: boolean; withActions: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <Th kind="number">{t('payments.voucher')}</Th>
      <Th kind="number">{t('payments.date')}</Th>
      {showDoctor && <Th>{t('payments.doctor')}</Th>}
      <Th>{t('payments.method')}</Th>
      <Th kind="number">{t('payments.case')}</Th>
      <Th kind="money">{t('payments.amount')}</Th>
      <Th>{t('payments.status')}</Th>
      {withActions && (
        <Th kind="actions">
          <span className="sr-only">{t('list.actions')}</span>
        </Th>
      )}
    </>
  );
}

/** «دفعة واردة» (SPEC §5.8): the form on top, «تقرير المقبوضات» below with filters, totals and voiding. */
export function PaymentsPage() {
  const { t } = useTranslation();
  const { data: settings } = useQuery(settingsQuery);
  const today = todayIn(settings?.labProfile?.timeZone ?? 'UTC');
  const { list, from, to, update, clear } = usePaymentListParams();
  const { data } = useQuery(paymentsQuery(list));
  const { data: doctor } = useQuery({ ...doctorQuery(list.doctorId ?? 0), enabled: list.doctorId !== undefined });
  const [voiding, setVoiding] = useState<Payment | null>(null);
  const filtered = list.search !== '' || list.doctorId || list.method || list.status || from !== '' || to !== '';

  return (
    <>
      <PageHeader title={t('payments.title')} intro={t('payments.intro')} />
      <Card className="mb-5">
        <h2 className="mb-4 text-[17px] font-extrabold">{t('payments.newTitle')}</h2>
        <PaymentForm />
      </Card>

      <h2 className="mb-2 text-[17px] font-extrabold">{t('payments.reportTitle')}</h2>
      <Card className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <SearchBox value={list.search} onChange={(q) => update({ q })} label={t('payments.search')} />
          <DoctorPicker
            label={t('payments.doctorFilter')}
            emptyLabel={t('payments.allDoctors')}
            required={false}
            quickAdd={false}
            className="w-56"
            value={list.doctorId ? { id: list.doctorId, name: doctor?.name ?? '' } : null}
            onChange={(d) => update({ doctor: d ? String(d.id) : undefined })}
          />
          <FilterSelect
            label={t('payments.methodFilter')}
            value={list.method ?? ''}
            onChange={(v) => update({ method: v || undefined })}
            options={[
              ['', t('payments.allMethods')],
              ...PAYMENT_METHODS.map((m): [string, string] => [m, t(`payments.methods.${m}`)]),
            ]}
          />
          <FilterSelect
            label={t('payments.statusFilter')}
            value={list.status ?? ''}
            onChange={(v) => update({ status: v || undefined })}
            options={[
              ['', t('payments.allStatuses')],
              ['active', t('payments.statusActive')],
              ['void', t('payments.statusVoid')],
            ]}
          />
          <DateField label={t('payments.from')} today={today} value={from} onChange={(v) => update({ from: v })} className="w-44" />
          <DateField label={t('payments.to')} today={today} value={to} onChange={(v) => update({ to: v })} className="w-44" />
          {filtered && (
            <Button variant="link" className="h-10" onClick={clear}>
              {t('payments.clearFilters')}
            </Button>
          )}
          <ExportButton
            className="ms-auto"
            needs={['payments.read']}
            run={() => exportApi.payments(list)}
            disabledReason={data && data.total === 0 ? t('export.nothing') : null}
          />
        </div>
        {data && (
          <p className="flex flex-wrap gap-x-6 gap-y-1 text-[14px]" data-testid="payment-totals">
            <span>
              <span className="text-muted">{t('payments.totalCounted')}: </span>
              <b>
                <MoneyCell minor={data.totals.counted} />
              </b>
            </span>
            <span>
              <span className="text-muted">{t('payments.totalPending')}: </span>
              <b>
                <MoneyCell minor={data.totals.pendingCheques} />
              </b>
            </span>
          </p>
        )}
      </Card>
      <ReceiptsSummary params={{ search: list.search, doctorId: list.doctorId, method: list.method, from: list.from, to: list.to }} />
      <Card className="px-3 py-2">
        <DataTable
          caption={t('payments.reportTitle')}
          empty={(data?.items.length ?? 0) === 0}
          emptyText={filtered ? t('list.noResults') : t('payments.empty')}
          head={<PaymentsHead showDoctor withActions />}
        >
          <PaymentRows items={data?.items ?? []} showDoctor onVoid={setVoiding} />
        </DataTable>
        {data && <Pager page={list.page} pageSize={data.pageSize} total={data.total} onPage={(page) => update({ page: String(page) })} />}
      </Card>
      {voiding && (
        <VoidPaymentDialog
          key={voiding.id}
          payment={data?.items.find((p) => p.id === voiding.id) ?? voiding}
          open
          onOpenChange={(o) => !o && setVoiding(null)}
        />
      )}
    </>
  );
}

/** A labelled native select for filters (keyboard and screen-reader friendly, URL driven). */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[14px] font-bold">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 rounded-[var(--radius-control)] border border-control bg-card px-3 pe-8"
      >
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}
