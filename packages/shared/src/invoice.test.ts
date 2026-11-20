import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  contrastRatio,
  DEFAULT_INVOICE_TEMPLATE,
  groupInvoiceLines,
  invoiceTotals,
  printedLabName,
  validateInvoiceTemplate,
  verifySnapshotTotals,
  type CasesInvoiceSnapshot,
  type InvoiceItemInput,
  type StatementInvoiceSnapshot,
} from './invoice.ts';

const item = (o: Partial<InvoiceItemInput>): InvoiceItemInput => ({
  caseNo: 1,
  patientName: 'P',
  workTypeName: 'Zirconia',
  shade: 'A2',
  unitPrice: 10000,
  toothNo: 11,
  area: null,
  ...o,
});

describe('groupInvoiceLines', () => {
  it('groups by case + work type + shade + unit price and counts the teeth', () => {
    const lines = groupInvoiceLines([
      item({ toothNo: 21 }),
      item({ toothNo: 11 }),
      item({ toothNo: 12, unitPrice: 9000 }),
      item({ toothNo: 13, shade: 'A3' }),
      item({ caseNo: 2, toothNo: 11 }),
      item({ toothNo: null, area: 'upper_arch', workTypeName: 'Night guard' }),
    ]);
    assert.equal(lines.length, 5);
    assert.deepEqual(lines[0], {
      caseNo: 1,
      patientName: 'P',
      workTypeName: 'Zirconia',
      shade: 'A2',
      unitPrice: 10000,
      qty: 2,
      teeth: [11, 21],
      areas: [],
      lineTotal: 20000,
    });
    assert.equal(lines[1]?.lineTotal, 9000);
    assert.deepEqual(lines[4]?.areas, ['upper_arch']);
    assert.deepEqual(lines[4]?.teeth, []);
  });

  it('keeps FDI display order (18 … 11, 21 … 28) and duplicates of one tooth', () => {
    const [line] = groupInvoiceLines([item({ toothNo: 21 }), item({ toothNo: 18 }), item({ toothNo: 11 }), item({ toothNo: 11 })]);
    assert.deepEqual(line?.teeth, [18, 11, 11, 21]);
    assert.equal(line?.qty, 4);
  });

  it('treats a null shade as its own group', () => {
    assert.equal(groupInvoiceLines([item({ shade: null }), item({ shade: 'A2' })]).length, 2);
  });
});

describe('invoiceTotals', () => {
  it('subtotal = Σ line totals, total = subtotal − Σ case discounts', () => {
    const lines = groupInvoiceLines([item({}), item({ toothNo: 12 }), item({ caseNo: 2 })]);
    assert.deepEqual(invoiceTotals(lines, 2000), { subtotal: 30000, discount: 2000, total: 28000 });
  });

  it('refuses unsafe numbers instead of rounding', () => {
    assert.throws(() => invoiceTotals([{ ...groupInvoiceLines([item({})])[0]!, lineTotal: 0.5 }], 0));
  });
});

const casesSnapshot = (): CasesInvoiceSnapshot => {
  const lines = groupInvoiceLines([item({}), item({ caseNo: 2, toothNo: 21, unitPrice: 20000 })]);
  return {
    version: 1,
    type: 'cases',
    no: 1001,
    issueDate: '2026-11-20',
    language: 'ar',
    lab: { nameAr: 'مختبر', nameEn: null, phone: null, address: null, slogan: null, logo: null },
    currency: { code: 'ILS', symbol: '₪', decimals: 2 },
    party: { kind: 'doctor', doctorId: 1, name: 'D', clinic: null, phone: null },
    layout: { columns: ['lineTotal'], widths: {}, showLogo: true, showBalances: true, footerText: '' },
    notes: null,
    cases: [
      {
        caseNo: 1,
        patientName: 'P',
        receivedDate: '2026-11-01',
        deliveredDate: null,
        status: 'ready',
        subtotal: 10000,
        discount: 0,
        total: 10000,
        paid: 0,
        remaining: 10000,
      },
      {
        caseNo: 2,
        patientName: 'P',
        receivedDate: '2026-11-01',
        deliveredDate: null,
        status: 'ready',
        subtotal: 20000,
        discount: 1000,
        total: 19000,
        paid: 0,
        remaining: 19000,
      },
    ],
    lines,
    totals: invoiceTotals(lines, 1000),
    balances: { previous: 1000, current: 30000, pendingCheques: 0 },
  };
};

