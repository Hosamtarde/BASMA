import { toMoneyInput } from '@app/shared';
import type { CaseArea, MoneyParseError } from '@app/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useReducer, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { ApiError } from '@/api/errors';
import { MoneyField, moneySchema } from '@/components/money-field';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { FormDialog } from '@/components/ui/dialog';
import { FormAlert, TextField } from '@/components/ui/field';
import { doctorPricesQuery } from '@/features/doctors/api';
import { useCurrency } from '@/features/shell/currency';
import { cn } from '@/lib/cn';
import { isIsoDate } from '@/lib/dates';
import { applyServerErrors, msg, rawMsg, renderMessage } from '@/lib/form-messages';
import { caseApi, MAX_LINES, storeCase } from './api';
import type { CaseDetail, CaseLine, CaseLineInput, CaseStatus } from './api';
import { useChartView, ToothChartPanel } from './chart/ToothChart';
import { selectionReducer } from './chart/selection';
import { lineForArea, linesForTeeth, teethWork, toLineInputs, workColors } from './draft';
import type { DraftLine } from './draft';
import { DraftLinesTable } from './DraftLinesTable';
import { TechnicianPicker } from './pickers';
import type { WorkTypeOption } from './pickers';
import { StatusBadge } from './status';
import { ShadeField, WorkControls } from './WorkControls';

const blankToNull = (s: string) => (s.trim() === '' ? null : s.trim());
const text = (max: number) => z.string().trim().max(max, msg('validation.maxLength', { max }));

/** Puts a business error on its field in the server's words; returns true when it did. */
function onField<T extends FieldValues>(e: unknown, map: Record<string, Path<T>>, setError: UseFormSetError<T>): boolean {
  if (e instanceof ApiError && map[e.code]) {
    setError(map[e.code] as Path<T>, { type: 'server', message: rawMsg(e.message) });
    return true;
  }
  return false;
}

