import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, FileDown, Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import type { DocumentLanguage } from '@app/shared';
import { ActionButton } from '@/components/ui/action-button';
import { SelectField } from '@/components/ui/field';
import { useCan } from '@/features/auth/permissions';
import { invoiceTemplateQuery } from '@/features/invoices/api';
import { DocumentFrame } from '@/features/invoices/document/DocumentFrame';
import { printNow } from '@/features/invoices/document/print';
import { VoucherDocument } from '@/features/invoices/document/VoucherDocument';
import type { VoucherData } from '@/features/invoices/document/VoucherDocument';
import { outgoingPaymentQuery } from '@/features/outgoing/api';
import type { OutgoingPayment } from '@/features/outgoing/api';
import { paymentQuery } from '@/features/payments/api';
import type { Payment } from '@/features/payments/api';
import { settingsQuery, useLogoUrl } from '@/features/shell/settings';
import type { Settings } from '@/features/shell/settings';
import { currentLanguage } from '@/i18n/i18n';
import { formatDateTimeIn } from '@/i18n/format';

/** The date part of a timestamp in the lab's time zone. */
const dayIn = (timestamp: string | null, timeZone: string): string | null =>
  timestamp ? formatDateTimeIn(timestamp, timeZone).slice(0, 10) : null;

function labOf(settings: Settings): VoucherData['lab'] {
  const p = settings.labProfile;
  return {
    nameAr: p?.nameAr ?? null,
    nameEn: p?.nameEn ?? null,
    phone: p?.phone ?? null,
    address: p?.address ?? null,
    slogan: p?.slogan ?? null,
  };
}

const currencyOf = (settings: Settings, code: string): VoucherData['currency'] => ({
  code,
  symbol: settings.currency?.symbol ?? '',
  decimals: settings.currency?.decimals ?? 2,
});

/** The receipt voucher of an incoming payment: every figure is the stored one. */
export function receiptVoucher(p: Payment, settings: Settings): VoucherData {
  return {
    kind: 'receipt',
    voucherNo: p.voucherNo,
    date: p.paidAt,
    party: { kind: 'doctor', name: p.doctor.name },
    category: null,
    amount: p.amount,
    currency: currencyOf(settings, p.currencyCode),
    method: p.method,
    cheque: p.cheque ? { chequeNo: p.cheque.chequeNo, bank: p.cheque.bank, dueDate: p.cheque.dueDate, status: p.cheque.status } : null,
    caseNo: p.case?.caseNo ?? null,
    notes: p.notes,
    voided:
      p.status === 'void'
        ? { date: dayIn(p.voidedAt, settings.labProfile?.timeZone ?? 'UTC'), reason: p.voidReason }
        : null,
    lab: labOf(settings),
  };
}

/** The payment voucher of an expense or a doctor refund. */
export function paymentVoucher(p: OutgoingPayment, settings: Settings): VoucherData {
  return {
    kind: 'payment',
    voucherNo: p.voucherNo,
    date: p.paidAt,
    party: p.doctor ? { kind: 'doctor', name: p.doctor.name } : { kind: 'payee', name: p.payee ?? '' },
    category: p.category.name,
    amount: p.amount,
    currency: currencyOf(settings, p.currencyCode),
    method: p.method,
    cheque: p.cheque ? { chequeNo: p.cheque.chequeNo, bank: p.cheque.bank, dueDate: p.cheque.dueDate, status: p.cheque.status } : null,
    caseNo: null,
    notes: p.notes,
    voided:
      p.status === 'void'
        ? { date: dayIn(p.voidedAt, settings.labProfile?.timeZone ?? 'UTC'), reason: p.voidReason }
        : null,
    lab: labOf(settings),
  };
}

/**
 * The preview before printing: the A4 voucher, «طباعة» and «حفظ PDF» (the browser's dialog), a reprint in the
 * other language (labels and words only). Opening and printing it only read data: nothing here writes.
 */
