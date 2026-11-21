import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { amountInWords, formatMoney, PRODUCT_NAME } from '@app/shared';
import { resetSessionForTests, session } from '@/api/session';
import { initI18n } from '@/i18n/i18n';
import { settingsFixture } from '@/test/fixtures';
import { json, renderRoutes, stubApi } from '@/test/render';
import { VoucherDocument } from '../invoices/document/VoucherDocument';
import type { VoucherData } from '../invoices/document/VoucherDocument';
import { PaymentVoucherPage, ReceiptVoucherPage } from './VoucherPage';

const lab = { nameAr: 'مختبر الاختبار', nameEn: 'Test Lab', phone: '02 222 3333', address: 'الخليل', slogan: null };
const currency = { code: 'ILS', symbol: '₪', decimals: 2 };

const receipt = (over: Partial<VoucherData> = {}): VoucherData => ({
  kind: 'receipt',
  voucherNo: 'IN-000007',
  date: '2026-11-20',
  party: { kind: 'doctor', name: 'د. أحمد سالم' },
  category: null,
  amount: 100_050,
  currency,
  method: 'cash',
  cheque: null,
  caseNo: null,
  notes: null,
  voided: null,
  lab,
  ...over,
});

const outgoing = (over: Partial<VoucherData> = {}): VoucherData => ({
  ...receipt(),
  kind: 'payment',
  voucherNo: 'OUT-000003',
  party: { kind: 'payee', name: 'شركة الكهرباء' },
  category: 'كهرباء',
  ...over,
});

const doc = () => document.querySelector('[data-voucher-document]') as HTMLElement;

