import { parseMoney } from '@app/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import type { Path } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { MoneyField, moneyErrorMessage } from '@/components/money-field';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { FormAlert, SelectField, TextField } from '@/components/ui/field';
import { DoctorPicker } from '@/features/cases/pickers';
import { doctorBalanceQuery, newIdempotencyKey, refreshMoney } from '@/features/payments/api';
import { useCurrency } from '@/features/shell/currency';
import { settingsQuery } from '@/features/shell/settings';
import { todayIn } from '@/i18n/format';
import { cn } from '@/lib/cn';
import { isIsoDate } from '@/lib/dates';
import { applyServerErrors, msg, renderMessage } from '@/lib/form-messages';
import { outgoingApi, outgoingCategoriesQuery, OUTGOING_METHODS } from './api';
import type { CreateOutgoing, OutgoingMethod, OutgoingResult } from './api';

const ref = z.object({ id: z.number(), name: z.string() });

interface SchemaContext {
  decimals: number;
  today: string;
  /** The chosen category is the doctor-refund category (its `isDoctor` flag, from the API). */
  isRefund: (categoryId: string) => boolean;
  /** What the API says may be refunded to the chosen doctor now; null while unknown. */
  refundable: number | null;
  /** Formats a minor-unit amount with the currency sign (for the limit message). */
  format: (minor: number) => string;
}

export const outgoingSchema = (c: SchemaContext) =>
  z
    .object({
      categoryId: z.string(),
      payee: z.string().trim().max(100, msg('validation.maxLength', { max: 100 })),
      doctor: ref.nullable(),
      amount: z.string(),
      method: z.enum(OUTGOING_METHODS as [OutgoingMethod, ...OutgoingMethod[]]),
      chequeNo: z.string().trim().max(30, msg('validation.maxLength', { max: 30 })),
      bank: z.string().trim().max(60, msg('validation.maxLength', { max: 60 })),
      dueDate: z.string(),
      paidAt: z.string(),
      notes: z.string().trim().max(500, msg('validation.maxLength', { max: 500 })),
    })
    .superRefine((v, ctx) => {
      const add = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
      if (v.categoryId === '') add('categoryId', msg('validation.required'));
      const refund = v.categoryId !== '' && c.isRefund(v.categoryId);
      if (refund) {
        if (v.doctor === null) add('doctor', msg('validation.required'));
      } else if (v.categoryId !== '' && v.payee === '') {
        add('payee', msg('outgoing.errors.payeeRequired'));
      }
      const amount = parseMoney(v.amount, c.decimals);
      if (!amount.ok) add('amount', moneyErrorMessage(amount.error, c.decimals));
      else if (amount.minor <= 0) add('amount', msg('payments.errors.amountPositive'));
      else if (refund && v.doctor !== null && c.refundable !== null) {
        // Guidance only: the server checks the limit again under its own locks.
        if (c.refundable === 0) add('amount', msg('outgoing.errors.noCredit'));
        else if (amount.minor > c.refundable) {
          add('amount', msg('outgoing.errors.refundExceeds', { max: c.format(c.refundable) }));
        }
      }
      if (!isIsoDate(v.paidAt)) add('paidAt', msg('date.invalid'));
      else if (v.paidAt > c.today) add('paidAt', msg('payments.errors.dateFuture'));
      if (v.method === 'cheque') {
        if (v.chequeNo === '') add('chequeNo', msg('payments.errors.chequeNoRequired'));
        if (v.bank === '') add('bank', msg('payments.errors.bankRequired'));
        // A post-dated cheque is normal: the due date may be later than today.
        if (v.dueDate.trim() === '') add('dueDate', msg('payments.errors.dueRequired'));
        else if (!isIsoDate(v.dueDate)) add('dueDate', msg('date.invalid'));
      }
    });
export type OutgoingFormIn = z.input<ReturnType<typeof outgoingSchema>>;
type OutgoingFormOut = z.output<ReturnType<typeof outgoingSchema>>;