function Textarea({
  label,
  error,
  required,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string | undefined; ref?: React.Ref<HTMLTextAreaElement> }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-1 text-[14px] font-bold">
        <label htmlFor={id}>{label}</label>
        {required && (
          <span aria-hidden="true" className="text-danger">
            *
          </span>
        )}
      </div>
      <textarea
        id={id}
        dir="auto"
        rows={3}
        aria-invalid={error ? true : undefined}
        aria-required={required || undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="rounded-lg border border-control bg-card px-3 py-2 outline-none focus-visible:outline-2 focus-visible:outline-focus aria-[invalid=true]:border-danger"
        {...props}
      />
      {error && (
        <p id={`${id}-error`} className="text-[13px] font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function DialogButtons({ busy, submit, onCancel, danger }: { busy: boolean; submit: string; onCancel: () => void; danger?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-2.5">
      <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={busy}>
        {busy ? t('common.saving') : submit}
      </Button>
      <Button variant="secondary" onClick={onCancel}>
        {danger ? t('caseDetails.cancelDialog.keep') : t('common.cancel')}
      </Button>
    </div>
  );
}

// ───────────────────────────── status ─────────────────────────────

const statusSchema = z.object({
  to: z.string().min(1, msg('validation.required')),
  note: text(500),
  deliveredDate: z.string(),
});

/**
 * «تغيير المرحلة»: only the statuses the API allows now (allowedStatuses); an optional note; the
 * delivery date when delivering (default the lab's today). No lifecycle rule is repeated here.
 */
export function StatusDialog({
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
  const form = useForm<z.input<typeof statusSchema>, unknown, z.output<typeof statusSchema>>({
    resolver: zodResolver(statusSchema),
    values: { to: detail.allowedStatuses.find((s) => s !== 'cancelled') ?? '', note: '', deliveredDate: today },
  });
  const to = useWatch({ control: form.control, name: 'to' });
  const { errors } = form.formState;
  const options = detail.allowedStatuses.filter((s): s is Exclude<CaseStatus, 'cancelled'> => s !== 'cancelled');

  const save = useMutation({
    mutationFn: (v: z.output<typeof statusSchema>) =>
      caseApi.changeStatus(detail.id, {
        rowVersion: detail.rowVersion,
        to: v.to as Exclude<CaseStatus, 'cancelled'>,
        note: blankToNull(v.note),
        ...(v.to === 'delivered' ? { deliveredDate: v.deliveredDate } : {}),
      }),
    meta: { inlineErrors: true },
    onSuccess: async (saved) => {
      await storeCase(queryClient, saved);
      toast.success(t('caseDetails.statusDialog.changed', { status: t(`caseStatus.${saved.status}`) }));
      onOpenChange(false);
    },
    onError: (e) => {
      if (onField(e, { 'error.case.delivered_date_invalid': 'deliveredDate' }, form.setError)) return;
      setFormError(applyServerErrors(e, form.setError, ['to', 'note', 'deliveredDate']));
    },
  });

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t('caseDetails.statusDialog.title')}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((v) => {
          setFormError(null);
          if (v.to === 'delivered' && !isIsoDate(v.deliveredDate)) {
            form.setError('deliveredDate', { type: 'client', message: msg('date.invalid') });
            return;
          }
          save.mutate(v);
        })}
      >
        <FormAlert>{formError}</FormAlert>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-[14px] font-bold">{t('caseDetails.statusDialog.to')}</legend>
          <div className="flex items-center gap-2 text-[13.5px] text-muted">
            <StatusBadge status={detail.status} />
            <span aria-hidden="true">→</span>
          </div>
          {options.map((s) => (
            <label
              key={s}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2',
                to === s ? 'border-blue bg-info-bg' : 'border-border hover:bg-hover',
              )}
            >
              <input type="radio" value={s} className="size-4 accent-[var(--color-blue)]" {...form.register('to')} />
              <StatusBadge status={s} />
            </label>
          ))}
        </fieldset>
        {to === 'delivered' && (
          <Controller
            control={form.control}
            name="deliveredDate"
            render={({ field }) => (
              <DateField
                label={t('caseDetails.statusDialog.deliveredDate')}
                required
                today={today}
                min={detail.receivedDate}
                max={today}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                inputRef={field.ref}
                error={renderMessage(t, errors.deliveredDate?.message)}
              />
            )}
          />
        )}
        <Textarea
          label={t('caseDetails.statusDialog.note')}
          error={renderMessage(t, errors.note?.message)}
          {...form.register('note')}
        />
        <DialogButtons busy={save.isPending} submit={t('common.save')} onCancel={() => onOpenChange(false)} />
      </form>
    </FormDialog>
  );
}

// ───────────────────────────── cancel ─────────────────────────────

const cancelSchema = z.object({ reason: text(500).min(1, msg('validation.required')) });

/** «إلغاء الحالة»: final, with a reason; offered only when the API says canCancel. */
export function CancelCaseDialog({
  detail,
  open,
  onOpenChange,
}: {
  detail: CaseDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof cancelSchema>, unknown, z.output<typeof cancelSchema>>({
    resolver: zodResolver(cancelSchema),
    defaultValues: { reason: '' },
  });
  const save = useMutation({
    mutationFn: (v: z.output<typeof cancelSchema>) => caseApi.cancel(detail.id, detail.rowVersion, v.reason),
    meta: { inlineErrors: true },
    onSuccess: async (saved) => {
      await storeCase(queryClient, saved);
      toast.success(t('caseDetails.cancelDialog.done', { no: saved.caseNo }));
      onOpenChange(false);
    },
    onError: (e) => setFormError(applyServerErrors(e, form.setError, ['reason'])),
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('caseDetails.cancelDialog.title', { no: detail.caseNo })}
      description={t('caseDetails.cancelDialog.body')}
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((v) => {
          setFormError(null);
          save.mutate(v);
        })}
      >
        <FormAlert>{formError}</FormAlert>
        <Textarea
          label={t('caseDetails.cancelDialog.reason')}
          required
          error={renderMessage(t, form.formState.errors.reason?.message)}
          {...form.register('reason')}
        />
        <DialogButtons
          busy={save.isPending}
          submit={t('caseDetails.cancelDialog.confirm')}
          onCancel={() => onOpenChange(false)}
          danger
        />
      </form>
    </FormDialog>
  );
}

