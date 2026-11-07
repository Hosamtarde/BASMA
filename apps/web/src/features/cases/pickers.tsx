import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { api, unwrap } from '@/api/client';
import { Button } from '@/components/ui/button';
import { FormDialog } from '@/components/ui/dialog';
import { EntityPicker } from '@/components/ui/entity-picker';
import type { PickerOption } from '@/components/ui/entity-picker';
import { FormAlert, TextField } from '@/components/ui/field';
import { catalogKeys, PAGE_SIZE, technicianApi } from '@/features/catalog/api';
import { WorkTypesManager } from '@/features/catalog/WorkTypesManager';
import { doctorKeys } from '@/features/doctors/api';
import { DoctorFormDialog } from '@/features/doctors/DoctorFormDialog';
import { useCurrency } from '@/features/shell/currency';
import { applyServerErrors, msg, renderMessage } from '@/lib/form-messages';

/** Only active records are offered for new work (inactive ones stay in old cases). */
const activePage = (search: string) => ({ search: search || undefined, active: true, page: 1, pageSize: PAGE_SIZE });

export const loadDoctors = async (search: string): Promise<PickerOption[]> =>
  (await unwrap(api.GET('/api/v1/doctors', { params: { query: activePage(search) } }))).items.map((d) => ({
    id: d.id,
    name: d.name,
  }));

const linkButton =
  'inline-flex items-center gap-1 rounded text-[13px] font-bold text-cyan-ink hover:underline [&_svg]:size-3.5';

interface PickerProps<T extends PickerOption> {
  value: T | null;
  onChange: (o: T | null) => void;
  error?: string | undefined;
  disabled?: boolean;
}

/** «الطبيب»: required, searchable, with «+ أضف طبيبًا آخر» (selects the new doctor). */
export function DoctorPicker({
  value,
  onChange,
  error,
  disabled,
  label,
  emptyLabel,
  quickAdd = true,
  required = true,
  className,
}: PickerProps<PickerOption> & {
  label: string;
  emptyLabel?: string;
  quickAdd?: boolean;
  required?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  return (
    <>
      <EntityPicker
        label={label}
        required={required}
        value={value}
        onChange={onChange}
        queryKey={(s) => [...doctorKeys.all, 'picker', s]}
        load={loadDoctors}
        error={error}
        disabled={disabled}
        {...(className ? { className } : {})}
        {...(emptyLabel ? { emptyLabel } : {})}
        action={
          quickAdd ? (
            <button type="button" className={linkButton} onClick={() => setAdding(true)}>
              <Plus aria-hidden="true" />
              {t('newCase.addDoctor')}
            </button>
          ) : undefined
        }
      />
      {quickAdd && (
        <DoctorFormDialog
          doctor={null}
          open={adding}
          onOpenChange={setAdding}
          onSaved={(d) => onChange({ id: d.id, name: d.name })}
        />
      )}
    </>
  );
}

const nameSchema = z.object({
  name: z.string().trim().min(1, msg('validation.required')).max(100, msg('validation.maxLength', { max: 100 })),
});

/** «+ أضف فنيًا»: name only (SPEC §5.3). */
function QuickTechnicianDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: (o: PickerOption) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof nameSchema>, unknown, z.output<typeof nameSchema>>({
    resolver: zodResolver(nameSchema),
    defaultValues: { name: '' },
  });
  const save = useMutation({
    mutationFn: (v: z.output<typeof nameSchema>) => technicianApi.create(v.name),
    meta: { inlineErrors: true },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: catalogKeys.technicians });
      toast.success(t('newCase.technicianAdded'));
      onSaved({ id: saved.id, name: saved.name });
      form.reset();
      onOpenChange(false);
    },
    onError: (e) => setFormError(applyServerErrors(e, form.setError, ['name'])),
  });
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t('newCase.quickTechnician')}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          // The dialog sits inside the case form: never submit the outer form.
          e.stopPropagation();
          void form.handleSubmit((v) => {
            setFormError(null);
            save.mutate(v);
          })(e);
        }}
      >
        <FormAlert>{formError}</FormAlert>
        <TextField
          label={t('technicians.name')}
          required
          dir="auto"
          error={renderMessage(t, form.formState.errors.name?.message)}
          {...form.register('name')}
        />
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

/** «الفني»: optional, searchable, with «+ أضف فنيًا». */
export function TechnicianPicker({ value, onChange, error, disabled }: PickerProps<PickerOption>) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  return (
    <>
      <EntityPicker
        label={t('newCase.technician')}
        value={value}
        onChange={onChange}
        emptyLabel={t('newCase.noTechnician')}
        queryKey={(s) => [...catalogKeys.technicians, 'picker', s]}
        load={async (s) =>
          (await unwrap(api.GET('/api/v1/technicians', { params: { query: activePage(s) } }))).items.map((x) => ({
            id: x.id,
            name: x.name,
          }))
        }
        error={error}
        disabled={disabled}
        action={
          <button type="button" className={linkButton} onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            {t('newCase.addTechnician')}
          </button>
        }
      />
      <QuickTechnicianDialog open={adding} onOpenChange={setAdding} onSaved={onChange} />
    </>
  );
}

export interface WorkTypeOption extends PickerOption {
  unitPrice: number;
}

/** «نوع العمل» with its general price, and «⚙ أنواع العمل» opening the manager (SPEC §5.4). */
export function WorkTypePicker({
  value,
  onChange,
  error,
  disabled,
  onManage,
}: PickerProps<WorkTypeOption> & { onManage: () => void }) {
  const { t } = useTranslation();
  const currency = useCurrency();
  return (
    <EntityPicker<WorkTypeOption>
      label={t('newCase.workType')}
      value={value}
      onChange={onChange}
      queryKey={(s) => [...catalogKeys.workTypes, 'picker', s]}
      load={async (s) =>
        (await unwrap(api.GET('/api/v1/work-types', { params: { query: activePage(s) } }))).items.map((w) => ({
          id: w.id,
          name: w.name,
          unitPrice: w.unitPrice,
          detail: `${currency.format(w.unitPrice)} ${currency.symbol}`,
        }))
      }
      error={error}
      disabled={disabled}
      action={
        <button type="button" className={linkButton} onClick={onManage}>
          <Settings2 aria-hidden="true" />
          {t('newCase.manageWorkTypes')}
        </button>
      }
    />
  );
}

export function WorkTypesManagerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t('workTypes.title')} description={t('workTypes.intro')} wide>
      <WorkTypesManager inDialog />
    </FormDialog>
  );
}
