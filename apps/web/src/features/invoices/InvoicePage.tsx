import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Ban, FileDown, Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { verifySnapshotTotals } from '@app/shared';
import type { DocumentLanguage } from '@app/shared';
import { ApiError } from '@/api/errors';
import { ActionButton } from '@/components/ui/action-button';
import { Button } from '@/components/ui/button';
import { FormDialog } from '@/components/ui/dialog';
import { FormAlert, SelectField, TextAreaField } from '@/components/ui/field';
import { useCan } from '@/features/auth/permissions';
import { currentLanguage } from '@/i18n/i18n';
import { invoiceApi, invoiceQuery, invoiceTemplateQuery, refreshInvoices, useInvoiceLogoUrl } from './api';
import type { Invoice } from './api';
import { DocumentFrame } from './document/DocumentFrame';
import { InvoiceDocument } from './document/InvoiceDocument';
import { InvoiceStatusBadge } from './InvoicesPage';

/** Waits for the bundled fonts, then opens the browser's print dialog (Save as PDF is one of its printers). */
async function printNow(): Promise<void> {
  // Older engines (and jsdom) have no FontFaceSet; printing must not depend on it.
  if ('fonts' in document) await document.fonts.ready;
  window.print();
}

/** «إلغاء الفاتورة»: a reason is required; the invoice stays listed as «ملغاة» with its number. */
function VoidInvoiceDialog({ invoice, open, onOpenChange }: { invoice: Invoice; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => invoiceApi.void(invoice.id, invoice.rowVersion, reason.trim()),
    meta: { inlineErrors: true },
    onSuccess: async () => {
      await refreshInvoices(queryClient);
      toast.success(t('invoices.view.voidDone', { no: invoice.no }));
      setReason('');
      onOpenChange(false);
    },
    onError: (e) => setFormError(e instanceof ApiError ? e.message : null),
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('invoices.view.voidTitle', { no: invoice.no })}
      description={invoice.type === 'cases' ? t('invoices.view.voidBodyCases') : t('invoices.view.voidBody')}
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
        <TextAreaField
          label={t('invoices.view.voidReason')}
          required
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={fieldError}
          dir="auto"
        />
        <div className="flex gap-2.5">
          <Button type="submit" variant="danger" disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('invoices.view.voidConfirm')}
          </Button>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('invoices.view.voidKeep')}
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}

/**
 * One invoice: the A4 preview of the frozen snapshot, print / save as PDF, a reprint in the other language
 * (labels only, SPEC §6.1) and void. Content never changes; colours, font size and margins follow the current
 * appearance (SPEC §5.14, I7). The print stylesheet prints only the document.
 */
export function InvoicePage() {
  const { t } = useTranslation();
  const can = useCan();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const { data: invoice } = useSuspenseQuery(invoiceQuery(id));
  const { data: template } = useQuery({ ...invoiceTemplateQuery, enabled: can('settings.read'), throwOnError: false });
  const logoUrl = useInvoiceLogoUrl(invoice.id, invoice.snapshot.lab.logo !== null);
  const [language, setLanguage] = useState<DocumentLanguage>(invoice.snapshot.language);
  const [voiding, setVoiding] = useState(false);
  const [params, setParams] = useSearchParams();
  const ok = verifySnapshotTotals(invoice.snapshot).length === 0;
  const logoPending = invoice.snapshot.lab.logo !== null && invoice.snapshot.layout.showLogo && logoUrl === null;
  const Back = currentLanguage() === 'ar' ? ArrowRight : ArrowLeft;

  // «إنشاء وطباعة»: arriving with ?print=1 prints once the logo is in place, then drops the flag.
  const wantsPrint = params.get('print') === '1';
  useEffect(() => {
    if (!wantsPrint || !ok || logoPending) return;
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.delete('print');
      return n;
    }, { replace: true });
    document.querySelector<HTMLButtonElement>('[data-print-button]')?.focus();
    void printNow();
  }, [wantsPrint, ok, logoPending, setParams]);

  const title = t('invoices.view.title', { type: t(`invoices.types.${invoice.type}`), no: invoice.no });
  return (
    <>
      <div className="print:hidden">
        <Link to="/invoices" className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-bold text-cyan-ink no-underline hover:underline">
          <Back aria-hidden="true" className="size-4" />
          {t('invoices.view.back')}
        </Link>
        <div className="mt-2 mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-[24px] leading-tight font-extrabold">{title}</h1>
          <InvoiceStatusBadge status={invoice.status} />
          <span className="flex-1" />
          <div className="flex flex-wrap items-end gap-2">
            <SelectField
              label={t('invoices.view.printLanguage')}
              value={language}
              onChange={(e) => setLanguage(e.target.value as DocumentLanguage)}
              className="w-40"
            >
              <option value="ar">{t('invoices.languages.ar')}</option>
              <option value="en">{t('invoices.languages.en')}</option>
            </SelectField>
            <ActionButton data-print-button="" onClick={() => void printNow()} disabledReason={ok ? null : t('invoices.view.cannotPrint')}>
              <Printer aria-hidden="true" />
              {t('invoices.view.print')}
            </ActionButton>
            <ActionButton variant="secondary" onClick={() => void printNow()} disabledReason={ok ? null : t('invoices.view.cannotPrint')}>
              <FileDown aria-hidden="true" />
              {t('invoices.view.savePdf')}
            </ActionButton>
            {can('invoices.void') && (
              <ActionButton
                variant="danger"
                onClick={() => setVoiding(true)}
                disabledReason={invoice.status === 'void' ? t('invoices.view.alreadyVoid') : null}
              >
                <Ban aria-hidden="true" />
                {t('invoices.view.void')}
              </ActionButton>
            )}
          </div>
        </div>
        {invoice.status === 'void' && (
          <p role="note" className="mb-3 rounded-lg bg-st-cancelled-bg px-4 py-2.5 font-semibold text-st-cancelled-ink">
            {t('invoices.view.voidNote')}{' '}
            <span dir="auto">{invoice.voidReason}</span>
          </p>
        )}
        <p className="mb-3 text-[13px] text-muted">{t('invoices.view.pdfHint')}</p>
      </div>
      <DocumentFrame label={title}>
        <InvoiceDocument
          snapshot={invoice.snapshot}
          style={template?.template}
          logoUrl={logoUrl}
          language={language}
          voided={invoice.status === 'void' ? { reason: invoice.voidReason } : null}
        />
      </DocumentFrame>
      {voiding && <VoidInvoiceDialog invoice={invoice} open onOpenChange={(o) => !o && setVoiding(false)} />}
    </>
  );
}
