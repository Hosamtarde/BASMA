import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { contrastRatio, HEX_COLOR, INVOICE_COLUMNS, INVOICE_FONT_SIZES, TEMPLATE_LIMITS, validateInvoiceTemplate } from '@app/shared';
import type { DocumentLanguage, InvoiceColumn, InvoiceMargins, InvoiceTemplate, TemplateError } from '@app/shared';
import { ApiError } from '@/api/errors';
import { Button } from '@/components/ui/button';
import { CheckboxField } from '@/components/ui/checkbox-field';
import { FormAlert, SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { Card, PageHeader } from '@/components/ui/list';
import { useCan } from '@/features/auth/permissions';
import { settingsQuery, useLogoUrl } from '@/features/shell/settings';
import { todayIn } from '@/i18n/format';
import { invoiceApi, invoiceKeys, invoiceTemplateQuery } from './api';
import { DocumentFrame } from './document/DocumentFrame';
import { InvoiceDocument } from './document/InvoiceDocument';
import { sampleSnapshot } from './sample';

const MARGINS: (keyof InvoiceMargins)[] = ['top', 'end', 'bottom', 'start'];
const COLOURS = ['primaryColor', 'headerTextColor', 'tableHeaderColor'] as const;

/** The form keeps text while typing; only a template that passes the shared validator is previewed or saved. */
interface Draft {
  primaryColor: string;
  headerTextColor: string;
  tableHeaderColor: string;
  fontSize: InvoiceTemplate['fontSize'];
  margins: Record<keyof InvoiceMargins, string>;
  columns: InvoiceColumn[];
  widths: Partial<Record<InvoiceColumn, string>>;
  showLogo: boolean;
  showBalances: boolean;
  footerText: string;
}

const toDraft = (t: InvoiceTemplate): Draft => ({
  ...t,
  margins: { top: String(t.margins.top), end: String(t.margins.end), bottom: String(t.margins.bottom), start: String(t.margins.start) },
  columns: [...t.columns],
  widths: Object.fromEntries(Object.entries(t.widths).map(([k, v]) => [k, String(v)])),
});

const toNumber = (s: string): number | string => (/^\d{1,3}$/.test(s.trim()) ? Number(s.trim()) : s);

function fromDraft(d: Draft): unknown {
  return {
    ...d,
    margins: Object.fromEntries(MARGINS.map((k) => [k, toNumber(d.margins[k])])),
    // Columns keep the fixed order of the document; the form only shows or hides them.
    columns: INVOICE_COLUMNS.filter((c) => d.columns.includes(c)),
    widths: Object.fromEntries(
      Object.entries(d.widths)
        .filter(([, v]) => v !== undefined && v.trim() !== '')
        .map(([k, v]) => [k, toNumber(v ?? '')]),
    ),
  };
}

/**
 * «مظهر الفاتورة» (SPEC §5.15): the settings on one side, a live preview on the other, rendered by the same
 * renderer that prints. Colours are six-digit hex only, sizes are whole millimetres, the footer is plain text;
 * the server validates the same way (one shared validator) and stores nothing else.
 */
export function InvoiceAppearancePage() {
  const { t } = useTranslation();
  const can = useCan();
  const queryClient = useQueryClient();
  const { data: stored } = useSuspenseQuery(invoiceTemplateQuery);
  const { data: settings } = useSuspenseQuery(settingsQuery);
  const logoUrl = useLogoUrl(settings);
  const [draft, setDraft] = useState<Draft>(() => toDraft(stored.template));
  const [version, setVersion] = useState(stored.rowVersion);
  const [previewLanguage, setPreviewLanguage] = useState<DocumentLanguage>((settings.language?.documents) ?? 'ar');
  const [formError, setFormError] = useState<string | null>(null);
  const checked = validateInvoiceTemplate(fromDraft(draft));
  const errorOf = (field: string): string | undefined => {
    if (checked.ok) return undefined;
    const e: TemplateError | undefined = checked.errors.find((x) => x.field === field || x.field.startsWith(`${field}.`));
    return e ? t(`invoices.appearance.errors.${field.split('.')[0] as 'margins'}`) : undefined;
  };
  // The last valid template stays in the preview while a field is half typed.
  const [lastValid, setLastValid] = useState<InvoiceTemplate>(stored.template);
  if (checked.ok && JSON.stringify(checked.template) !== JSON.stringify(lastValid)) setLastValid(checked.template);

  const fixedT = (key: string) => t(key as 'invoices.sample.clinic', { lng: previewLanguage });
  const sample = sampleSnapshot(
    settings,
    lastValid,
    previewLanguage,
    {
      clinic: fixedT('invoices.sample.clinic'),
      doctor: fixedT('invoices.sample.doctor'),
      zirconia: fixedT('invoices.sample.zirconia'),
      bridge: fixedT('invoices.sample.bridge'),
      patient1: fixedT('invoices.sample.patient1'),
      patient2: fixedT('invoices.sample.patient2'),
      notes: fixedT('invoices.sample.notes'),
    },
    todayIn(settings.labProfile?.timeZone ?? 'UTC'),
  );
  const lowContrast =
    HEX_COLOR.test(draft.headerTextColor) && HEX_COLOR.test(draft.tableHeaderColor) && contrastRatio(draft.headerTextColor, draft.tableHeaderColor) < 4.5;

  const save = useMutation({
    mutationFn: (template: InvoiceTemplate) => invoiceApi.saveTemplate(version, template),
    meta: { inlineErrors: true },
    onSuccess: (r) => {
      setVersion(r.rowVersion);
      setDraft(toDraft(r.template));
      queryClient.setQueryData(invoiceKeys.template, r);
      toast.success(t('invoices.appearance.saved'));
    },
    onError: (e) => setFormError(e instanceof ApiError ? e.message : null),
  });

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const readOnly = !can('settings.write');

  return (
    <>
      <PageHeader title={t('invoices.appearance.title')} intro={t('invoices.appearance.intro')} />
      <div className="grid items-start gap-4 2xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <Card>
          <form
            noValidate
            aria-label={t('invoices.appearance.title')}
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setFormError(null);
              if (checked.ok) save.mutate(checked.template);
            }}
          >
            <FormAlert>{formError}</FormAlert>
            <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-3" disabled={readOnly}>
              <legend className="mb-1 text-[15px] font-extrabold">{t('invoices.appearance.colours')}</legend>
              {COLOURS.map((k) => (
                <div key={k} className="flex items-end gap-2">
                  <TextField
                    label={t(`invoices.appearance.${k}`)}
                    value={draft[k]}
                    onChange={(e) => set(k, e.target.value)}
                    error={errorOf(k)}
                    dir="ltr"
                    maxLength={7}
                    className="num"
                    spellCheck={false}
                  />
                  <input
                    type="color"
                    aria-label={t('invoices.appearance.pick', { name: t(`invoices.appearance.${k}`) })}
                    value={HEX_COLOR.test(draft[k]) ? draft[k].toLowerCase() : '#000000'}
                    onChange={(e) => set(k, e.target.value.toUpperCase())}
                    className="mb-0.5 h-9 w-10 shrink-0 cursor-pointer rounded border border-control bg-card"
                  />
                </div>
              ))}
            </fieldset>
            {lowContrast && (
              <p role="status" className="flex items-center gap-2 rounded-lg bg-warning-bg px-3 py-2 text-[13px] font-semibold text-warning-ink">
                <TriangleAlert aria-hidden="true" className="size-4" />
                {t('invoices.appearance.lowContrast')}
              </p>
            )}
            <SelectField
              label={t('invoices.appearance.fontSize')}
              value={draft.fontSize}
              onChange={(e) => set('fontSize', e.target.value as InvoiceTemplate['fontSize'])}
              disabled={readOnly}
            >
              {INVOICE_FONT_SIZES.map((s) => (
                <option key={s} value={s}>
                  {t(`invoices.appearance.sizes.${s}`)}
                </option>
              ))}
            </SelectField>
            <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-4" disabled={readOnly}>
              <legend className="mb-1 text-[15px] font-extrabold">{t('invoices.appearance.margins')}</legend>
              {MARGINS.map((k) => (
                <TextField
                  key={k}
                  label={t(`invoices.appearance.margin.${k}`)}
                  value={draft.margins[k]}
                  onChange={(e) => set('margins', { ...draft.margins, [k]: e.target.value })}
                  inputMode="numeric"
                  dir="ltr"
                  className="num"
                  suffix={t('invoices.appearance.mm')}
                />
              ))}
              {errorOf('margins') && (
                <p className="col-span-full text-[13px] font-semibold text-danger">
                  {t('invoices.appearance.errors.margins', { min: TEMPLATE_LIMITS.marginMin, max: TEMPLATE_LIMITS.marginMax })}
                </p>
              )}
            </fieldset>
            <fieldset className="flex flex-col gap-2" disabled={readOnly}>
              <legend className="mb-1 text-[15px] font-extrabold">{t('invoices.appearance.columns')}</legend>
              <p className="text-[13px] text-muted">{t('invoices.appearance.columnsHint')}</p>
              {INVOICE_COLUMNS.map((c) => (
                <div key={c} className="flex flex-wrap items-end gap-3">
                  <div className="min-w-40 flex-1">
                    <CheckboxField
                      label={t(`invoiceDoc.col.${c}`)}
                      checked={draft.columns.includes(c)}
                      disabled={c === 'lineTotal'}
                      onChange={(e) =>
                        set('columns', e.target.checked ? [...draft.columns, c] : draft.columns.filter((x) => x !== c))
                      }
                    />
                  </div>
                  <TextField
                    label={t('invoices.appearance.width', { column: t(`invoiceDoc.col.${c}`) })}
                    value={draft.widths[c] ?? ''}
                    onChange={(e) => set('widths', { ...draft.widths, [c]: e.target.value })}
                    placeholder={t('invoices.appearance.auto')}
                    inputMode="numeric"
                    dir="ltr"
                    className="num w-28"
                    suffix={t('invoices.appearance.mm')}
                  />
                </div>
              ))}
              {errorOf('widths') && (
                <p className="text-[13px] font-semibold text-danger">
                  {t('invoices.appearance.errors.widths', { min: TEMPLATE_LIMITS.widthMin, max: TEMPLATE_LIMITS.widthMax })}
                </p>
              )}
            </fieldset>
            <fieldset className="flex flex-col gap-2" disabled={readOnly}>
              <legend className="mb-1 text-[15px] font-extrabold">{t('invoices.appearance.show')}</legend>
              <CheckboxField label={t('invoices.appearance.showLogo')} checked={draft.showLogo} onChange={(e) => set('showLogo', e.target.checked)} />
              <CheckboxField
                label={t('invoices.appearance.showBalances')}
                checked={draft.showBalances}
                onChange={(e) => set('showBalances', e.target.checked)}
              />
            </fieldset>
            <TextAreaField
              label={t('invoices.appearance.footerText')}
              hint={t('invoices.appearance.footerHint', { max: TEMPLATE_LIMITS.footerMax, lines: TEMPLATE_LIMITS.footerLines })}
              value={draft.footerText}
              onChange={(e) => set('footerText', e.target.value)}
              error={errorOf('footerText')}
              maxLength={TEMPLATE_LIMITS.footerMax}
              rows={3}
              dir="auto"
              disabled={readOnly}
            />
            {!readOnly && (
              <div>
                <Button type="submit" disabled={save.isPending || !checked.ok}>
                  {save.isPending ? t('common.saving') : t('common.save')}
                </Button>
              </div>
            )}
          </form>
        </Card>
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-[15px] font-extrabold">
              {t('invoices.appearance.preview')}
            </h2>
            <SelectField
              label={t('invoices.appearance.previewLanguage')}
              value={previewLanguage}
              onChange={(e) => setPreviewLanguage(e.target.value as DocumentLanguage)}
              className="w-40"
            >
              <option value="ar">{t('invoices.languages.ar')}</option>
              <option value="en">{t('invoices.languages.en')}</option>
            </SelectField>
          </div>
          <DocumentFrame label={t('invoices.appearance.preview')}>
            <InvoiceDocument snapshot={sample} style={lastValid} logoUrl={logoUrl} />
          </DocumentFrame>
        </div>
      </div>
    </>
  );
}
