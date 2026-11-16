import { parseMoney } from '@app/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import type { Path } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { api, unwrap } from '@/api/client';
import { MoneyField, moneyErrorMessage } from '@/components/money-field';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { FormAlert, SelectField, TextField } from '@/components/ui/field';
import { caseKeys } from '@/features/cases/api';
import { DoctorPicker } from '@/features/cases/pickers';
import { useCurrency } from '@/features/shell/currency';
import { settingsQuery } from '@/features/shell/settings';
import { todayIn } from '@/i18n/format';
import { cn } from '@/lib/cn';
import { isIsoDate } from '@/lib/dates';
import { applyServerErrors, msg, renderMessage } from '@/lib/form-messages';
import { doctorBalanceQuery, newIdempotencyKey, PAYMENT_METHODS, paymentApi, refreshMoney } from './api';
import type { CreatePayment, PaymentMethod, PaymentResult } from './api';
import { BalanceText } from './parts';

const ref = z.object({ id: z.number(), name: z.string() });

export const paymentSchema = (decimals: number, today: string) =>
  z
    .object({
      doctor: ref.nullable(),
      amount: z.string(),
      method: z.enum(PAYMENT_METHODS as [PaymentMethod, ...PaymentMethod[]]),
      chequeNo: z.string().trim().max(30, msg('validation.maxLength', { max: 30 })),
      bank: z.string().trim().max(60, msg('validation.maxLength', { max: 60 })),
      dueDate: z.string(),
      paidAt: z.string(),
      caseId: z.string(),
      notes: z.string().trim().max(500, msg('validation.maxLength', { max: 500 })),
    })
    .superRefine((v, ctx) => {
      const add = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
      if (v.doctor === null) add('doctor', msg('validation.required'));
      const amount = parseMoney(v.amount, decimals);
      if (!amount.ok) add('amount', moneyErrorMessage(amount.error, decimals));
      else if (amount.minor <= 0) add('amount', msg('payments.errors.amountPositive'));
      if (!isIsoDate(v.paidAt)) add('paidAt', msg('date.invalid'));
      else if (v.paidAt > today) add('paidAt', msg('payments.errors.dateFuture'));
      if (v.method === 'cheque') {
        if (v.chequeNo === '') add('chequeNo', msg('payments.errors.chequeNoRequired'));
        if (v.bank === '') add('bank', msg('payments.errors.bankRequired'));
        if (v.dueDate.trim() === '') add('dueDate', msg('payments.errors.dueRequired'));
        else if (!isIsoDate(v.dueDate)) add('dueDate', msg('date.invalid'));
      }
    });
export type PaymentFormIn = z.input<ReturnType<typeof paymentSchema>>;
type PaymentFormOut = z.output<ReturnType<typeof paymentSchema>>;

const FIELDS = [
  'doctor',
  'amount',
  'method',
  'chequeNo',
  'bank',
  'dueDate',
  'paidAt',
  'caseId',
  'notes',
] as const satisfies readonly Path<PaymentFormIn>[];

/** Cases of one doctor that can still take a payment (not cancelled). Inside the cases key family. */
const doctorCasesQuery = (doctorId: number) => ({
  queryKey: [...caseKeys.lists, 'payable', doctorId] as const,
  queryFn: async () =>
    (
      await unwrap(
        api.GET('/api/v1/cases', { params: { query: { doctorId, page: 1, pageSize: 100 } } }),
      )
    ).items.filter((c) => c.status !== 'cancelled'),
});

export interface PaymentFormProps {
  /** Fixed doctor (opened from his account or a case): the picker is replaced by his name. */
  doctor?: { id: number; name: string };
  /** Fixed case (opened from the case page). */
  case?: { id: number; caseNo: number };
  onSaved?: (result: PaymentResult) => void;
  /** Optional Cancel button (dialogs). */
  onCancel?: () => void;
}

const radio = 'flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-control px-3 font-bold has-[:checked]:border-navy has-[:checked]:bg-info-bg has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus';

/**
 * «دفعة واردة» (SPEC §5.8). The server decides everything that matters (counted or not, limits,
 * numbering); this form only collects the fields. One Idempotency-Key per attempt: a retry of the
 * same request reuses it, a changed request gets a new one.
 */
