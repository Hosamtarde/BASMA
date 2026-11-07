import { parseMoney, sumMinor } from '@app/shared';
import type { CaseArea, MoneyParseError } from '@app/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck } from 'lucide-react';
import { useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import type { Path } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { ApiError } from '@/api/errors';
import { MoneyField, moneySchema } from '@/components/money-field';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { FormDialog } from '@/components/ui/dialog';
import { FormAlert, SelectField, TextField } from '@/components/ui/field';
import { Card } from '@/components/ui/list';
import { workTypesQuery } from '@/features/catalog/api';
import { doctorPricesQuery } from '@/features/doctors/api';
import { useCurrency } from '@/features/shell/currency';
import { settingsQuery } from '@/features/shell/settings';
import { todayIn } from '@/i18n/format';
import { isIsoDate } from '@/lib/dates';
import { applyServerErrors, msg, rawMsg, renderMessage } from '@/lib/form-messages';
import { caseApi, DEFAULT_INITIAL_STATUS, INITIAL_STATUSES, MAX_LINES, storeCase } from './api';
import type { CaseDetail, CreateCase, InitialStatus } from './api';
import { useChartView, ToothChartPanel } from './chart/ToothChart';
import { selectionReducer } from './chart/selection';
import { lineForArea, linesForTeeth, previewSubtotal, teethWork, toLineInputs, workColors } from './draft';
import type { DraftLine } from './draft';
import { DraftLinesTable } from './DraftLinesTable';
import { DoctorPicker, TechnicianPicker } from './pickers';
import type { WorkTypeOption } from './pickers';
import { WorkControls } from './WorkControls';

const ref = z.object({ id: z.number(), name: z.string() });
const text = (max: number) => z.string().trim().max(max, msg('validation.maxLength', { max }));

/** Mirrors the API DTO and the B2 rules for a quick answer; the server stays the authority. */
const formSchema = (decimals: number, today: string) =>
  z
    .object({
      doctor: ref.nullable(),
      patientName: text(100).min(1, msg('validation.required')),
      technician: ref.nullable(),
      receivedDate: z.string(),
      expectedDate: z.string(),
      status: z.enum(INITIAL_STATUSES as [InitialStatus, ...InitialStatus[]]),
      discount: moneySchema(decimals, { optional: true }),
      notes: text(2000),
    })
    .superRefine((v, ctx) => {
      if (v.doctor === null) ctx.addIssue({ code: 'custom', path: ['doctor'], message: msg('validation.required') });
      const received = isIsoDate(v.receivedDate);
      if (!received) ctx.addIssue({ code: 'custom', path: ['receivedDate'], message: msg('date.invalid') });
      else if (v.receivedDate > today)
        ctx.addIssue({ code: 'custom', path: ['receivedDate'], message: msg('newCase.receivedInFuture') });
      if (v.expectedDate.trim() === '')
        ctx.addIssue({ code: 'custom', path: ['expectedDate'], message: msg('validation.required') });
      else if (!isIsoDate(v.expectedDate))
        ctx.addIssue({ code: 'custom', path: ['expectedDate'], message: msg('date.invalid') });
      else if (received && v.expectedDate < v.receivedDate)
        ctx.addIssue({ code: 'custom', path: ['expectedDate'], message: msg('newCase.expectedBeforeReceived') });
    });
type FormIn = z.input<ReturnType<typeof formSchema>>;
type FormOut = z.output<ReturnType<typeof formSchema>>;

const FIELDS = [
  'doctor',
  'patientName',
  'technician',
  'receivedDate',
  'expectedDate',
  'status',
  'discount',
  'notes',
] as const satisfies readonly Path<FormIn>[];

/** Business errors of POST /cases that belong to one field (shown there in the server's words). */
const FIELD_OF_CODE: Record<string, Path<FormIn>> = {
  'error.case.received_in_future': 'receivedDate',
  'error.case.expected_before_received': 'expectedDate',
  'error.case.discount_exceeds_subtotal': 'discount',
  'error.case.doctor_inactive': 'doctor',
  'error.case.technician_inactive': 'technician',
};
/** API field names → form fields for 400 validation answers. */
const FIELD_OF_API: Record<string, Path<FormIn>> = { doctorId: 'doctor', technicianId: 'technician' };

const blankToNull = (s: string) => (s.trim() === '' ? null : s.trim());

/**
 * «إضافة حالة جديدة» (SPEC §5.3): the form column and the sticky tooth chart. Lines are drafts
 * here; the server assigns the case number, resolves and freezes prices, and computes totals.
 */
export function NewCasePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currency = useCurrency();
  const { data: settings } = useQuery(settingsQuery);
  const today = todayIn(settings?.labProfile?.timeZone ?? 'UTC');
  const { data: workTypePage } = useQuery(workTypesQuery({ search: '', active: true, page: 1 }));
  const noWorkTypes = workTypePage !== undefined && workTypePage.total === 0;

  const [view, setView] = useChartView();
  const [selection, dispatch] = useReducer(selectionReducer, []);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [lineErrors, setLineErrors] = useState<Map<string, MoneyParseError>>(new Map());
  const [workType, setWorkType] = useState<WorkTypeOption | null>(null);
  const [shade, setShade] = useState<string | null>(null);
  const [workMessage, setWorkMessage] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [managerOpen, setManagerOpen] = useState(false);
  const [expandOpen, setExpandOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<CaseDetail | null>(null);

  // No work type yet: show the SPEC message and open the manager once (SPEC §5.3).
  const managerShown = useRef(false);
  useLayoutEffect(() => {
    if (noWorkTypes && !managerShown.current) {
      managerShown.current = true;
      setManagerOpen(true);
    }
  }, [noWorkTypes]);

  // The chart panel offers «تكبير المخطط» when it has less than about 560 px of height.
  const panelRef = useRef<HTMLDivElement>(null);
  const [short, setShort] = useState(false);
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setShort(el.getBoundingClientRect().height < 560));
    ro.observe(el);
    return () => ro.disconnect();
  }, [saved]);

  const defaults = (): FormIn => ({
    doctor: null,
    patientName: '',
    technician: null,
    receivedDate: today,
    expectedDate: '',
    status: DEFAULT_INITIAL_STATUS,
    discount: '',
    notes: '',
  });
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(formSchema(currency.decimals, today)),
    defaultValues: defaults(),
  });
  const { errors } = form.formState;
  const err = (m: string | undefined) => renderMessage(t, m);
  const doctor = useWatch({ control: form.control, name: 'doctor' });
  const discountText = useWatch({ control: form.control, name: 'discount' });

  // Preview only: the doctor's special prices (the server applies them on save).
  const { data: doctorPrices } = useQuery({ ...doctorPricesQuery(doctor?.id ?? 0), enabled: doctor !== null });
  const special = useMemo(
    () => new Map((doctor ? (doctorPrices ?? []) : []).map((p) => [p.workTypeId, p.specialPrice])),
    [doctor, doctorPrices],
  );
  const colors = useMemo(() => workColors(lines), [lines]);
  const work = useMemo(() => teethWork(lines, colors), [lines, colors]);
  const legend = [...colors].map(([id, color]) => ({
    name: lines.find((l) => l.workTypeId === id)?.workTypeName ?? '',
    color,
  }));
  const subtotal = previewSubtotal(lines, special, currency.decimals);
  const discount = discountText.trim() === '' ? { ok: true as const, minor: 0 } : parseMoney(discountText, currency.decimals);
  const total = subtotal !== null && discount.ok ? sumMinor([subtotal, -discount.minor]) : null;

  const addLines = (added: DraftLine[]) => {
    if (lines.length + added.length > MAX_LINES) {
      setWorkMessage(t('newCase.tooManyLines', { max: MAX_LINES }));
      return;
    }
    setLines((prev) => [...prev, ...added]);
    setWorkMessage(null);
    setFormError(null);
    setAnnouncement(t('newCase.linesAdded', { count: added.length }));
  };
  const addForTeeth = () => {
    if (!workType) return setWorkMessage(t('newCase.needWorkType'));
    if (selection.length === 0) return setWorkMessage(t('newCase.needTeeth'));
    addLines(linesForTeeth(selection, workType, shade));
    dispatch({ type: 'clear' });
  };
  const addForArea = (area: CaseArea) => {
    if (!workType) return setWorkMessage(t('newCase.needWorkType'));
    addLines([lineForArea(area, workType, shade)]);
  };

  const create = useMutation({
    mutationFn: (body: CreateCase) => caseApi.create(body),
    meta: { inlineErrors: true },
    onSuccess: async (detail) => {
      await storeCase(queryClient, detail);
      setSaved(detail);
      toast.success(t('newCase.saved', { no: detail.caseNo }), {
        action: { label: t('newCase.openCase'), onClick: () => void navigate(`/cases/${detail.id}`) },
        cancel: { label: t('newCase.addAnother'), onClick: () => startOver() },
        duration: 10_000,
      });
    },
    onError: (e) => {
      if (e instanceof ApiError && FIELD_OF_CODE[e.code]) {
        form.setError(FIELD_OF_CODE[e.code] as Path<FormIn>, { type: 'server', message: rawMsg(e.message) });
        return;
      }
      if (e instanceof ApiError) {
        for (const f of e.fields) {
          const field = FIELD_OF_API[f.field];
          if (field) form.setError(field, { type: 'server', message: msg('validation.invalid') });
        }
      }
      setFormError(applyServerErrors(e, form.setError, FIELDS));
    },
  });

  const startOver = () => {
    form.reset(defaults());
    setLines([]);
    setLineErrors(new Map());
    dispatch({ type: 'clear' });
    setWorkMessage(null);
    setFormError(null);
    setAnnouncement('');
    setSaved(null);
  };

  const onValid = (v: FormOut) => {
    setFormError(null);
    if (lines.length === 0) {
      setFormError(t('newCase.noLines'));
      return;
    }
    const inputs = toLineInputs(lines, currency.decimals);
    setLineErrors(inputs.ok ? new Map() : inputs.errors);
    if (!inputs.ok || v.doctor === null) return;
    create.mutate({
      doctorId: v.doctor.id,
      patientName: v.patientName,
      technicianId: v.technician?.id ?? null,
      receivedDate: v.receivedDate,
      expectedDate: v.expectedDate,
      status: v.status,
      discount: v.discount,
      notes: blankToNull(v.notes),
      lines: inputs.lines,
    });
  };

  const chartPanel = (expanded: boolean) => (
    <ToothChartPanel
      view={view}
      onViewChange={setView}
      selection={selection}
      dispatch={dispatch}
      work={work}
      legend={legend}
      onArchWork={addForArea}
      onExpand={!expanded && short ? () => setExpandOpen(true) : undefined}
      expanded={expanded}
      className={expanded ? 'h-full min-h-0 flex-1 border-0 p-0' : 'h-full'}
    />
  );

  const header = (
    <div className="mt-3 mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h1 className="text-[22px] leading-tight font-extrabold">{t('newCase.title')}</h1>
      <p className="text-[13.5px] text-muted">{t('newCase.intro')}</p>
    </div>
  );

  if (saved) {
    return (
      <>
        {header}
        <Card className="flex max-w-xl flex-col items-start gap-3">
          <h2 className="flex items-center gap-2 text-[19px] font-extrabold">
            <CircleCheck aria-hidden="true" className="size-6 text-st-ready" />
            {t('newCase.saved', { no: saved.caseNo })}
          </h2>
          <p className="text-muted">{t('newCase.savedBody')}</p>
          <div className="flex flex-wrap gap-2.5">
            <Button asChild>
              <Link to={`/cases/${saved.id}`}>{t('newCase.openCase')}</Link>
            </Button>
            <Button variant="secondary" onClick={startOver}>
              {t('newCase.addAnother')}
            </Button>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <form
          noValidate
          aria-label={t('newCase.title')}
          className="flex min-w-0 flex-col gap-4"
          onSubmit={(e) => {
            // Dialogs (quick add, work types) render in portals but bubble through React.
            if (e.target !== e.currentTarget) return;
            void form.handleSubmit(onValid)(e);
          }}
        >
          {noWorkTypes && (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-warning-ink/30 bg-warning-bg px-4 py-3 font-semibold text-warning-ink">
              <span className="flex-1">{t('newCase.noWorkTypes')}</span>
              <Button variant="secondary" size="sm" onClick={() => setManagerOpen(true)}>
                {t('newCase.openManager')}
              </Button>
            </div>
          )}
          <FormAlert>{formError}</FormAlert>
          <Card className="flex flex-col gap-4">
            <h2 className="text-[17px] font-extrabold">{t('newCase.details')}</h2>
            <Controller
              control={form.control}
              name="doctor"
              render={({ field }) => (
                <DoctorPicker
                  label={t('newCase.doctor')}
                  value={field.value}
                  onChange={(d) => field.onChange(d)}
                  error={err(errors.doctor?.message)}
                />
              )}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField
                label={t('newCase.patient')}
                required
                dir="auto"
                autoComplete="off"
                error={err(errors.patientName?.message)}
                {...form.register('patientName')}
              />
              <Controller
                control={form.control}
                name="technician"
                render={({ field }) => (
                  <TechnicianPicker
                    value={field.value}
                    onChange={(x) => field.onChange(x)}
                    error={err(errors.technician?.message)}
                  />
                )}
              />
            </div>
            <WorkControls
              workType={workType}
              onWorkType={(w) => {
                setWorkType(w);
                setWorkMessage(null);
              }}
              shade={shade}
              onShade={setShade}
              selectedCount={selection.length}
              onAdd={addForTeeth}
              message={workMessage}
              managerOpen={managerOpen}
              onManagerOpen={setManagerOpen}
            />
            <p role="status" className="sr-only">
              {announcement}
            </p>
          </Card>

          <Card className="flex flex-col gap-4">
            <h2 className="text-[17px] font-extrabold">{t('newCase.dates')}</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                    name={field.name}
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
                    name={field.name}
                    inputRef={field.ref}
                    error={err(errors.expectedDate?.message)}
                  />
                )}
              />
              <SelectField
                label={t('newCase.status')}
                hint={t('newCase.statusHint')}
                error={err(errors.status?.message)}
                {...form.register('status')}
              >
                {INITIAL_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`caseStatus.${s}`)}
                  </option>
                ))}
              </SelectField>
            </div>
          </Card>

          <Card className="flex flex-col gap-1.5">
            <label htmlFor="case-notes" className="text-[14px] font-bold">
              {t('newCase.notes')}
            </label>
            <textarea
              id="case-notes"
              dir="auto"
              rows={3}
              placeholder={t('newCase.notesPlaceholder')}
              aria-invalid={errors.notes ? true : undefined}
              aria-describedby={errors.notes ? 'case-notes-error' : undefined}
              className="rounded-lg border border-control bg-card px-3 py-2 outline-none placeholder:text-muted focus-visible:outline-2 focus-visible:outline-focus"
              {...form.register('notes')}
            />
            {errors.notes && (
              <p id="case-notes-error" className="text-[13px] font-semibold text-danger">
                {err(errors.notes.message)}
              </p>
            )}
          </Card>

          <Card className="flex flex-col gap-3">
            <h2 className="text-[17px] font-extrabold">{t('newCase.lines')}</h2>
            <DraftLinesTable
              lines={lines}
              special={special}
              colors={colors}
              errors={lineErrors}
              onManualPrice={(key, value) => {
                setLines((prev) => prev.map((l) => (l.key === key ? { ...l, manualPrice: value } : l)));
                setLineErrors((prev) => {
                  if (!prev.has(key)) return prev;
                  const next = new Map(prev);
                  next.delete(key);
                  return next;
                });
              }}
              onRemove={(key) => setLines((prev) => prev.filter((l) => l.key !== key))}
            />
            <p className="text-[13px] text-muted">{t('newCase.previewNote')}</p>
            <div className="ms-auto grid w-full max-w-sm grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 text-[14.5px]">
              <span className="text-muted">
                {t('newCase.subtotal')}{' '}
                <span className="rounded bg-surface px-1.5 text-[12px] font-bold">{t('newCase.preview')}</span>
              </span>
              <span className="num text-end font-bold" data-testid="draft-subtotal">
                {subtotal === null ? '—' : `${currency.format(subtotal)} ${currency.symbol}`}
              </span>
              <div className="col-span-2">
                <MoneyField
                  label={t('newCase.discount')}
                  symbol={currency.symbol}
                  error={err(errors.discount?.message)}
                  {...form.register('discount')}
                />
              </div>
              <span className="text-[16px] font-extrabold">
                {t('newCase.total')}{' '}
                <span className="rounded bg-surface px-1.5 text-[12px] font-bold">{t('newCase.preview')}</span>
              </span>
              <span className="num text-end text-[17px] font-extrabold" data-testid="draft-total">
                {total === null ? '—' : `${currency.format(total)} ${currency.symbol}`}
              </span>
            </div>
          </Card>

          <div className="sticky bottom-0 z-[5] -mx-1 flex gap-2.5 border-t border-border bg-surface/95 px-1 py-3 backdrop-blur">
            <Button type="submit" disabled={create.isPending} className="min-w-32">
              {create.isPending ? t('common.saving') : t('newCase.save')}
            </Button>
            <Button variant="secondary" onClick={() => void navigate('/cases')}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>

        <div ref={panelRef} className="h-[560px] min-w-0 lg:sticky lg:top-[81px] lg:h-[calc(100dvh-151px)]">
          {chartPanel(false)}
        </div>
      </div>

      <FormDialog open={expandOpen} onOpenChange={setExpandOpen} title={t('chart.expand')} wide="full">
        {chartPanel(true)}
      </FormDialog>
    </>
  );
}