// ───────────────────────────── edit header ─────────────────────────────

const ref = z.object({ id: z.number(), name: z.string() });
const editSchema = (decimals: number) =>
  z
    .object({
      patientName: text(100).min(1, msg('validation.required')),
      technician: ref.nullable(),
      receivedDate: z.string(),
      expectedDate: z.string(),
      discount: moneySchema(decimals, { optional: true }),
      notes: text(2000),
    })
    .superRefine((v, ctx) => {
      if (!isIsoDate(v.receivedDate)) ctx.addIssue({ code: 'custom', path: ['receivedDate'], message: msg('date.invalid') });
      if (!isIsoDate(v.expectedDate)) ctx.addIssue({ code: 'custom', path: ['expectedDate'], message: msg('date.invalid') });
    });

/** «تعديل البيانات»: PATCH only what changed, with the rowVersion that was read. */
export function EditCaseDialog({
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
  const [formError, setFormError] = useState<string | null>(null);
  const schema = editSchema(currency.decimals);
  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    values: {
      patientName: detail.patientName,
      technician: detail.technician,
      receivedDate: detail.receivedDate,
      expectedDate: detail.expectedDate,
      discount: detail.discount === 0 ? '' : toMoneyInput(detail.discount, currency.decimals),
      notes: detail.notes ?? '',
    },
  });
  const { errors } = form.formState;
  const err = (m: string | undefined) => renderMessage(t, m);
  const save = useMutation({
    mutationFn: (v: z.output<typeof schema>) => {
      const next = {
        patientName: v.patientName,
        technicianId: v.technician?.id ?? null,
        receivedDate: v.receivedDate,
        expectedDate: v.expectedDate,
        discount: v.discount,
        notes: blankToNull(v.notes),
      };
      const before = {
        patientName: detail.patientName,
        technicianId: detail.technician?.id ?? null,
        receivedDate: detail.receivedDate,
        expectedDate: detail.expectedDate,
        discount: detail.discount,
        notes: detail.notes,
      };
      const patch: Record<string, unknown> = { rowVersion: detail.rowVersion };
      for (const [k, value] of Object.entries(next)) {
        if (value !== before[k as keyof typeof before]) patch[k] = value;
      }
      return caseApi.update(detail.id, patch as { rowVersion: number });
    },
    meta: { inlineErrors: true },
    onSuccess: async (saved) => {
      await storeCase(queryClient, saved);
      toast.success(t('caseDetails.editDialog.saved'));
      onOpenChange(false);
    },
    onError: (e) => {
      const map: Record<string, Path<z.input<typeof schema>>> = {
        'error.case.received_in_future': 'receivedDate',
        'error.case.expected_before_received': 'expectedDate',
        'error.case.discount_exceeds_subtotal': 'discount',
        'error.case.technician_inactive': 'technician',
      };
      if (onField(e, map, form.setError)) return;
      setFormError(
        applyServerErrors(e, form.setError, ['patientName', 'receivedDate', 'expectedDate', 'discount', 'notes']),
      );
    },
  });
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t('caseDetails.editDialog.title')} wide>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          if (e.target !== e.currentTarget) return;
          void form.handleSubmit((v) => {
            setFormError(null);
            save.mutate(v);
          })(e);
        }}
      >
        <FormAlert>{formError}</FormAlert>
        <div className="rounded-lg bg-surface px-3 py-2 text-[14px]">
          <span className="font-bold">{t('caseDetails.doctor')}: </span>
          <span dir="auto">{detail.doctor.name}</span>
          <p className="text-[13px] text-muted">{t('caseDetails.doctorFixed')}</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label={t('newCase.patient')}
            required
            dir="auto"
            error={err(errors.patientName?.message)}
            {...form.register('patientName')}
          />
          <Controller
            control={form.control}
            name="technician"
            render={({ field }) => (
              <TechnicianPicker value={field.value} onChange={(x) => field.onChange(x)} error={err(errors.technician?.message)} />
            )}
          />
          <Controller
            control={form.control}
            name="receivedDate"
            render={({ field }) => (
              <DateField
                label={t('newCase.received')}
                required
                today={today}
                max={today}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                inputRef={field.ref}
                error={err(errors.receivedDate?.message)}
              />
            )}
          />
          <Controller
            control={form.control}
            name="expectedDate"
            render={({ field }) => (
              <DateField
                label={t('newCase.expected')}
                required
                today={today}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                inputRef={field.ref}
                error={err(errors.expectedDate?.message)}
              />
            )}
          />
          <MoneyField
            label={t('newCase.discount')}
            symbol={currency.symbol}
            error={err(errors.discount?.message)}
            {...form.register('discount')}
          />
        </div>
        <Textarea label={t('newCase.notes')} error={err(errors.notes?.message)} {...form.register('notes')} />
        <DialogButtons busy={save.isPending} submit={t('common.save')} onCancel={() => onOpenChange(false)} />
      </form>
    </FormDialog>
  );
}

