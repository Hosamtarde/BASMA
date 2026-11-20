import { parseMoney } from '@app/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import type { Path } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { ApiError } from '@/api/errors';
import { MoneyField, moneyErrorMessage } from '@/components/money-field';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { FormDialog } from '@/components/ui/dialog';
import { FormAlert, TextField } from '@/components/ui/field';
import { Money } from '@/components/ui/table';
import { useCan } from '@/features/auth/permissions';
import { newIdempotencyKey, PAYMENT_METHODS, refreshMoney } from '@/features/payments/api';
import type { PaymentMethod } from '@/features/payments/api';
import { useCurrency } from '@/features/shell/currency';
import { cn } from '@/lib/cn';
import { isIsoDate } from '@/lib/dates';
import { applyServerErrors, msg, rawMsg, renderMessage } from '@/lib/form-messages';
import { caseApi, storeCase } from './api';
import type { CaseDetail, DeliverCase, DeliveryReceived } from './api';
import { DialogButtons, Textarea } from './CaseDialogs';

const RECEIVED: readonly DeliveryReceived[] = ['full', 'partial', 'none'];
const radio =
  'flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg border border-control px-3 py-2 font-bold has-[:checked]:border-navy has-[:checked]:bg-info-bg has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus';

const deliverySchema = (o: { decimals: number; today: string; receivedDate: string; due: number }) =>
  z
    .object({
      deliveredDate: z.string(),
      received: z.union([z.enum(RECEIVED as [DeliveryReceived, ...DeliveryReceived[]]), z.literal('')]),
      amount: z.string(),
      method: z.enum(PAYMENT_METHODS as [PaymentMethod, ...PaymentMethod[]]),
      chequeNo: z.string().trim().max(30, msg('validation.maxLength', { max: 30 })),
      bank: z.string().trim().max(60, msg('validation.maxLength', { max: 60 })),
      dueDate: z.string(),
      collectOn: z.string(),
      note: z.string().trim().max(500, msg('validation.maxLength', { max: 500 })),
    })
    .superRefine((v, ctx) => {
      const add = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
      if (!isIsoDate(v.deliveredDate)) add('deliveredDate', msg('date.invalid'));
      else if (v.deliveredDate > o.today || v.deliveredDate < o.receivedDate) {
        add('deliveredDate', msg('delivery.errors.deliveredDate'));
      }
      if (o.due === 0) return;
      if (v.received === '') return add('received', msg('delivery.errors.receivedRequired'));
      if (v.received === 'partial') {
        const amount = parseMoney(v.amount, o.decimals);
        if (!amount.ok) add('amount', moneyErrorMessage(amount.error, o.decimals));
        else if (amount.minor <= 0) add('amount', msg('payments.errors.amountPositive'));
        else if (amount.minor >= o.due) add('amount', msg('delivery.errors.partialBelowDue'));
      }
      if (v.received !== 'none' && v.method === 'cheque') {
        if (v.chequeNo === '') add('chequeNo', msg('payments.errors.chequeNoRequired'));
        if (v.bank === '') add('bank', msg('payments.errors.bankRequired'));
        if (v.dueDate.trim() === '') add('dueDate', msg('payments.errors.dueRequired'));
        else if (!isIsoDate(v.dueDate)) add('dueDate', msg('date.invalid'));
      }
      if (v.received !== 'full') {
        if (v.collectOn.trim() === '') add('collectOn', msg('delivery.errors.collectOnRequired'));
        else if (!isIsoDate(v.collectOn)) add('collectOn', msg('date.invalid'));
        else if (isIsoDate(v.deliveredDate) && v.collectOn < v.deliveredDate) {
          add('collectOn', msg('delivery.errors.collectOnBeforeDelivery'));
        }
      }
    });
type FormIn = z.input<ReturnType<typeof deliverySchema>>;
type FormOut = z.output<ReturnType<typeof deliverySchema>>;
const FIELDS = ['deliveredDate', 'received', 'amount', 'method', 'chequeNo', 'bank', 'dueDate', 'collectOn', 'note'] as const;

/** Server codes that belong to one field (shown there in the server's words). */
const FIELD_OF: Record<string, Path<FormIn>> = {
  'error.case.delivered_date_invalid': 'deliveredDate',
  'error.delivery.received_required': 'received',
  'error.delivery.amount_required': 'amount',
  'error.delivery.exceeds_remaining': 'amount',
  'error.delivery.partial_equals_due': 'amount',
  'error.delivery.method_required': 'method',
  'error.delivery.collect_on_required': 'collectOn',
  'error.delivery.collect_on_invalid': 'collectOn',
  'error.cheque.duplicate': 'chequeNo',
};

/**
 * «تسليم الحالة» (SPEC §5.7, B5): the only way to deliver a case. What is due at delivery comes from
 * the API (`deliveryDue`: what is unpaid minus the doctor's cheques for this case that have not
 * cleared); a full payment is for exactly that amount and is computed by the server. One
 * Idempotency-Key per attempt when money is taken (the same request again reuses it).
 */
