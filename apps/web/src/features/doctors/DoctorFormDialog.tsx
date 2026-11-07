import { toMoneyInput } from '@app/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { MoneyField, moneySchema } from '@/components/money-field';
import { Button } from '@/components/ui/button';
import { CheckboxField } from '@/components/ui/checkbox-field';
import { FormDialog } from '@/components/ui/dialog';
import { FormAlert, TextField } from '@/components/ui/field';
import { useCurrency } from '@/features/shell/currency';
import { applyServerErrors, msg, renderMessage } from '@/lib/form-messages';
import { doctorApi, doctorKeys } from './api';
import type { Doctor } from './api';

/** Mirrors the API DTO limits; the server stays the authority. */
const PHONE_PATTERN = /^[\p{Nd}+\-() ]*$/u;
const text = (max: number) => z.string().trim().max(max, msg('validation.maxLength', { max }));

const schema = (decimals: number) =>
  z.object({
    name: text(100).min(1, msg('validation.required')),
    phone: text(30).regex(PHONE_PATTERN, msg('validation.phoneFormat')),
    clinic: text(100),
    notes: text(1000),
    openingBalance: moneySchema(decimals, { allowNegative: true, optional: true }),
    active: z.boolean(),
  });
type FormIn = z.input<ReturnType<typeof schema>>;
type FormOut = z.output<ReturnType<typeof schema>>;

const blankToNull = (s: string) => (s === '' ? null : s);

/** Add or edit a doctor (SPEC §5.2): name unique, signed opening balance in minor units. */
export function DoctorFormDialog({
  doctor,
  open,
  onOpenChange,
  onSaved,
}: {
  doctor: Doctor | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved?: (d: Doctor) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const currency = useCurrency();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema(currency.decimals)),
    values: {
      name: doctor?.name ?? '',
      phone: doctor?.phone ?? '',
      clinic: doctor?.clinic ?? '',
      notes: doctor?.notes ?? '',
      openingBalance:
        doctor && doctor.openingBalance !== 0 ? toMoneyInput(doctor.openingBalance, currency.decimals) : '',
      active: doctor?.active ?? true,
    },
  });
  const { errors } = form.formState;
  const err = (m: string | undefined) => renderMessage(t, m);

  const save = useMutation({
    mutationFn: (v: FormOut) => {
      const fields = {
        name: v.name,
        phone: blankToNull(v.phone),
        clinic: blankToNull(v.clinic),
        notes: blankToNull(v.notes),
        openingBalance: v.openingBalance,
      };
      if (!doctor) return doctorApi.create(fields);
      // Only what changed, with the version that was read (409 if someone else saved first).
      const patch: Record<string, unknown> = { rowVersion: doctor.rowVersion };
      for (const [k, value] of Object.entries({ ...fields, active: v.active })) {
        if (value !== doctor[k as keyof Doctor]) patch[k] = value;
      }
      return doctorApi.update(doctor.id, patch as { rowVersion: number });
    },
    meta: { inlineErrors: true },
    onSuccess: async (saved) => {
      queryClient.setQueryData(doctorKeys.one(saved.id), saved);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: doctorKeys.all }),
        // An opening balance is money: it can lock the currency.
        queryClient.invalidateQueries({ queryKey: ['settings'] }),
      ]);
      toast.success(doctor ? t('doctors.updated') : t('doctors.created'));
      onOpenChange(false);
      onSaved?.(saved);
    },
    onError: (e) =>
      setFormError(
        applyServerErrors(e, form.setError, ['name', 'phone', 'clinic', 'notes', 'openingBalance']),
      ),
  });

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={doctor ? t('doctors.edit') : t('doctors.add')}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((v) => {
          setFormError(null);
          save.mutate(v);
        })}
      >
        <FormAlert>{formError}</FormAlert>
        <TextField
          label={t('doctors.name')}
          required
          dir="auto"
          error={err(errors.name?.message)}
          {...form.register('name')}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label={t('doctors.clinic')}
            dir="auto"
            error={err(errors.clinic?.message)}
            {...form.register('clinic')}
          />
          <TextField
            label={t('doctors.phone')}
            type="tel"
            dir="ltr"
            error={err(errors.phone?.message)}
            {...form.register('phone')}
          />
        </div>
        <MoneyField
          label={t('doctors.openingBalance')}
          hint={t('doctors.openingBalanceHint')}
          symbol={currency.symbol}
          error={err(errors.openingBalance?.message)}
          {...form.register('openingBalance')}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="doctor-notes" className="text-[14px] font-bold">
            {t('doctors.notes')}
          </label>
          <textarea
            id="doctor-notes"
            dir="auto"
            rows={3}
            aria-invalid={errors.notes ? true : undefined}
            className="rounded-lg border border-control bg-card px-3 py-2 outline-none focus-visible:outline-2 focus-visible:outline-focus"
            {...form.register('notes')}
          />
          {errors.notes && (
            <p className="text-[13px] font-semibold text-danger">{err(errors.notes.message)}</p>
          )}
        </div>
        {doctor && (
          <CheckboxField
            label={t('list.activeLabel')}
            hint={t('list.activeHint')}
            {...form.register('active')}
          />
        )}
        <div className="flex gap-2.5">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}
