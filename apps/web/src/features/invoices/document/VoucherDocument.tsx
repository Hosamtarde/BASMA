import { amountInWords, formatMoney, printedLabName } from '@app/shared';
import type { DocumentLanguage } from '@app/shared';
import { useMemo } from 'react';
import { localeOf } from '@/i18n/format';
import { i18next } from '@/i18n/i18n';
import { DocumentHeader } from './DocumentHeader';
import { documentVars, pageRule, safeStyle } from './InvoiceDocument';
import type { DocumentStyle } from './InvoiceDocument';
import './invoice-document.css';

type Td = (key: string, options?: Record<string, unknown>) => string;

/** What a voucher prints, taken from one payment row (`GET /payments/{id}` or `GET /outgoing-payments/{id}`). */
export interface VoucherData {
  /** `receipt` = «سند قبض» (IN-, incoming payment); `payment` = «سند صرف» (OUT-, expense or doctor refund). */
  kind: 'receipt' | 'payment';
  voucherNo: string;
  /** The payment date (`YYYY-MM-DD`). */
  date: string;
  party: { kind: 'doctor' | 'payee'; name: string };
  /** The expense category of an outgoing payment. */
  category: string | null;
  /** Integer minor units, exactly the stored amount. */
  amount: number;
  currency: { code: string; symbol: string; decimals: number };
  method: 'cash' | 'cheque' | 'transfer';
  cheque: { chequeNo: string; bank: string; dueDate: string; status: 'pending' | 'cleared' | 'returned' } | null;
  caseNo: number | null;
  notes: string | null;
  /** A voided payment still prints, marked (the number is never reused). */
  voided: { date: string | null; reason: string | null } | null;
  lab: { nameAr: string | null; nameEn: string | null; phone: string | null; address: string | null; slogan: string | null };
}

interface Props {
  voucher: VoucherData;
  style?: Partial<DocumentStyle> | undefined;
  /** Object URL of the lab's own logo; null = the lab name only (never a fallback image, SPEC §2.3). */
  logoUrl: string | null;
  language: DocumentLanguage;
}

/**
 * The receipt voucher (IN-) and the payment voucher (OUT-) on the same print shell as the invoices (SPEC §5.14,
 * §6.1): A4, the lab's own logo and name only, RTL or LTR from the document language, every user text rendered
 * as React text (escaped). The figures are the stored amount, formatted by the shared money module; the words
 * come from `amountInWords` over the same integer, so the two cannot disagree.
 */
export function VoucherDocument({ voucher, style, logoUrl, language }: Props) {
  const dir = language === 'ar' ? 'rtl' : 'ltr';
  const td = useMemo(() => i18next.getFixedT(language) as unknown as Td, [language]);
  const s = safeStyle(style);
  const { currency } = voucher;
  const figures = formatMoney(voucher.amount, currency.decimals, localeOf(language));
  const money = currency.symbol ? `${figures} ${currency.symbol}` : figures;
  const words = amountInWords(voucher.amount, currency.decimals, currency.code, language);
  const labName = printedLabName(voucher.lab, language);
  const title = td(voucher.kind === 'receipt' ? 'voucherDoc.title.receipt' : 'voucherDoc.title.payment');
  const voided = voucher.voided;

  return (
    <article
      className="inv-doc inv-sheet"
      lang={language}
      dir={dir}
      style={documentVars(s)}
      data-voucher-document={voucher.kind}
      aria-label={title}
    >
      <style>{pageRule(s, dir)}</style>
      <div className="inv-topbar" aria-hidden="true" />
      <DocumentHeader lab={voucher.lab} labName={labName} logoUrl={logoUrl} td={td} title={title}>
        <div>
          <dt>{td('voucherDoc.number')}</dt>
          <dd className="inv-num" data-voucher-no="">
            {voucher.voucherNo}
          </dd>
        </div>
        <div>
          <dt>{td('invoiceDoc.date')}</dt>
          <dd className="inv-num" data-voucher-date="">
            {voucher.date}
          </dd>
        </div>
      </DocumentHeader>

      {voided && (
        <p className="inv-void" role="note" data-void-band="">
          {td('voucherDoc.voidBand')}
          {voided.date ? ` — ${td('voucherDoc.voidedOn', { date: voided.date })}` : ''}
          {voided.reason ? ` — ${voided.reason}` : ''}
        </p>
      )}

      <section className="inv-party" aria-label={td('invoiceDoc.party')}>
        <div>
          <small>{td(voucher.kind === 'receipt' ? 'voucherDoc.receivedFrom' : 'voucherDoc.paidTo')}</small>
          <strong dir="auto" data-voucher-party="">
            {voucher.party.name}
          </strong>
        </div>
        {voucher.category && (
          <div>
            <small>{td('voucherDoc.category')}</small>
            <strong dir="auto" data-voucher-category="">
              {voucher.category}
            </strong>
          </div>
        )}
        {voucher.caseNo !== null && (
          <div>
            <small>{td('voucherDoc.forCase')}</small>
            <strong className="inv-num" data-voucher-case="">
              {voucher.caseNo}
            </strong>
          </div>
        )}
      </section>

      <section className="inv-voucher-amount" aria-label={td('voucherDoc.amount')}>
        <div className="inv-voucher-figure">
          <small>{td('voucherDoc.amount')}</small>
          <strong className="inv-num" data-voucher-amount="">
            {money}
          </strong>
        </div>
        <div className="inv-voucher-words">
          <small>{td('voucherDoc.inWords')}</small>
          <strong dir="auto" data-voucher-words="">
            {words}
          </strong>
        </div>
      </section>

      <dl className="inv-voucher-facts">
        <div>
          <dt>{td('voucherDoc.method')}</dt>
          <dd data-voucher-method="">{td(`payments.methods.${voucher.method}`)}</dd>
        </div>
        {voucher.cheque && (
          <div data-voucher-cheque="">
            <dt>{td('voucherDoc.cheque')}</dt>
            <dd>
              <span>
                {td('voucherDoc.chequeNo')}: <span className="inv-num">{voucher.cheque.chequeNo}</span>
              </span>
              <span dir="auto">
                {td('voucherDoc.bank')}: {voucher.cheque.bank}
              </span>
              <span>
                {td('voucherDoc.dueDate')}: <span className="inv-num">{voucher.cheque.dueDate}</span>
              </span>
              <span>
                {td('voucherDoc.chequeStatus')}: {td(`cheques.${voucher.cheque.status}`)}
              </span>
            </dd>
          </div>
        )}
      </dl>

      {voucher.notes && voucher.notes.trim() !== '' && (
        <div className="inv-notes inv-voucher-notes">
          <h3>{td('invoiceDoc.notes')}</h3>
          <span dir="auto" data-voucher-notes="">
            {voucher.notes}
          </span>
        </div>
      )}

      <div className="inv-sign">
        <div>{td(voucher.kind === 'receipt' ? 'voucherDoc.signPayer' : 'invoiceDoc.receiver')}</div>
        <div>{td('invoiceDoc.accountant')}</div>
      </div>
      <footer className="inv-footer">
        <div>
          <span dir="auto">{labName}</span>
          <span className="inv-num">{voucher.voucherNo}</span>
        </div>
      </footer>
    </article>
  );
}