export function DeliveryDialog({
  detail,
  today,
  open,
  onOpenChange,
}: {
  detail: CaseDetail;
  today: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const currency = useCurrency();
  const can = useCan();
  const canPay = can('payments.write');
  const due = detail.deliveryDue ?? 0;
  const money = (minor: number) => `${currency.format(minor)} ${currency.symbol}`;
  const [formError, setFormError] = useState<string | null>(null);
  const attempt = useRef<{ key: string; body: string } | null>(null);
  const receivedId = useId();
  const schema = deliverySchema({ decimals: currency.decimals, today, receivedDate: detail.receivedDate, due });
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema),
    values: {
      deliveredDate: today,
      received: canPay ? '' : 'none',
      amount: '',
      method: 'cash',
      chequeNo: '',
      bank: '',
      dueDate: '',
      collectOn: '',
      note: '',
    },
  });
  const { errors } = form.formState;
  const err = (m: string | undefined) => renderMessage(t, m);
  const received = useWatch({ control: form.control, name: 'received' });
  const method = useWatch({ control: form.control, name: 'method' });
  const deliveredDate = useWatch({ control: form.control, name: 'deliveredDate' });
  const paying = due > 0 && (received === 'full' || received === 'partial');

  const save = useMutation({
    mutationFn: ({ body, key }: { body: DeliverCase; key?: string }) => caseApi.deliver(detail.id, body, key),
    meta: { inlineErrors: true },
    onSuccess: async (result) => {
      attempt.current = null;
      await storeCase(queryClient, result.case);
      if (result.payment) await refreshMoney(queryClient);
      toast.success(
        result.payment
          ? t('delivery.donePaid', {
              no: result.case.caseNo,
              voucher: result.payment.voucherNo,
              balance: money(Math.abs(result.doctorBalance ?? 0)),
            }) + (result.payment.method === 'cheque' ? ` ${t('payments.savedChequeNote')}` : '')
          : t('delivery.done', { no: result.case.caseNo }),
      );
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && FIELD_OF[e.code]) {
        form.setError(FIELD_OF[e.code] as Path<FormIn>, { type: 'server', message: rawMsg(e.message) });
        return;
      }
      setFormError(applyServerErrors(e, form.setError, FIELDS));
    },
  });

  const onValid = (v: FormOut) => {
    setFormError(null);
    const r = due > 0 ? v.received : '';
    const amount = r === 'partial' ? parseMoney(v.amount, currency.decimals) : null;
    const body: DeliverCase = {
      rowVersion: detail.rowVersion,
      deliveredDate: v.deliveredDate,
      ...(v.note ? { note: v.note } : {}),
      ...(r ? { received: r } : {}),
      ...(amount?.ok ? { amount: amount.minor } : {}),
      ...(r === 'full' || r === 'partial'
        ? {
            method: v.method,
            ...(v.method === 'cheque' ? { cheque: { chequeNo: v.chequeNo, bank: v.bank, dueDate: v.dueDate } } : {}),
          }
        : {}),
      ...(r === 'partial' || r === 'none' ? { collectOn: v.collectOn } : {}),
    };
    if (r !== 'full' && r !== 'partial') return save.mutate({ body });
    const json = JSON.stringify(body);
    // Same request again (retry, double click) → same key; a changed request → a new key.
    if (attempt.current?.body !== json) attempt.current = { key: newIdempotencyKey(), body: json };
    save.mutate({ body, key: attempt.current.key });
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          form.reset();
          setFormError(null);
          attempt.current = null;
        }
        onOpenChange(o);
      }}
      title={t('delivery.title', { no: detail.caseNo })}
      description={t('delivery.description', { doctor: detail.doctor.name })}
    >
      <form
        noValidate
        aria-label={t('delivery.title', { no: detail.caseNo })}
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          // Pickers rendered inside this form bubble their submit through React: ours only.
          if (e.target !== e.currentTarget) return;
          void form.handleSubmit(onValid)(e);
        }}
      >
        <FormAlert>{formError}</FormAlert>
        <div className="flex flex-col gap-1 rounded-lg bg-surface px-4 py-3" data-testid="delivery-due">
          {due > 0 ? (
            <p className="flex flex-wrap items-baseline gap-x-2 text-[15px]">
              <span className="font-bold">{t('delivery.due')}</span>
              <span className="text-[17px] font-extrabold">
                <Money value={currency.format(due)} symbol={currency.symbol} />
              </span>
            </p>
          ) : (
            <p className="font-bold text-success-ink">{t('delivery.nothingDue')}</p>
          )}
          {detail.pendingCheques > 0 && (
            <p className="text-[13.5px] text-muted">
              {t('delivery.pendingCheques', { amount: money(detail.pendingCheques) })}
            </p>
          )}
        </div>

        <Controller
          control={form.control}
          name="deliveredDate"
          render={({ field }) => (
            <DateField
              label={t('delivery.deliveredDate')}
              required
              today={today}
              min={detail.receivedDate}
              max={today}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              name={field.name}
              inputRef={field.ref}
              error={err(errors.deliveredDate?.message)}
            />
          )}
        />

        {due > 0 && (
          <fieldset
            className="flex flex-col gap-2"
            aria-describedby={errors.received ? `${receivedId}-error` : undefined}
            aria-invalid={errors.received ? true : undefined}
          >
            <legend className="mb-1.5 text-[14px] font-bold">
              {t('delivery.received')}{' '}
              <span aria-hidden="true" className="text-danger">
                *
              </span>
            </legend>
            {(canPay ? RECEIVED : (['none'] as const)).map((r) => (
              <label key={r} className={radio}>
                <input type="radio" value={r} className="size-4 accent-[var(--color-blue)]" {...form.register('received')} />
                {r === 'full' ? t('delivery.receivedFull', { amount: money(due) }) : t(`delivery.receivedOptions.${r}`)}
              </label>
            ))}
            {!canPay && <p className="text-[13px] text-muted">{t('delivery.noPaymentPermission')}</p>}
            {errors.received && (
              <p id={`${receivedId}-error`} className="text-[13px] font-semibold text-danger">
                {err(errors.received.message)}
              </p>
            )}
          </fieldset>
        )}

        {due > 0 && received === 'partial' && (
          <MoneyField
            label={t('delivery.amount')}
            hint={t('delivery.amountHint', { max: money(due) })}
            symbol={currency.symbol}
            required
            error={err(errors.amount?.message)}
            {...form.register('amount')}
          />
        )}

        {paying && (
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
            {errors.method && <p className="text-[13px] font-semibold text-danger">{err(errors.method.message)}</p>}
          </fieldset>
        )}

        {paying && method === 'cheque' && (
          <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3">
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

        {due > 0 && (received === 'partial' || received === 'none') && (
          <Controller
            control={form.control}
            name="collectOn"
            render={({ field }) => (
              <DateField
                label={t('delivery.collectOn')}
                hint={t('delivery.collectOnHint')}
                required
                today={today}
                min={isIsoDate(deliveredDate) ? deliveredDate : today}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                name={field.name}
                inputRef={field.ref}
                error={err(errors.collectOn?.message)}
              />
            )}
          />
        )}

        <Textarea label={t('delivery.note')} error={err(errors.note?.message)} {...form.register('note')} />
        <DialogButtons busy={save.isPending} submit={t('delivery.submit')} onCancel={() => onOpenChange(false)} />
      </form>
    </FormDialog>
  );
}