function VoucherView({ voucher, backTo, backLabel, title }: { voucher: VoucherData; backTo: string; backLabel: string; title: string }) {
  const { t } = useTranslation();
  const can = useCan();
  const { data: settings } = useQuery(settingsQuery);
  const { data: template } = useQuery({ ...invoiceTemplateQuery, enabled: can('settings.read'), throwOnError: false });
  const logoUrl = useLogoUrl(settings);
  const [language, setLanguage] = useState<DocumentLanguage>(settings?.language?.documents ?? 'ar');
  const [params, setParams] = useSearchParams();
  const Back = currentLanguage() === 'ar' ? ArrowRight : ArrowLeft;
  const showLogo = template?.template.showLogo ?? true;
  const logoPending = settings?.logo.present === true && showLogo && logoUrl === null;

  // ?print=1 prints once the logo is in place, then drops the flag (no second print on a re-render).
  const wantsPrint = params.get('print') === '1';
  useEffect(() => {
    if (!wantsPrint || logoPending) return;
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.delete('print');
        return n;
      },
      { replace: true },
    );
    document.querySelector<HTMLButtonElement>('[data-print-button]')?.focus();
    void printNow();
  }, [wantsPrint, logoPending, setParams]);

  return (
    <>
      <div className="print:hidden">
        <Link to={backTo} className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-bold text-cyan-ink no-underline hover:underline">
          <Back aria-hidden="true" className="size-4" />
          {backLabel}
        </Link>
        <div className="mt-2 mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-[24px] leading-tight font-extrabold">{title}</h1>
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
            <ActionButton data-print-button="" onClick={() => void printNow()}>
              <Printer aria-hidden="true" />
              {t('invoices.view.print')}
            </ActionButton>
            <ActionButton variant="secondary" onClick={() => void printNow()}>
              <FileDown aria-hidden="true" />
              {t('invoices.view.savePdf')}
            </ActionButton>
          </div>
        </div>
        {voucher.voided && (
          <p role="note" className="mb-3 rounded-lg bg-st-cancelled-bg px-4 py-2.5 font-semibold text-st-cancelled-ink">
            {t('vouchers.voidNote')}{' '}
            <span dir="auto">{voucher.voided.reason}</span>
          </p>
        )}
        <p className="mb-3 text-[13px] text-muted">{t('invoices.view.pdfHint')}</p>
      </div>
      <DocumentFrame label={title}>
        {settings && (
          <VoucherDocument
            voucher={voucher}
            style={template?.template}
            logoUrl={showLogo ? logoUrl : null}
            language={language}
          />
        )}
      </DocumentFrame>
    </>
  );
}

const idParam = (raw: string | undefined) => Number.parseInt(raw ?? '', 10);

/** `/payments/:id/voucher` — «سند قبض» (needs `payments.read`, like the payments report). */
export function ReceiptVoucherPage() {
  const { t } = useTranslation();
  const id = idParam(useParams().id);
  const { data: payment } = useSuspenseQuery(paymentQuery(id));
  const { data: settings } = useQuery(settingsQuery);
  return settings ? (
    <VoucherView
      key={payment.id}
      voucher={receiptVoucher(payment, settings)}
      backTo="/payments"
      backLabel={t('vouchers.backReceipt')}
      title={t('vouchers.titleReceipt', { no: payment.voucherNo })}
    />
  ) : null;
}

/** `/outgoing/:id/voucher` — «سند صرف» (needs `expenses.read`). */
export function PaymentVoucherPage() {
  const { t } = useTranslation();
  const id = idParam(useParams().id);
  const { data: payment } = useSuspenseQuery(outgoingPaymentQuery(id));
  const { data: settings } = useQuery(settingsQuery);
  return settings ? (
    <VoucherView
      key={payment.id}
      voucher={paymentVoucher(payment, settings)}
      backTo="/outgoing"
      backLabel={t('vouchers.backPayment')}
      title={t('vouchers.titlePayment', { no: payment.voucherNo })}
    />
  ) : null;
}