describe('verifySnapshotTotals (the renderer’s check, SPEC §5.14)', () => {
  it('accepts a consistent cases snapshot', () => {
    assert.deepEqual(verifySnapshotTotals(casesSnapshot()), []);
  });

  it('names what disagrees', () => {
    const s = casesSnapshot();
    s.totals.total += 1;
    assert.ok(verifySnapshotTotals(s).includes('total'));
    const t = casesSnapshot();
    t.lines[0]!.lineTotal = 1;
    assert.ok(verifySnapshotTotals(t).includes('line:1'));
    const b = casesSnapshot();
    b.balances.previous = 0;
    assert.deepEqual(verifySnapshotTotals(b), ['balances']);
  });

  it('checks the running balance and closing of a statement', () => {
    const base = casesSnapshot();
    const s: StatementInvoiceSnapshot = {
      version: 1,
      type: 'statement',
      no: base.no,
      issueDate: base.issueDate,
      language: base.language,
      lab: base.lab,
      currency: base.currency,
      party: base.party,
      layout: base.layout,
      notes: null,
      statement: {
        from: null,
        to: null,
        openingBalance: 500,
        periodOpening: 500,
        lines: [
          {
            date: '2026-11-01',
            kind: 'case',
            ref: '1',
            patientName: 'P',
            method: null,
            chequeNo: null,
            bank: null,
            boundCaseNo: null,
            debit: 10000,
            credit: 0,
            running: 10500,
          },
          {
            date: '2026-11-02',
            kind: 'payment',
            ref: 'IN-000001',
            patientName: null,
            method: 'cash',
            chequeNo: null,
            bank: null,
            boundCaseNo: null,
            debit: 0,
            credit: 4000,
            running: 6500,
          },
        ],
        totals: { debit: 10000, credit: 4000 },
        closing: 6500,
        pendingCheques: 0,
      },
    };
    assert.deepEqual(verifySnapshotTotals(s), []);
    s.statement.closing = 6501;
    assert.deepEqual(verifySnapshotTotals(s), ['closing']);
  });
});

describe('printedLabName', () => {
  it('prints the name of the document language, else the other one', () => {
    assert.equal(printedLabName({ nameAr: 'مختبر', nameEn: 'Lab' }, 'ar'), 'مختبر');
    assert.equal(printedLabName({ nameAr: 'مختبر', nameEn: 'Lab' }, 'en'), 'Lab');
    assert.equal(printedLabName({ nameAr: null, nameEn: 'Lab' }, 'ar'), 'Lab');
    assert.equal(printedLabName({ nameAr: '  ', nameEn: null }, 'en'), '');
  });
});

describe('validateInvoiceTemplate', () => {
  it('accepts the default template', () => {
    assert.deepEqual(validateInvoiceTemplate(DEFAULT_INVOICE_TEMPLATE), { ok: true, template: DEFAULT_INVOICE_TEMPLATE });
  });

  const bad = (patch: Record<string, unknown>) => validateInvoiceTemplate({ ...DEFAULT_INVOICE_TEMPLATE, ...patch });

  it('refuses injection in every structured field', () => {
    const attacks = [
      '<script>alert(1)</script>',
      'red;background:url(javascript:alert(1))',
      'url(x)',
      'javascript:alert(1)',
      '" onload="alert(1)',
      'expression(alert(1))',
    ];
    for (const a of attacks) {
      for (const field of ['primaryColor', 'headerTextColor', 'tableHeaderColor', 'fontSize']) {
        assert.equal(bad({ [field]: a }).ok, false, `${field} = ${a}`);
      }
      assert.equal(bad({ columns: ['lineTotal', a] }).ok, false);
      assert.equal(bad({ widths: { [a]: 20 } }).ok, false);
      assert.equal(bad({ widths: { qty: a } }).ok, false);
      assert.equal(bad({ margins: { ...DEFAULT_INVOICE_TEMPLATE.margins, top: a } }).ok, false);
      assert.equal(bad({ showLogo: a }).ok, false);
      assert.equal(bad({ showBalances: a }).ok, false);
    }
  });

  it('keeps footer text as plain text (it is never parsed) within its limits', () => {
    assert.equal(bad({ footerText: '<img src=x onerror="alert(1)"> url(javascript:x)' }).ok, true);
    assert.equal(bad({ footerText: 'x'.repeat(301) }).ok, false);
    assert.equal(bad({ footerText: 'a\nb\nc\nd' }).ok, false);
    assert.equal(bad({ footerText: 'a\u0000b' }).ok, false);
  });

  it('refuses unknown keys, missing keys, out-of-range numbers and a hidden total column', () => {
    assert.equal(bad({ extra: 1 }).ok, false);
    const missing: Record<string, unknown> = { ...DEFAULT_INVOICE_TEMPLATE };
    delete missing.footerText;
    assert.equal(validateInvoiceTemplate(missing).ok, false);
    assert.equal(bad({ margins: { top: 4, end: 12, bottom: 12, start: 12 } }).ok, false);
    assert.equal(bad({ margins: { top: 12, end: 12, bottom: 12, start: 12, left: 3 } }).ok, false);
    assert.equal(bad({ widths: { qty: 7 } }).ok, false);
    assert.equal(bad({ widths: { qty: 81 } }).ok, false);
    assert.equal(bad({ widths: { qty: 12.5 } }).ok, false);
    assert.equal(bad({ columns: ['caseNo'] }).ok, false);
    assert.equal(bad({ columns: ['lineTotal', 'lineTotal'] }).ok, false);
    assert.equal(bad({ columns: [] }).ok, false);
  });

  it('normalises colours to upper case', () => {
    const r = bad({ primaryColor: '#abcdef' });
    assert.ok(r.ok && r.template.primaryColor === '#ABCDEF');
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for equal colours', () => {
    assert.equal(Math.round(contrastRatio('#000000', '#FFFFFF')), 21);
    assert.equal(contrastRatio('#123456', '#123456'), 1);
  });
});