// ───────────────────────────── one line ─────────────────────────────

const lineSchema = (decimals: number) =>
  z.object({ unitPrice: moneySchema(decimals), note: text(200) });

/** Edit a line's price (becomes manual), shade or note. */
export function LineDialog({
  detail,
  line,
  title,
  onOpenChange,
}: {
  detail: CaseDetail;
  line: CaseLine | null;
  title: string;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const currency = useCurrency();
  const [formError, setFormError] = useState<string | null>(null);
  const [shade, setShade] = useState<string | null>(line?.shade ?? null);
  const [lineId, setLineId] = useState<number | null>(line?.id ?? null);
  if ((line?.id ?? null) !== lineId) {
    setLineId(line?.id ?? null);
    setShade(line?.shade ?? null);
  }
  const schema = lineSchema(currency.decimals);
  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    values: {
      unitPrice: line ? toMoneyInput(line.unitPrice, currency.decimals) : '',
      note: line?.note ?? '',
    },
  });
  const save = useMutation({
    mutationFn: (v: z.output<typeof schema>) => {
      if (!line) throw new Error('no line');
      return caseApi.updateLine(detail.id, line.id, {
        rowVersion: detail.rowVersion,
        ...(v.unitPrice !== line.unitPrice ? { unitPrice: v.unitPrice } : {}),
        ...(shade !== line.shade ? { shade } : {}),
        ...(blankToNull(v.note) !== line.note ? { note: blankToNull(v.note) } : {}),
      });
    },
    meta: { inlineErrors: true },
    onSuccess: async (saved) => {
      await storeCase(queryClient, saved);
      toast.success(t('caseDetails.lineDialog.saved'));
      onOpenChange(false);
    },
    onError: (e) => setFormError(applyServerErrors(e, form.setError, ['unitPrice', 'note'])),
  });
  return (
    <FormDialog open={line !== null} onOpenChange={onOpenChange} title={t('caseDetails.lineDialog.title')} description={title}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          if (e.target !== e.currentTarget) return;
          void form.handleSubmit((v) => {
            setFormError(null);
            save.mutate(v);
          })(e);
        }}
      >
        <FormAlert>{formError}</FormAlert>
        <MoneyField
          label={t('caseDetails.lineDialog.price')}
          hint={t('caseDetails.lineDialog.priceHint')}
          symbol={currency.symbol}
          required
          error={renderMessage(t, form.formState.errors.unitPrice?.message)}
          {...form.register('unitPrice')}
        />
        <ShadeField value={shade} onChange={setShade} />
        <TextField
          label={t('caseDetails.lineDialog.note')}
          dir="auto"
          error={renderMessage(t, form.formState.errors.note?.message)}
          {...form.register('note')}
        />
        <DialogButtons busy={save.isPending} submit={t('common.save')} onCancel={() => onOpenChange(false)} />
      </form>
    </FormDialog>
  );
}