const collectSchema = z.object({ collectOn: z.string() });

/** «موعد تحصيل الباقي» of a delivered case: change it or remove it (B5, N2). */
export function CollectOnDialog({
  detail,
  today,
  open,
  onOpenChange,
}: {
  detail: CaseDetail;
  today: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const deliveredDate = detail.deliveredDate ?? today;
  const form = useForm<z.input<typeof collectSchema>, unknown, z.output<typeof collectSchema>>({
    resolver: zodResolver(collectSchema),
    values: { collectOn: detail.collectOn ?? '' },
  });
  const save = useMutation({
    mutationFn: (collectOn: string | null) => caseApi.setCollectOn(detail.id, detail.rowVersion, collectOn),
    meta: { inlineErrors: true },
    onSuccess: async (saved) => {
      await storeCase(queryClient, saved);
      toast.success(t(saved.collectOn ? 'caseDetails.collectDialog.saved' : 'caseDetails.collectDialog.removed'));
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'error.delivery.collect_on_invalid') {
        form.setError('collectOn', { type: 'server', message: rawMsg(e.message) });
        return;
      }
      setFormError(applyServerErrors(e, form.setError, ['collectOn']));
    },
  });
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t('caseDetails.collectDialog.title')}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          if (e.target !== e.currentTarget) return;
          void form.handleSubmit((v) => {
            setFormError(null);
            if (!isIsoDate(v.collectOn)) {
              form.setError('collectOn', { type: 'client', message: msg('date.invalid') });
              return;
            }
            if (v.collectOn < deliveredDate) {
              form.setError('collectOn', { type: 'client', message: msg('delivery.errors.collectOnBeforeDelivery') });
              return;
            }
            save.mutate(v.collectOn);
          })(e);
        }}
      >
        <FormAlert>{formError}</FormAlert>
        <Controller
          control={form.control}
          name="collectOn"
          render={({ field }) => (
            <DateField
              label={t('caseDetails.collectDialog.field')}
              hint={t('caseDetails.collectDialog.hint', { date: deliveredDate })}
              required
              today={today}
              min={deliveredDate}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              name={field.name}
              inputRef={field.ref}
              error={renderMessage(t, form.formState.errors.collectOn?.message)}
            />
          )}
        />
        <div className="flex flex-wrap gap-2.5">
          <DialogButtons busy={save.isPending} submit={t('common.save')} onCancel={() => onOpenChange(false)} />
          {detail.collectOn && (
            <Button variant="secondary" disabled={save.isPending} onClick={() => save.mutate(null)}>
              {t('caseDetails.collectDialog.remove')}
            </Button>
          )}
        </div>
      </form>
    </FormDialog>
  );
}