const FIELDS = [
  'categoryId',
  'payee',
  'doctor',
  'amount',
  'method',
  'chequeNo',
  'bank',
  'dueDate',
  'paidAt',
  'notes',
] as const satisfies readonly Path<OutgoingFormIn>[];

export interface OutgoingFormProps {
  /**
   * Opened from a doctor's page: the refund category and this doctor are fixed (the picker and the
   * category box are replaced by their names).
   */
  refundDoctor?: { id: number; name: string };
  onSaved?: (result: OutgoingResult) => void;
  /** Optional Cancel button (dialogs). */
  onCancel?: () => void;
}

const radio =
  'flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-control px-3 font-bold has-[:checked]:border-navy has-[:checked]:bg-info-bg has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus';

/**
 * «إنشاء دفعة صادرة» (SPEC §5.9). The category decides the party: an expense names a payee (free
 * text), the doctor-refund category names a doctor and shows his refundable credit. The server
 * decides everything that matters (counted or not, the refund limit, numbering); this form only
 * collects fields. One Idempotency-Key per attempt, like the incoming form.
 */
export function OutgoingForm({ refundDoctor, onSaved, onCancel }: OutgoingFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const currency = useCurrency();
  const { data: settings } = useQuery(settingsQuery);
  const { data: categories } = useQuery(outgoingCategoriesQuery);
  const today = todayIn(settings?.labProfile?.timeZone ?? 'UTC');
  const [formError, setFormError] = useState<string | null>(null);
  const attempt = useRef<{ key: string; body: string } | null>(null);

  const refundCategory = categories?.find((c) => c.isDoctor);
  const defaults = (): OutgoingFormIn => ({
    categoryId: refundDoctor && refundCategory ? String(refundCategory.id) : '',
    payee: '',
    doctor: refundDoctor ?? null,
    amount: '',
    method: 'cash',
    chequeNo: '',
    bank: '',
    dueDate: '',
    paidAt: today,
    notes: '',
  });
  const isRefund = (id: string) => categories?.find((c) => String(c.id) === id)?.isDoctor === true;

  // The doctor (and so the refundable credit) can be known before the schema is built.
  const [chosenDoctor, setChosenDoctor] = useState<number | null>(refundDoctor?.id ?? null);
  const { data: balance } = useQuery({ ...doctorBalanceQuery(chosenDoctor ?? 0), enabled: chosenDoctor !== null });

  const form = useForm<OutgoingFormIn, unknown, OutgoingFormOut>({
    resolver: zodResolver(
      outgoingSchema({
        decimals: currency.decimals,
        today,
        isRefund,
        refundable: balance?.refundable ?? null,
        format: (m) => `${currency.format(m)} ${currency.symbol}`,
      }),
    ),
    defaultValues: defaults(),
  });
  const { errors } = form.formState;
  const err = (m: string | undefined) => renderMessage(t, m);
  const categoryId = useWatch({ control: form.control, name: 'categoryId' });
  const method = useWatch({ control: form.control, name: 'method' });
  const refund = refundDoctor !== undefined || isRefund(categoryId);
  // In the doctor's dialog the category is fixed: set it as soon as the categories arrive.
  useEffect(() => {
    if (refundDoctor && refundCategory && form.getValues('categoryId') === '') {
      form.setValue('categoryId', String(refundCategory.id));
    }
  }, [form, refundDoctor, refundCategory]);

  const create = useMutation({
    mutationFn: ({ body, key }: { body: CreateOutgoing; key: string }) => outgoingApi.create(body, key),
    meta: { inlineErrors: true },
    onSuccess: async (result) => {
      attempt.current = null;
      await refreshMoney(queryClient);
      const { payment } = result;
      toast.success(
        result.doctorBalance === null
          ? t('outgoing.saved', { voucher: payment.voucherNo })
          : t('outgoing.savedRefund', {
              voucher: payment.voucherNo,
              balance: `${currency.format(Math.abs(result.doctorBalance))} ${currency.symbol}`,
            }),
      );
      // The dialog of a doctor keeps its fixed category and doctor; the page starts blank again.
      form.reset({ ...defaults(), categoryId: refundDoctor ? form.getValues('categoryId') : '' });
      if (!refundDoctor) setChosenDoctor(null);
      onSaved?.(result);
    },
    onError: (e) => setFormError(applyServerErrors(e, form.setError, FIELDS)),
  });

  const onValid = (v: OutgoingFormOut) => {
    setFormError(null);
    const amount = parseMoney(v.amount, currency.decimals);
    if (!amount.ok) return;
    const body: CreateOutgoing = {
      categoryId: Number(v.categoryId),
      method: v.method,
      amount: amount.minor,
      paidAt: v.paidAt,
      ...(refund ? { doctorId: v.doctor?.id ?? 0 } : { payee: v.payee }),
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
      aria-label={t('outgoing.newTitle')}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        // Dialogs rendered inside this form bubble through React; only our own submit counts.
        if (e.target !== e.currentTarget) return;
        void form.handleSubmit(onValid)(e);
      }}
    >
      <FormAlert>{formError}</FormAlert>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {refundDoctor ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[14px] font-bold">{t('outgoing.category')}</span>
            <span className="flex h-10 items-center font-extrabold">{refundCategory?.name ?? '—'}</span>
          </div>
        ) : (
          <SelectField
            label={t('outgoing.category')}
            required
            error={err(errors.categoryId?.message)}
            {...form.register('categoryId', {
              onChange: () => {
                form.setValue('payee', '');
                if (!refundDoctor) {
                  form.setValue('doctor', null);
                  setChosenDoctor(null);
                }
              },
            })}
          >
            <option value="">{t('outgoing.pickCategory')}</option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
        )}

        {refund ? (
          refundDoctor ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-[14px] font-bold">{t('outgoing.doctor')}</span>
              <span dir="auto" className="flex h-10 items-center font-extrabold">
                {refundDoctor.name}
              </span>
            </div>
          ) : (
            <Controller
              control={form.control}
              name="doctor"
              render={({ field }) => (
                <DoctorPicker
                  label={t('outgoing.doctor')}
                  quickAdd={false}
                  value={field.value}
                  onChange={(d) => {
                    field.onChange(d);
                    setChosenDoctor(d?.id ?? null);
                  }}
                  error={err(errors.doctor?.message)}
                />
              )}
            />
          )
        ) : (
          <TextField
            label={t('outgoing.payee')}
            required
            dir="auto"
            autoComplete="off"
            hint={t('outgoing.payeeHint')}
            error={err(errors.payee?.message)}
            {...form.register('payee')}
          />
        )}
      </div>

      {refund && (
        <p
          role="status"
          data-testid="outgoing-refundable"
          className="rounded-lg bg-surface px-3 py-2 text-[14px]"
        >
          <span className="font-bold text-muted">{t('outgoing.refundable')}: </span>
          {balance ? (
            <>
              <b>
                {currency.format(balance.refundable)} {currency.symbol}
              </b>
              {balance.refundable === 0 && <span className="ms-2 font-semibold">{t('outgoing.errors.noCredit')}</span>}
              {balance.pendingRefundCheques > 0 && (
                <span className="ms-2 text-muted">
                  {t('outgoing.reserved', { amount: `${currency.format(balance.pendingRefundCheques)} ${currency.symbol}` })}
                </span>
              )}
            </>
          ) : (
            <span className="text-muted">{chosenDoctor === null ? t('outgoing.pickDoctorFirst') : '—'}</span>
          )}
        </p>
      )}

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
              label={t('outgoing.paidAt')}
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
          {OUTGOING_METHODS.map((m) => (
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
            label={t('outgoing.labBank')}
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
                hint={t('outgoing.dueHint')}
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

      <TextField label={t('payments.notes')} dir="auto" autoComplete="off" error={err(errors.notes?.message)} {...form.register('notes')} />

      <div className="flex gap-2.5">
        <Button type="submit" disabled={create.isPending} className="min-w-32">
          {create.isPending ? t('common.saving') : t('outgoing.submit')}
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
