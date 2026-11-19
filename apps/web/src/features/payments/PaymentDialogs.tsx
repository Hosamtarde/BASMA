import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ApiError } from '@/api/errors';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { FormDialog } from '@/components/ui/dialog';
import { FormAlert, SelectField } from '@/components/ui/field';
import { useQuery } from '@tanstack/react-query';
import { outgoingApi } from '@/features/outgoing/api';
import { settingsQuery } from '@/features/shell/settings';
import { todayIn } from '@/i18n/format';
import { isIsoDate } from '@/lib/dates';
import { paymentApi, refreshMoney } from './api';
import type { Cheque, ChequeDirection, ChequeStatus, Payment } from './api';
import { PaymentForm } from './PaymentForm';

/** The payment form in a dialog, with the doctor (and case) fixed when opened from their pages. */
export function AddPaymentDialog({
  open,
  onOpenChange,
  doctor,
  case: linkedCase,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  doctor: { id: number; name: string };
  case?: { id: number; caseNo: number };
}) {
  const { t } = useTranslation();
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={linkedCase ? t('payments.forCase', { no: linkedCase.caseNo }) : t('payments.forDoctor', { name: doctor.name })}
    >
      <PaymentForm
        doctor={doctor}
        {...(linkedCase ? { case: linkedCase } : {})}
        onSaved={() => onOpenChange(false)}
        onCancel={() => onOpenChange(false)}
      />
    </FormDialog>
  );
}

export function ReasonBox({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-1 text-[14px] font-bold">
        <label htmlFor={id}>{label}</label>
        <span aria-hidden="true" className="text-danger">
          *
        </span>
      </div>
      <textarea
        id={id}
        dir="auto"
        rows={3}
        required
        aria-required="true"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-control bg-card px-3 py-2 outline-none placeholder:text-muted focus-visible:outline-2 focus-visible:outline-focus aria-[invalid=true]:border-danger"
      />
      {error && (
        <p id={`${id}-error`} className="text-[13px] font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * «إلغاء دفعة» (SPEC §5.10): a reason is required; the payment stays in the records. Incoming and
 * outgoing payments share the dialog; `direction` picks the endpoint and the explanation.
 */
export function VoidPaymentDialog({
  payment,
  direction = 'in',
  open,
  onOpenChange,
}: {
  payment: Pick<Payment, 'id' | 'voucherNo' | 'rowVersion'>;
  direction?: ChequeDirection;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async (): Promise<void> => {
      // The two answers differ in shape; the dialog needs neither (it refreshes from the server).
      if (direction === 'out') await outgoingApi.void(payment.id, payment.rowVersion, reason.trim());
      else await paymentApi.void(payment.id, payment.rowVersion, reason.trim());
    },
    meta: { inlineErrors: true },
    onSuccess: async () => {
      await refreshMoney(queryClient);
      toast.success(t('payments.voidDone', { voucher: payment.voucherNo }));
      setReason('');
      onOpenChange(false);
    },
    onError: (e) => setFormError(e instanceof ApiError ? e.message : null),
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('payments.voidTitle', { voucher: payment.voucherNo })}
      description={direction === 'out' ? t('outgoing.voidBody') : t('payments.voidBody')}
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim() === '') {
            setFieldError(t('validation.required'));
            return;
          }
          setFieldError(undefined);
          setFormError(null);
          save.mutate();
        }}
      >
        <FormAlert>{formError}</FormAlert>
        <ReasonBox label={t('payments.voidReason')} value={reason} onChange={setReason} error={fieldError} />
        <div className="flex gap-2.5">
          <Button type="submit" variant="danger" disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('payments.voidConfirm')}
          </Button>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('payments.voidKeep')}
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}

/**
 * Cheque status change: only the statuses the API offers (`allowedStatuses`), with a status date and
 * a note. A doctor's cheque and the lab's own cheque use their own endpoint (`direction`).
 */
export function ChequeStatusDialog({
  cheque,
  direction = 'in',
  open,
  onOpenChange,
}: {
  cheque: Cheque;
  direction?: ChequeDirection;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: settings } = useQuery(settingsQuery);
  const today = todayIn(settings?.labProfile?.timeZone ?? 'UTC');
  const options = cheque.allowedStatuses;
  const [status, setStatus] = useState<ChequeStatus | ''>(options[0] ?? '');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | undefined>();
  const noteId = useId();
  const save = useMutation({
    mutationFn: async (to: ChequeStatus): Promise<void> => {
      const body = {
        status: to,
        rowVersion: cheque.rowVersion,
        statusDate: date,
        note: note.trim() === '' ? null : note.trim(),
      };
      if (direction === 'out') await outgoingApi.chequeStatus(cheque.id, body);
      else await paymentApi.chequeStatus(cheque.id, body);
    },
    meta: { inlineErrors: true },
    onSuccess: async (_r, to) => {
      await refreshMoney(queryClient);
      toast.success(t('cheques.done', { no: cheque.chequeNo, status: t(`cheques.${to}`) }));
      onOpenChange(false);
    },
    onError: (e) => setFormError(e instanceof ApiError ? e.message : null),
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('cheques.statusDialogTitle', { no: cheque.chequeNo })}
      description={direction === 'out' ? t('cheques.returnedWarningOut') : t('cheques.returnedWarning')}
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (status === '') return;
          if (!isIsoDate(date) || date > today) {
            setDateError(t('date.invalid'));
            return;
          }
          setDateError(undefined);
          setFormError(null);
          save.mutate(status);
        }}
      >
        <FormAlert>{formError}</FormAlert>
        <SelectField
          label={t('cheques.newStatus')}
          required
          value={status}
          onChange={(e) => setStatus(e.target.value as ChequeStatus)}
        >
          {options.map((s) => (
            <option key={s} value={s}>
              {t(`cheques.${s}`)}
            </option>
          ))}
        </SelectField>
        <DateField
          label={t('cheques.statusDate')}
          required
          today={today}
          max={today}
          value={date}
          onChange={setDate}
          error={dateError}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={noteId} className="text-[14px] font-bold">
            {t('cheques.note')}
          </label>
          <textarea
            id={noteId}
            dir="auto"
            rows={2}
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="rounded-lg border border-control bg-card px-3 py-2 outline-none focus-visible:outline-2 focus-visible:outline-focus"
          />
        </div>
        <div className="flex gap-2.5">
          <Button type="submit" disabled={save.isPending || status === ''}>
            {save.isPending ? t('common.saving') : t('cheques.confirm')}
          </Button>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}