describe('VoucherDocument — the receipt and payment voucher renderer', () => {
  beforeEach(async () => {
    await initI18n('ar');
  });

  it('receipt in Arabic: RTL, number, doctor, amount in figures and in words, signatures', () => {
    render(<VoucherDocument voucher={receipt({ notes: 'دفعة أولى', caseNo: 1024 })} logoUrl={null} language="ar" />);
    expect(doc()).toHaveAttribute('lang', 'ar');
    expect(doc()).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { level: 2, name: 'سند قبض' })).toBeInTheDocument();
    expect(doc().querySelector('h1')).toBeNull();
    expect(doc().querySelector('[data-voucher-no]')).toHaveTextContent('IN-000007');
    expect(doc().querySelector('[data-voucher-date]')).toHaveTextContent('2026-11-20');
    expect(doc().querySelector('[data-voucher-party]')).toHaveTextContent('د. أحمد سالم');
    expect(doc().querySelector('[data-voucher-amount]')).toHaveTextContent('1,000.50 ₪');
    expect(doc().querySelector('[data-voucher-words]')).toHaveTextContent('ألف شيكل وخمسون أغورة');
    expect(doc().querySelector('[data-voucher-method]')).toHaveTextContent('نقدًا');
    expect(doc().querySelector('[data-voucher-case]')).toHaveTextContent('1024');
    expect(doc().querySelector('[data-voucher-notes]')).toHaveTextContent('دفعة أولى');
    expect(doc().querySelectorAll('.inv-sign > div')).toHaveLength(2);
    expect(doc().querySelector('[data-void-band]')).toBeNull();
    expect(doc().querySelector('.inv-lab-name')).toHaveTextContent('مختبر الاختبار');
  });

  it('payment voucher in English: LTR, payee and category, words in English', () => {
    render(<VoucherDocument voucher={outgoing({ amount: 200_000_000 })} logoUrl={null} language="en" />);
    expect(doc()).toHaveAttribute('lang', 'en');
    expect(doc()).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('heading', { level: 2, name: 'Payment voucher' })).toBeInTheDocument();
    expect(doc().querySelector('[data-voucher-no]')).toHaveTextContent('OUT-000003');
    expect(doc().querySelector('[data-voucher-party]')).toHaveTextContent('شركة الكهرباء');
    expect(doc().querySelector('[data-voucher-category]')).toHaveTextContent('كهرباء');
    expect(doc().querySelector('[data-voucher-amount]')).toHaveTextContent('2,000,000.00 ₪');
    expect(doc().querySelector('[data-voucher-words]')).toHaveTextContent('Two million shekels');
    expect(doc().querySelector('.inv-lab-name')).toHaveTextContent('Test Lab');
  });

  it('a cheque prints its number, bank, due date and status', () => {
    render(
      <VoucherDocument
        voucher={receipt({ method: 'cheque', cheque: { chequeNo: '554433', bank: 'بنك فلسطين', dueDate: '2026-12-15', status: 'pending' } })}
        logoUrl={null}
        language="ar"
      />,
    );
    const m = doc().querySelector('[data-voucher-cheque]') as HTMLElement;
    expect(m).toHaveTextContent('554433');
    expect(m).toHaveTextContent('بنك فلسطين');
    expect(m).toHaveTextContent('2026-12-15');
    expect(m).toHaveTextContent('قيد التحصيل');
  });

  it('a voided voucher still prints, marked «ملغى» with its date and reason', () => {
    render(<VoucherDocument voucher={receipt({ voided: { date: '2026-11-21', reason: 'مبلغ خاطئ' } })} logoUrl={null} language="ar" />);
    const band = doc().querySelector('[data-void-band]') as HTMLElement;
    expect(band).toHaveTextContent('ملغى');
    expect(band).toHaveTextContent('2026-11-21');
    expect(band).toHaveTextContent('مبلغ خاطئ');
    expect(doc().querySelector('[data-voucher-no]')).toHaveTextContent('IN-000007');
  });

  it('every printed figure equals the stored amount, in both languages', () => {
    const amounts = [1, 99, 100, 101, 1_050, 100_050, 123_456, 100_000_000, 200_000_000, 999_999_999_999];
    for (const lang of ['ar', 'en'] as const) {
      for (const amount of amounts) {
        const { unmount } = render(<VoucherDocument voucher={receipt({ amount })} logoUrl={null} language={lang} />);
        const figure = formatMoney(amount, 2, lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB');
        expect(doc().querySelector('[data-voucher-amount]')).toHaveTextContent(`${figure} ₪`);
        expect(doc().querySelector('[data-voucher-words]')?.textContent).toBe(amountInWords(amount, 2, 'ILS', lang));
        unmount();
      }
    }
  });

  it('user text is escaped: no script, no handler, no image from names, bank, cheque number, notes, reasons, category or lab fields', () => {
    const attack = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
    render(
      <VoucherDocument
        voucher={outgoing({
          party: { kind: 'payee', name: attack },
          category: attack,
          notes: attack,
          method: 'cheque',
          cheque: { chequeNo: attack, bank: attack, dueDate: '2026-12-15', status: 'pending' },
          voided: { date: '2026-11-21', reason: attack },
          lab: { nameAr: attack, nameEn: attack, phone: attack, address: attack, slogan: attack },
        })}
        logoUrl={null}
        language="en"
      />,
    );
    expect(doc().querySelectorAll('img, script, [onerror], [onclick]')).toHaveLength(0);
    expect(doc().innerHTML).not.toMatch(/<img|<script/iu);
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    expect(doc().querySelector('[data-voucher-party]')).toHaveTextContent(attack);
    expect(doc().querySelector('[data-voucher-notes]')).toHaveTextContent(attack);
    expect(doc().querySelector('[data-void-band]')).toHaveTextContent(attack);
  });

  it('the only image is the lab logo and the product is never named', () => {
    render(<VoucherDocument voucher={receipt()} logoUrl="blob:lab-logo" language="ar" />);
    const images = Array.from(doc().querySelectorAll('img'));
    expect(images).toHaveLength(1);
    expect(images[0]).toHaveAttribute('data-lab-logo');
    expect(doc().textContent).not.toContain(PRODUCT_NAME);
    expect(doc().textContent).not.toContain('بسمة');
  });

  it('no logo: the lab name only, never a fallback image', () => {
    render(<VoucherDocument voucher={receipt()} logoUrl={null} language="ar" />);
    expect(doc().querySelectorAll('img')).toHaveLength(0);
    expect(doc().querySelector('.inv-lab-name')).toBeInTheDocument();
  });

  it('the voucher view does not import the product logo or name (same folder as the invoice renderer)', () => {
    const dir = path.resolve(__dirname, '../invoices/document');
    const files = readdirSync(dir).filter((f) => /\.(tsx?|css)$/u.test(f));
    expect(files).toContain('VoucherDocument.tsx');
    for (const f of files) {
      const text = readFileSync(path.join(dir, f), 'utf8');
      expect(text, f).not.toMatch(/basma-|PRODUCT_NAME|assets\/brand/u);
    }
  });
});