export function PaymentForm({ doctor: fixedDoctor, case: fixedCase, onSaved, onCancel }: PaymentFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const currency = useCurrency();
  const { data: settings } = useQuery(settingsQuery);
  const today = todayIn(settings?.labProfile?.timeZone ?? 'UTC');
  const [formError, setFormError] = useState<string | null>(null);
  const attempt = useRef<{ key: string; body: string } | null>(null);

  const defaults = (): PaymentFormIn => ({
    doctor: fixedDoctor ?? null,
    amount: '',
    method: 'cash',
    chequeNo: '',
    bank: '',
    dueDate: '',
    paidAt: today,
    caseId: fixedCase ? String(fixedCase.id) : '',
    notes: '',
  });
  const form = useForm<PaymentFormIn, unknown, PaymentFormOut>({
    resolver: zodResolver(paymentSchema(currency.decimals, today)),
    defaultValues: defaults(),
  });
  const { errors } = form.formState;
  const err = (m: string | undefined) => renderMessage(t, m);
  const doctor = useWatch({ control: form.control, name: 'doctor' });
  const method = useWatch({ control: form.control, name: 'method' });
  const { data: balance } = useQuery({ ...doctorBalanceQuery(doctor?.id ?? 0), enabled: doctor !== null });
  const { data: openCases } = useQuery({
    ...doctorCasesQuery(doctor?.id ?? 0),
    enabled: doctor !== null && !fixedCase,
  });

  const create = useMutation({
    mutationFn: ({ body, key }: { body: CreatePayment; key: string }) => paymentApi.create(body, key),
    meta: { inlineErrors: true },
    onSuccess: async (result) => {
      attempt.current = null;
      await refreshMoney(queryClient);
      const { payment } = result;
      toast.success(
        t('payments.saved', {
          voucher: payment.voucherNo,
          balance: `${currency.format(Math.abs(result.doctorBalance))} ${currency.symbol}`,
        }) + (payment.method === 'cheque' ? ` ${t('payments.savedChequeNote')}` : ''),
      );
      form.reset({ ...defaults(), doctor: form.getValues('doctor') });
      onSaved?.(result);
    },
    onError: (e) => setFormError(applyServerErrors(e, form.setError, FIELDS)),
  });

  const onValid = (v: PaymentFormOut) => {
    setFormError(null);
    const amount = parseMoney(v.amount, currency.decimals);
    if (!amount.ok || v.doctor === null) return;
    const body: CreatePayment = {
      doctorId: v.doctor.id,
      method: v.method,
      amount: amount.minor,
      paidAt: v.paidAt,
      ...(v.caseId ? { caseId: Number(v.caseId) } : {}),
      ...(v.notes ? { notes: v.notes } : {}),
      ...(v.method === 'cheque' ? { cheque: { chequeNo: v.chequeNo, bank: v.bank, dueDate: v.dueDate } } : {}),
    };
    const json = JSON.stringify(body);
    // Same request again (retry, double click) → same key; a changed request → a new key.
    if (attempt.current?.body !== json) attempt.current = { key: newIdempotencyKey(), body: json };
    create.mutate({ body, key: attempt.current.key });
  };

  return (
    <form
      noValidate
      aria-label={t('payments.newTitle')}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        // Dialogs rendered inside this form bubble through React; only our own submit counts.
        if (e.target !== e.currentTarget) return;
        void form.handleSubmit(onValid)(e);
      }}
    >
      <FormAlert>{formError}</FormAlert>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {fixedDoctor ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[14px] font-bold">{t('payments.doctor')}</span>
            <span dir="auto" className="flex h-10 items-center font-extrabold">
              {fixedDoctor.name}
            </span>
          </div>
        ) : (
          <Controller
            control={form.control}
            name="doctor"
            render={({ field }) => (
              <DoctorPicker
                label={t('payments.doctor')}
                quickAdd={false}
                value={field.value}
                onChange={(d) => {
                  field.onChange(d);
                  form.setValue('caseId', '');
                }}
                error={err(errors.doctor?.message)}
              />
            )}
          />
        )}
        <div className="flex flex-col gap-1.5" data-testid="payment-balance">
          <span className="text-[14px] font-bold">{t('payments.currentBalance')}</span>
          <span className="flex h-10 items-center font-extrabold">
            {balance ? <BalanceText balance={balance.balance} direction={balance.direction} /> : '—'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <MoneyField
          label={t('payments.amount')}
          symbol={currency.symbol}
          required
          error={err(errors.amount?.message)}
          {...form.register('amount')}
        />
        <Controller
          control={form.control}
          name="paidAt"
          render={({ field }) => (
            <DateField
              label={t('payments.paidAt')}
              required
              today={today}
              max={today}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              name={field.name}
              inputRef={field.ref}
              error={err(errors.paidAt?.message)}
            />
          )}
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-[14px] font-bold">{t('payments.method')}</legend>
        <div className="flex flex-wrap gap-2">
          {PAYMENT_METHODS.map((m) => (
            <label key={m} className={cn(radio)}>
              <input type="radio" value={m} className="size-4 accent-[var(--color-blue)]" {...form.register('method')} />
              {t(`payments.methods.${m}`)}
            </label>
          ))}
        </div>
      </fieldset>

      {method === 'cheque' && (
        <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-4 md:grid-cols-3">
          <TextField
            label={t('payments.chequeNo')}
            required
            dir="ltr"
            autoComplete="off"
            error={err(errors.chequeNo?.message)}
            {...form.register('chequeNo')}
          />
          <TextField
            label={t('payments.bank')}
            required
            dir="auto"
            autoComplete="off"
            error={err(errors.bank?.message)}
            {...form.register('bank')}
          />
          <Controller
            control={form.control}
            name="dueDate"
            render={({ field }) => (
              <DateField
                label={t('payments.dueDate')}
                required
                today={today}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                name={field.name}
                inputRef={field.ref}
                error={err(errors.dueDate?.message)}
              />
            )}
          />
        </div>
      )}

      {fixedCase ? (
        <p className="text-[14px] font-bold">
          {t('payments.caseLabel')}: <span className="num">{fixedCase.caseNo}</span>
        </p>
      ) : (
        <SelectField label={t('payments.caseLabel')} disabled={doctor === null} {...form.register('caseId')}>
          <option value="">{t('payments.noCase')}</option>
          {(openCases ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {t('payments.caseOption', {
                no: c.caseNo,
                patient: c.patientName,
                total: `${currency.format(c.total)} ${currency.symbol}`,
              })}
            </option>
          ))}
        </SelectField>
      )}

      <TextField label={t('payments.notes')} dir="auto" autoComplete="off" error={err(errors.notes?.message)} {...form.register('notes')} />

      <div className="flex gap-2.5">
        <Button type="submit" disabled={create.isPending} className="min-w-32">
          {create.isPending ? t('common.saving') : t('payments.submit')}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}
