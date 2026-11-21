import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Printer, ReceiptText, ScrollText } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { parseMoney } from '@app/shared';
import type { DocumentLanguage } from '@app/shared';
import { ApiError } from '@/api/errors';
import { moneyErrorMessage, MoneyField } from '@/components/money-field';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import type { PickerOption } from '@/components/ui/entity-picker';
import { FormAlert, SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { Card, PageHeader } from '@/components/ui/list';
import { Td, Th } from '@/components/ui/table';
import { useCan } from '@/features/auth/permissions';
import { DoctorPicker } from '@/features/cases/pickers';
import { doctorQuery } from '@/features/doctors/api';
import { newIdempotencyKey } from '@/features/payments/api';
import { MoneyCell } from '@/features/payments/parts';
import { useCurrency } from '@/features/shell/currency';
import { settingsQuery } from '@/features/shell/settings';
import { todayIn } from '@/i18n/format';
import { cn } from '@/lib/cn';
import { isIsoDate } from '@/lib/dates';
import { renderMessage } from '@/lib/form-messages';
import { eligibleCasesQuery, INVOICE_TYPE_LIST, invoiceApi, invoiceKeys, invoiceTemplateQuery, refreshInvoices } from './api';
import type { CreateInvoice, InvoiceType } from './api';
import { DocumentFrame } from './document/DocumentFrame';
import { InvoiceDocument } from './document/InvoiceDocument';
import { useLogoUrl } from '@/features/shell/settings';

const TYPE_ICON: Record<InvoiceType, ReactNode> = {
  cases: <ReceiptText aria-hidden="true" />,
  statement: <ScrollText aria-hidden="true" />,
  free: <FileText aria-hidden="true" />,
};

/** A value that settles 300 ms after the last change (the preview is not asked for at every keystroke). */
function useSettled<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/**
 * «إنشاء فاتورة» (SPEC §5.14): choose the kind first — «فاتورة حالات», «كشف حساب» or «فاتورة حرة» — then fill
 * it in. The document beside the form is the server's own preview (`POST /invoices/preview`, rendered by the
 * printing renderer), so nothing on screen is computed here; issuing sends the previewed total only as a
 * staleness check (the server recomputes everything) and opens the print view.
 */
export function NewInvoicePage() {
  const { t } = useTranslation();
  const can = useCan();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currency = useCurrency();
  const [params, setParams] = useSearchParams();
  const { data: settings } = useQuery(settingsQuery);
  const today = todayIn(settings?.labProfile?.timeZone ?? 'UTC');
  const type: InvoiceType = INVOICE_TYPE_LIST.includes(params.get('type') as InvoiceType) ? (params.get('type') as InvoiceType) : 'cases';
  const initialDoctorId = Number.parseInt(params.get('doctor') ?? '', 10);
  const { data: initialDoctor } = useQuery({
    ...doctorQuery(Number.isSafeInteger(initialDoctorId) && initialDoctorId > 0 ? initialDoctorId : 0),
    enabled: Number.isSafeInteger(initialDoctorId) && initialDoctorId > 0,
    throwOnError: false,
  });

  const [doctor, setDoctor] = useState<PickerOption | null>(null);
  const [freeParty, setFreeParty] = useState<'doctor' | 'name'>('doctor');
  const [partyName, setPartyName] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [notes, setNotes] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [amountText, setAmountText] = useState('');
  const [language, setLanguage] = useState<DocumentLanguage | ''>('');
  const [touched, setTouched] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const attempt = useRef<{ key: string; body: string } | null>(null);

  useEffect(() => {
    // `?doctor=` (the doctor page's «كشف حساب») selects that doctor once it is loaded.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initialDoctor && doctor === null) setDoctor({ id: initialDoctor.id, name: initialDoctor.name });
  }, [initialDoctor, doctor]);

  const docLanguage: DocumentLanguage = language || (settings?.language?.documents) || 'ar';
  const { data: eligible, isFetching: eligibleLoading } = useQuery({
    ...eligibleCasesQuery(doctor?.id ?? 0),
    enabled: type === 'cases' && doctor !== null,
    throwOnError: false,
  });
  const eligibleIds = (eligible?.items ?? []).map((c) => c.caseId);
  const chosen = selected.filter((id) => eligibleIds.includes(id));

  const amount = parseMoney(amountText, currency.decimals);
  const errors = {
    doctor: (type !== 'free' || freeParty === 'doctor') && doctor === null ? t('validation.required') : undefined,
    cases: type === 'cases' && chosen.length === 0 ? t('invoices.new.chooseCases') : undefined,
    partyName: type === 'free' && freeParty === 'name' && partyName.trim() === '' ? t('validation.required') : undefined,
    reason: type === 'free' && reason.trim() === '' ? t('validation.required') : undefined,
    amount:
      type !== 'free'
        ? undefined
        : !amount.ok
          ? renderMessage(t, moneyErrorMessage(amount.error, currency.decimals))
          : amount.minor <= 0
            ? t('validation.moneyPositive')
            : undefined,
    range: type === 'statement' && isIsoDate(from) && isIsoDate(to) && from > to ? t('invoices.new.rangeInvalid') : undefined,
  };
  const valid = Object.values(errors).every((e) => e === undefined);
  const shown = (e: string | undefined) => (touched ? e : undefined);

  const body: CreateInvoice | null = !valid
    ? null
    : type === 'cases'
      ? { type, doctorId: doctor?.id ?? 0, caseIds: chosen, language: docLanguage, ...(notes.trim() ? { notes: notes.trim() } : {}) }
      : type === 'statement'
        ? {
            type,
            doctorId: doctor?.id ?? 0,
            language: docLanguage,
            ...(isIsoDate(from) ? { from } : {}),
            ...(isIsoDate(to) ? { to } : {}),
            ...(notes.trim() ? { notes: notes.trim() } : {}),
          }
        : {
            type,
            ...(freeParty === 'doctor' ? { doctorId: doctor?.id ?? 0 } : { partyName: partyName.trim() }),
            reason: reason.trim(),
            amount: amount.ok ? amount.minor : 0,
            language: docLanguage,
            ...(notes.trim() ? { notes: notes.trim() } : {}),
          };
  const settledBody = useSettled(body);
  const preview = useQuery({
    queryKey: [...invoiceKeys.all, 'preview', settledBody],
    queryFn: () => invoiceApi.preview(settledBody as CreateInvoice),
    enabled: settledBody !== null,
    placeholderData: keepPreviousData,
    throwOnError: false,
    retry: false,
  });
  const previewCurrent = settledBody !== null && JSON.stringify(settledBody) === JSON.stringify(body) && preview.data !== undefined && !preview.isFetching;
  const { data: template } = useQuery({ ...invoiceTemplateQuery, enabled: can('settings.read'), throwOnError: false });
  const currentLogo = useLogoUrl(settings);

  const create = useMutation({
    mutationFn: ({ req, key }: { req: CreateInvoice; key: string }) => invoiceApi.create(req, key),
    meta: { inlineErrors: true },
    onSuccess: async (invoice) => {
      attempt.current = null;
      await refreshInvoices(queryClient);
      toast.success(t('invoices.new.done', { no: invoice.no }));
      void navigate(`/invoices/${invoice.id}?print=1`);
    },
    onError: async (e) => {
      setFormError(e instanceof ApiError ? e.message : null);
      // A case changed or was invoiced meanwhile: show the current state.
      await queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
    },
  });

  // A click while the preview is still being made waits for it, then issues (never a silent no-op).
  const [waiting, setWaiting] = useState(false);
  const issue = () => {
    if (!body || !preview.data) return;
    const req: CreateInvoice =
      body.type === 'cases' && preview.data.type === 'cases' ? { ...body, expectedTotal: preview.data.totals.total } : body;
    const json = JSON.stringify(req);
    if (attempt.current?.body !== json) attempt.current = { key: newIdempotencyKey(), body: json };
    create.mutate({ req, key: attempt.current.key });
  };
  const submit = () => {
    setTouched(true);
    setFormError(null);
    if (!valid) return;
    if (previewCurrent) issue();
    else setWaiting(true);
  };
  useEffect(() => {
    if (!waiting) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!valid || preview.isError) setWaiting(false);
    else if (previewCurrent) {
      setWaiting(false);
      issue();
    }
    // `issue` reads the current render's request; it runs once, when the preview it waited for arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, valid, preview.isError, previewCurrent]);

  const setType = (next: InvoiceType) => {
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.set('type', next);
      return n;
    }, { replace: true });
    setTouched(false);
    setFormError(null);
  };

  const allChecked = eligibleIds.length > 0 && chosen.length === eligibleIds.length;
  const previewError = preview.error instanceof ApiError ? preview.error.message : preview.isError ? t('invoices.new.previewError') : null;

  return (
    <>
      <PageHeader title={t('invoices.new.title')} intro={t('invoices.new.intro')} />
      <fieldset className="mb-4">
        <legend className="mb-2 text-[15px] font-extrabold">{t('invoices.new.chooseType')}</legend>
        <div role="radiogroup" aria-label={t('invoices.new.chooseType')} className="grid gap-3 md:grid-cols-3">
          {INVOICE_TYPE_LIST.map((k) => (
            <label
              key={k}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-[14px] border bg-card p-4 [&_svg]:size-6 [&_svg]:shrink-0',
                type === k ? 'border-cyan-ink ring-2 ring-cyan/40' : 'border-border hover:bg-hover',
              )}
            >
              <input type="radio" name="invoice-type" value={k} checked={type === k} onChange={() => setType(k)} className="mt-1" />
              {TYPE_ICON[k]}
              <span>
                <b className="block text-[15px] font-extrabold">{t(`invoices.types.${k}`)}</b>
                <span className="text-[13px] text-muted">{t(`invoices.new.typeHint.${k}`)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid items-start gap-4 2xl:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
        <Card className="flex flex-col gap-4">
          <form
            noValidate
            aria-label={t(`invoices.types.${type}`)}
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              if (e.target !== e.currentTarget) return;
              e.preventDefault();
              submit();
            }}
          >
            <FormAlert>{formError}</FormAlert>
            {type === 'free' && (
              <fieldset className="flex flex-wrap gap-4">
                <legend className="mb-1 text-[14px] font-bold">{t('invoices.new.partyKind')}</legend>
                {(['doctor', 'name'] as const).map((k) => (
                  <label key={k} className="flex items-center gap-2 text-[14px]">
                    <input type="radio" name="free-party" checked={freeParty === k} onChange={() => setFreeParty(k)} />
                    {t(`invoices.new.party.${k}`)}
                  </label>
                ))}
              </fieldset>
            )}
            {(type !== 'free' || freeParty === 'doctor') && (
              <DoctorPicker
                label={t('invoices.new.doctor')}
                quickAdd={false}
                value={doctor}
                onChange={(d) => {
                  setDoctor(d);
                  setSelected([]);
                }}
                error={shown(errors.doctor)}
              />
            )}
            {type === 'free' && freeParty === 'name' && (
              <TextField
                label={t('invoices.new.partyName')}
                required
                maxLength={100}
                value={partyName}
                onChange={(e) => setPartyName(e.target.value)}
                error={shown(errors.partyName)}
                dir="auto"
              />
            )}

            {type === 'cases' && doctor !== null && (
              <div className="flex flex-col gap-2">
                <h2 className="text-[15px] font-extrabold">{t('invoices.new.eligibleTitle')}</h2>
                {eligibleLoading && !eligible ? (
                  <p role="status" className="text-muted">
                    {t('common.loading')}
                  </p>
                ) : eligibleIds.length === 0 ? (
                  <p role="status" className="rounded-lg bg-hover px-3 py-2 font-semibold">
                    {t('invoices.new.noEligible')}
                  </p>
                ) : (
                  <div className="relative overflow-x-auto">
                    <table className="w-full border-collapse text-[14px]">
                      <caption className="sr-only">{t('invoices.new.eligibleTitle')}</caption>
                      <thead>
                        <tr className="border-b border-border">
                          <Th kind="actions">
                            <input
                              type="checkbox"
                              aria-label={t('invoices.new.selectAll')}
                              checked={allChecked}
                              onChange={(e) => setSelected(e.target.checked ? eligibleIds : [])}
                            />
                          </Th>
                          <Th kind="number">{t('invoices.new.caseNo')}</Th>
                          <Th>{t('invoices.new.patient')}</Th>
                          <Th>{t('invoices.new.status')}</Th>
                          <Th kind="money">{t('invoices.new.total')}</Th>
                          <Th kind="money">{t('invoices.new.remaining')}</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {(eligible?.items ?? []).map((c) => (
                          <tr key={c.caseId} className="border-b border-border" data-eligible-case={c.caseNo}>
                            <Td kind="actions">
                              <input
                                type="checkbox"
                                aria-label={t('invoices.new.selectCase', { no: c.caseNo })}
                                checked={chosen.includes(c.caseId)}
                                onChange={(e) =>
                                  setSelected((s) => (e.target.checked ? [...s, c.caseId] : s.filter((x) => x !== c.caseId)))
                                }
                              />
                            </Td>
                            <Td kind="number">{c.caseNo}</Td>
                            <Td autoDir>{c.patientName}</Td>
                            <Td>{t(`caseStatus.${c.status}`)}</Td>
                            <Td kind="money">
                              <MoneyCell minor={c.total} />
                            </Td>
                            <Td kind="money">
                              <MoneyCell minor={c.remaining} />
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {shown(errors.cases) && eligibleIds.length > 0 && (
                  <p className="text-[13px] font-semibold text-danger">{errors.cases}</p>
                )}
              </div>
            )}

            {type === 'statement' && (
              <div className="flex flex-wrap gap-3">
                <DateField label={t('invoices.new.from')} today={today} value={from} onChange={setFrom} className="w-44" />
                <DateField
                  label={t('invoices.new.to')}
                  today={today}
                  value={to}
                  onChange={setTo}
                  className="w-44"
                  error={errors.range}
                  hint={t('invoices.new.rangeHint')}
                />
              </div>
            )}

            {type === 'free' && (
              <>
                <TextField
                  label={t('invoices.new.reason')}
                  required
                  maxLength={300}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  error={shown(errors.reason)}
                  dir="auto"
                />
                <MoneyField
                  label={t('invoices.new.amount')}
                  required
                  symbol={currency.symbol}
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value)}
                  error={shown(errors.amount)}
                />
              </>
            )}

            <TextAreaField
              label={t('invoices.new.notes')}
              maxLength={1000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              dir="auto"
            />
            <SelectField
              label={t('invoices.new.language')}
              value={docLanguage}
              onChange={(e) => setLanguage(e.target.value as DocumentLanguage)}
              hint={t('invoices.new.languageHint')}
            >
              <option value="ar">{t('invoices.languages.ar')}</option>
              <option value="en">{t('invoices.languages.en')}</option>
            </SelectField>

            {can('invoices.write') && (
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={create.isPending || waiting || (touched && !valid)}>
                  <Printer aria-hidden="true" />
                  {create.isPending || waiting ? t('common.saving') : type === 'statement' ? t('invoices.new.issueStatement') : t('invoices.new.issue')}
                </Button>
                <span className="text-[13px] text-muted">{t('invoices.new.immutableNote')}</span>
              </div>
            )}
          </form>
        </Card>

        <div className="min-w-0">
          <h2 className="mb-2 text-[15px] font-extrabold">
            {t('invoices.new.preview')}
          </h2>
          {previewError ? (
            <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 font-semibold text-danger">
              {previewError}
            </p>
          ) : !preview.data || settledBody === null ? (
            <p className="rounded-lg bg-hover px-3 py-6 text-center text-muted">{t('invoices.new.previewHint')}</p>
          ) : (
            <DocumentFrame label={t('invoices.new.preview')} className={cn(!previewCurrent && 'opacity-60')}>
              <InvoiceDocument snapshot={preview.data} style={template?.template} logoUrl={currentLogo} draft />
            </DocumentFrame>
          )}
        </div>
      </div>
    </>
  );
}