const me = (permissions: string[]) => () => json(200, { id: 1, username: 'owner', permissions, mustChangePassword: false });

const paymentRow = {
  id: 9,
  voucherNo: 'IN-000009',
  doctor: { id: 7, name: 'د. أحمد سالم' },
  case: { id: 41, caseNo: 1024 },
  method: 'cash',
  amount: 100_050,
  currencyCode: 'ILS',
  paidAt: '2026-11-20',
  notes: 'ملاحظة',
  status: 'active',
  voidReason: null,
  voidedAt: null,
  counted: true,
  cheque: null,
  rowVersion: 1,
  createdAt: '2026-11-20T09:00:00.000Z',
};

const outgoingRow = {
  id: 4,
  voucherNo: 'OUT-000004',
  kind: 'expense',
  category: { id: 2, name: 'كهرباء' },
  doctor: null,
  payee: 'شركة الكهرباء',
  method: 'transfer',
  amount: 25_000,
  currencyCode: 'ILS',
  paidAt: '2026-11-19',
  effectiveDate: '2026-11-19',
  notes: null,
  status: 'void',
  voidReason: 'مكرر',
  voidedAt: '2026-11-20T10:00:00.000Z',
  counted: false,
  cheque: null,
  rowVersion: 2,
  createdAt: '2026-11-19T09:00:00.000Z',
};

describe('voucher pages — printing is a read', () => {
  beforeEach(async () => {
    await initI18n('ar');
    session.setToken('t');
  });
  afterEach(() => {
    resetSessionForTests();
    vi.unstubAllGlobals();
  });

  const mount = (kind: 'receipt' | 'payment', url: string) => {
    const calls = stubApi({
      'GET /api/v1/settings': () => json(200, settingsFixture()),
      'GET /api/v1/auth/me': me(['payments.read', 'expenses.read', 'settings.read']),
      'GET /api/v1/settings/invoice-template': () => json(404, { error: { code: 'error.not_found', message: 'x', params: {}, correlationId: 'c' } }),
      'GET /api/v1/payments/9': () => json(200, paymentRow),
      'GET /api/v1/outgoing-payments/4': () => json(200, outgoingRow),
    });
    const Page = kind === 'receipt' ? ReceiptVoucherPage : PaymentVoucherPage;
    const route = kind === 'receipt' ? '/payments/:id/voucher' : '/outgoing/:id/voucher';
    const view = renderRoutes(
      [
        {
          path: route,
          element: (
            <Suspense fallback={null}>
              <Page />
            </Suspense>
          ),
        },
      ],
      url,
    );
    return Object.assign(calls, { router: view.router });
  };

  it('the receipt page previews, prints on click and sends nothing but GETs', async () => {
    const calls = mount('receipt', '/payments/9/voucher');
    expect(await screen.findByRole('heading', { level: 1, name: 'سند قبض IN-000009' })).toBeInTheDocument();
    await waitFor(() => expect(doc()).toBeInTheDocument());
    expect(doc().querySelector('[data-voucher-words]')).toHaveTextContent('ألف شيكل وخمسون أغورة');
    await userEvent.click(screen.getByRole('button', { name: 'طباعة' }));
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter((c) => !c.key.startsWith('GET '))).toEqual([]);
  });

  it('the payment page prints a voided expense, marked void, and a reprint in English changes labels only', async () => {
    const calls = mount('payment', '/outgoing/4/voucher');
    expect(await screen.findByRole('heading', { level: 1, name: 'سند صرف OUT-000004' })).toBeInTheDocument();
    await waitFor(() => expect(doc()).toBeInTheDocument());
    expect(doc().querySelector('[data-void-band]')).toHaveTextContent('مكرر');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'لغة الطباعة' }), 'en');
    expect(doc()).toHaveAttribute('lang', 'en');
    expect(doc().querySelector('[data-voucher-amount]')).toHaveTextContent('250.00 ₪');
    expect(doc().querySelector('[data-voucher-words]')).toHaveTextContent('Two hundred fifty shekels');
    expect(calls.filter((c) => !c.key.startsWith('GET '))).toEqual([]);
  });

  it('?print=1 prints once and drops the flag', async () => {
    const { router } = mount('receipt', '/payments/9/voucher?print=1');
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(window.print).toHaveBeenCalledTimes(1);
  });
});