// ───────────────────────────── add lines ─────────────────────────────

/** «إضافة سطور»: the same chart and work controls as the new-case screen, saved in one call. */
export function AddLinesDialog({
  detail,
  open,
  onOpenChange,
}: {
  detail: CaseDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const currency = useCurrency();
  const [view, setView] = useChartView();
  const [selection, dispatch] = useReducer(selectionReducer, []);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [errors, setErrors] = useState<Map<string, MoneyParseError>>(new Map());
  const [workType, setWorkType] = useState<WorkTypeOption | null>(null);
  const [shade, setShade] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { data: prices } = useQuery({ ...doctorPricesQuery(detail.doctor.id), enabled: open });
  const special = useMemo(() => new Map((prices ?? []).map((p) => [p.workTypeId, p.specialPrice])), [prices]);
  const all = useMemo(() => [...detail.lines, ...lines], [detail.lines, lines]);
  const colors = useMemo(() => workColors(all), [all]);
  const work = useMemo(() => teethWork(all, colors), [all, colors]);
  const legend = [...colors].map(([id, color]) => ({ name: all.find((l) => l.workTypeId === id)?.workTypeName ?? '', color }));

  const reset = () => {
    setLines([]);
    setErrors(new Map());
    dispatch({ type: 'clear' });
    setMessage(null);
    setFormError(null);
  };
  const add = (added: DraftLine[]) => {
    if (detail.lines.length + lines.length + added.length > MAX_LINES) {
      setMessage(t('newCase.tooManyLines', { max: MAX_LINES }));
      return;
    }
    setLines((prev) => [...prev, ...added]);
    setMessage(null);
  };
  const save = useMutation({
    mutationFn: (inputs: CaseLineInput[]) => caseApi.addLines(detail.id, detail.rowVersion, inputs),
    meta: { inlineErrors: true },
    onSuccess: async (saved) => {
      await storeCase(queryClient, saved);
      toast.success(t('newCase.linesAdded', { count: lines.length }));
      reset();
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError) setFormError(e.message);
    },
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
      title={t('caseDetails.addLinesDialog.title')}
      wide="full"
    >
      <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pe-1">
          <FormAlert>{formError}</FormAlert>
          <WorkControls
            workType={workType}
            onWorkType={(w) => {
              setWorkType(w);
              setMessage(null);
            }}
            shade={shade}
            onShade={setShade}
            selectedCount={selection.length}
            onAdd={() => {
              if (!workType) return setMessage(t('newCase.needWorkType'));
              if (selection.length === 0) return setMessage(t('newCase.needTeeth'));
              add(linesForTeeth(selection, workType, shade));
              dispatch({ type: 'clear' });
            }}
            message={message}
            managerOpen={managerOpen}
            onManagerOpen={setManagerOpen}
          />
          <DraftLinesTable
            lines={lines}
            special={special}
            colors={colors}
            errors={errors}
            onManualPrice={(key, value) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, manualPrice: value } : l)))}
            onRemove={(key) => setLines((prev) => prev.filter((l) => l.key !== key))}
          />
          <p className="text-[13px] text-muted">{t('newCase.previewNote')}</p>
          <div className="flex gap-2.5">
            <Button
              disabled={save.isPending || lines.length === 0}
              onClick={() => {
                const inputs = toLineInputs(lines, currency.decimals);
                setErrors(inputs.ok ? new Map() : inputs.errors);
                if (inputs.ok) save.mutate(inputs.lines);
              }}
            >
              {save.isPending ? t('common.saving') : t('caseDetails.addLinesDialog.submit')}
            </Button>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
        <ToothChartPanel
          view={view}
          onViewChange={setView}
          selection={selection}
          dispatch={dispatch}
          work={work}
          legend={legend}
          onArchWork={(area: CaseArea) => {
            if (!workType) return setMessage(t('newCase.needWorkType'));
            add([lineForArea(area, workType, shade)]);
          }}
          expanded
          className="min-h-[420px]"
        />
      </div>
    </FormDialog>
  );
}
