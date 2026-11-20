/**
 * Invoices (SPEC §5.14, §5.15, B6). Shared by the API (which builds and freezes the snapshot) and the web
 * (which only renders it). Every amount is an integer in minor units; sums go through `sumMinor`, which
 * refuses anything that is not a safe integer. Nothing here formats or translates: labels come from the
 * catalogs of the document language at render time.
 */
import { sumMinor } from './money.ts';
import { ALL_TEETH } from './teeth.ts';

export const INVOICE_TYPES = ['cases', 'statement', 'free'] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];

export const INVOICE_STATUSES = ['active', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const DOCUMENT_LANGUAGES = ['ar', 'en'] as const;
export type DocumentLanguage = (typeof DOCUMENT_LANGUAGES)[number];

/** Columns of the lines table of a cases invoice, in their default order (SPEC §5.14). */
export const INVOICE_COLUMNS = ['caseNo', 'patient', 'teeth', 'workType', 'shade', 'qty', 'unitPrice', 'lineTotal'] as const;
export type InvoiceColumn = (typeof INVOICE_COLUMNS)[number];

/** The renderer contract version of a stored snapshot. A new shape gets a new number; old ones still render. */
export const INVOICE_SNAPSHOT_VERSION = 1;

/** Limits (plan §2.6). */
export const MAX_CASES_PER_INVOICE = 200;
export const MAX_STATEMENT_LINES = 2000;
export const MAX_INVOICE_NOTES = 1000;
export const MAX_INVOICE_REASON = 300;
export const MAX_VOID_REASON = 300;
export const MAX_PARTY_NAME = 100;

// ------------------------------------------------------------------ snapshot

export interface InvoiceLab {
  nameAr: string | null;
  nameEn: string | null;
  phone: string | null;
  address: string | null;
  slogan: string | null;
  /** The logo frozen at issue (bytes in `document_images`); null = print the lab name only (SPEC §2.3). */
  logo: { sha256: string; mimeType: string } | null;
}

export interface InvoiceCurrency {
  code: string;
  symbol: string;
  decimals: number;
}

export type InvoiceParty =
  | { kind: 'doctor'; doctorId: number; name: string; clinic: string | null; phone: string | null }
  | { kind: 'free'; name: string };

/** The content part of the appearance, frozen at issue (I7). Colours, font size and margins are not here. */
export interface InvoiceLayout {
  columns: InvoiceColumn[];
  widths: Partial<Record<InvoiceColumn, number>>;
  showLogo: boolean;
  showBalances: boolean;
  footerText: string;
}

export interface InvoiceCaseRef {
  caseNo: number;
  patientName: string;
  receivedDate: string;
  deliveredDate: string | null;
  status: string;
  subtotal: number;
  discount: number;
  total: number;
  /** FIFO figures at issue (frozen; never in a sum of the invoice). */
  paid: number;
  remaining: number;
}

export interface InvoiceLine {
  caseNo: number;
  patientName: string;
  workTypeName: string;
  shade: string | null;
  unitPrice: number;
  qty: number;
  /** FDI teeth of the grouped lines, display order, duplicates kept (two lines on one tooth). */
  teeth: number[];
  /** Area codes (`upper_arch`, …) of grouped lines that are not on one tooth. */
  areas: string[];
  lineTotal: number;
}

export interface InvoiceTotals {
  subtotal: number;
  discount: number;
  total: number;
}

export interface StatementSnapshotLine {
  date: string;
  kind: string;
  /** Case number, or the voucher (`IN-000012`, `OUT-000003`). */
  ref: string;
  patientName: string | null;
  method: string | null;
  chequeNo: string | null;
  bank: string | null;
  boundCaseNo: number | null;
  debit: number;
  credit: number;
  running: number;
}

interface SnapshotBase {
  version: typeof INVOICE_SNAPSHOT_VERSION;
  no: number;
  issueDate: string;
  language: DocumentLanguage;
  lab: InvoiceLab;
  currency: InvoiceCurrency;
  party: InvoiceParty;
  layout: InvoiceLayout;
  notes: string | null;
}

export interface CasesInvoiceSnapshot extends SnapshotBase {
  type: 'cases';
  cases: InvoiceCaseRef[];
  lines: InvoiceLine[];
  totals: InvoiceTotals;
  /** At issue: current = the doctor's ledger balance; previous = current − total (I4). */
  balances: { previous: number; current: number; pendingCheques: number };
}

export interface StatementInvoiceSnapshot extends SnapshotBase {
  type: 'statement';
  statement: {
    from: string | null;
    to: string | null;
    openingBalance: number;
    periodOpening: number;
    lines: StatementSnapshotLine[];
    totals: { debit: number; credit: number };
    closing: number;
    pendingCheques: number;
  };
}

export interface FreeInvoiceSnapshot extends SnapshotBase {
  type: 'free';
  free: { reason: string; amount: number };
  totals: InvoiceTotals;
}

export type InvoiceSnapshot = CasesInvoiceSnapshot | StatementInvoiceSnapshot | FreeInvoiceSnapshot;

// ------------------------------------------------------------------ lines and totals

export interface InvoiceItemInput {
  caseNo: number;
  patientName: string;
  workTypeName: string;
  shade: string | null;
  unitPrice: number;
  toothNo: number | null;
  area: string | null;
}

const TOOTH_ORDER = new Map<number, number>(ALL_TEETH.map((t, i) => [t, i]));

/**
 * Printed lines grouped by case + work type + shade + unit price (SPEC §5.14), in the order the items
 * arrive (case order, then line order). `qty` counts the grouped items; `lineTotal = unitPrice × qty`.
 */
export function groupInvoiceLines(items: readonly InvoiceItemInput[]): InvoiceLine[] {
  const groups = new Map<string, InvoiceLine>();
  for (const it of items) {
    const key = JSON.stringify([it.caseNo, it.workTypeName, it.shade, it.unitPrice]);
    let g = groups.get(key);
    if (!g) {
      g = {
        caseNo: it.caseNo,
        patientName: it.patientName,
        workTypeName: it.workTypeName,
        shade: it.shade,
        unitPrice: it.unitPrice,
        qty: 0,
        teeth: [],
        areas: [],
        lineTotal: 0,
      };
      groups.set(key, g);
    }
    g.qty += 1;
    if (it.toothNo !== null) g.teeth.push(it.toothNo);
    else if (it.area !== null) g.areas.push(it.area);
  }
  const out = [...groups.values()];
  for (const g of out) {
    g.teeth.sort((a, b) => (TOOTH_ORDER.get(a) ?? 0) - (TOOTH_ORDER.get(b) ?? 0));
    g.lineTotal = sumMinor(Array.from({ length: g.qty }, () => g.unitPrice));
  }
  return out;
}

/** Totals of a cases invoice from its printed lines and the Σ of its case discounts (I2). */
export function invoiceTotals(lines: readonly InvoiceLine[], discount: number): InvoiceTotals {
  const subtotal = sumMinor(lines.map((l) => l.lineTotal));
  return { subtotal, discount, total: subtotal - discount };
}

/**
 * SPEC §5.14: the renderer recomputes the totals from the snapshot and refuses to show a document whose
 * printed total does not match. Returns the list of what disagrees (empty = consistent).
 */
export function verifySnapshotTotals(s: InvoiceSnapshot): string[] {
  const problems: string[] = [];
  try {
    if (s.type === 'cases') {
      for (const l of s.lines) {
        if (l.lineTotal !== sumMinor(Array.from({ length: l.qty }, () => l.unitPrice))) problems.push(`line:${l.caseNo}`);
      }
      const t = invoiceTotals(s.lines, s.totals.discount);
      if (t.subtotal !== s.totals.subtotal) problems.push('subtotal');
      if (t.total !== s.totals.total) problems.push('total');
      if (sumMinor(s.cases.map((c) => c.discount)) !== s.totals.discount) problems.push('discount');
      if (sumMinor(s.cases.map((c) => c.total)) !== s.totals.total) problems.push('cases');
      if (s.balances.previous + s.totals.total !== s.balances.current) problems.push('balances');
    } else if (s.type === 'free') {
      if (s.totals.subtotal !== s.free.amount || s.totals.discount !== 0 || s.totals.total !== s.free.amount) {
        problems.push('total');
      }
    } else {
      const st = s.statement;
      let running = st.periodOpening;
      for (const l of st.lines) {
        running = running + l.debit - l.credit;
        if (running !== l.running) {
          problems.push(`running:${l.ref}`);
          break;
        }
      }
      if (sumMinor(st.lines.map((l) => l.debit)) !== st.totals.debit) problems.push('debit');
      if (sumMinor(st.lines.map((l) => l.credit)) !== st.totals.credit) problems.push('credit');
      if (st.periodOpening + st.totals.debit - st.totals.credit !== st.closing) problems.push('closing');
    }
  } catch {
    problems.push('range');
  }
  return problems;
}

/** The lab name printed on a document: the one of the document language, else the other (SPEC §5.18). */
export function printedLabName(lab: Pick<InvoiceLab, 'nameAr' | 'nameEn'>, language: DocumentLanguage): string {
  const first = language === 'ar' ? lab.nameAr : lab.nameEn;
  const second = language === 'ar' ? lab.nameEn : lab.nameAr;
  return first?.trim() || second?.trim() || '';
}

// ------------------------------------------------------------------ template («مظهر الفاتورة»)

export const INVOICE_FONT_SIZES = ['s', 'm', 'l'] as const;
export type InvoiceFontSize = (typeof INVOICE_FONT_SIZES)[number];

export interface InvoiceMargins {
  top: number;
  end: number;
  bottom: number;
  start: number;
}

export interface InvoiceTemplate {
  primaryColor: string;
  headerTextColor: string;
  tableHeaderColor: string;
  fontSize: InvoiceFontSize;
  /** Millimetres, 5–30. */
  margins: InvoiceMargins;
  /** Visible columns in order; `lineTotal` is always one of them. */
  columns: InvoiceColumn[];
  /** Millimetres, 8–80; a missing column is auto width. */
  widths: Partial<Record<InvoiceColumn, number>>;
  showLogo: boolean;
  showBalances: boolean;
  /** Plain text, ≤ 300 characters, ≤ 3 lines. Never HTML. */
  footerText: string;
}

export const DEFAULT_INVOICE_TEMPLATE: InvoiceTemplate = {
  primaryColor: '#006EBD',
  headerTextColor: '#FFFFFF',
  tableHeaderColor: '#01416C',
  fontSize: 'm',
  margins: { top: 12, end: 12, bottom: 14, start: 12 },
  columns: [...INVOICE_COLUMNS],
  widths: {},
  showLogo: true,
  showBalances: true,
  footerText: '',
};

export const TEMPLATE_LIMITS = {
  marginMin: 5,
  marginMax: 30,
  widthMin: 8,
  widthMax: 80,
  footerMax: 300,
  footerLines: 3,
} as const;

/** Six-digit hex only: no names, no functions, nothing a stylesheet could interpret beyond a colour. */
export const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export interface TemplateError {
  field: string;
  code: 'invalid' | 'unknown' | 'required';
}

const TEMPLATE_KEYS = [
  'primaryColor',
  'headerTextColor',
  'tableHeaderColor',
  'fontSize',
  'margins',
  'columns',
  'widths',
  'showLogo',
  'showBalances',
  'footerText',
] as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const intIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0009\u000B-\u001F\u007F]/;

/**
 * Strict validation of a whole template (unknown keys refused at every level). Used by the API before it
 * stores anything and by the web form; the renderer trusts only a template that passed it.
 */
export function validateInvoiceTemplate(value: unknown): { ok: true; template: InvoiceTemplate } | { ok: false; errors: TemplateError[] } {
  const errors: TemplateError[] = [];
  if (!isObject(value)) return { ok: false, errors: [{ field: 'template', code: 'invalid' }] };
  for (const k of Object.keys(value)) {
    if (!(TEMPLATE_KEYS as readonly string[]).includes(k)) errors.push({ field: k, code: 'unknown' });
  }
  for (const k of TEMPLATE_KEYS) if (!(k in value)) errors.push({ field: k, code: 'required' });

  for (const k of ['primaryColor', 'headerTextColor', 'tableHeaderColor'] as const) {
    if (k in value && !(typeof value[k] === 'string' && HEX_COLOR.test(value[k] as string))) errors.push({ field: k, code: 'invalid' });
  }
  if ('fontSize' in value && !(INVOICE_FONT_SIZES as readonly unknown[]).includes(value.fontSize)) {
    errors.push({ field: 'fontSize', code: 'invalid' });
  }
  if ('margins' in value) {
    const m = value.margins;
    if (!isObject(m)) errors.push({ field: 'margins', code: 'invalid' });
    else {
      for (const k of Object.keys(m)) if (!['top', 'end', 'bottom', 'start'].includes(k)) errors.push({ field: `margins.${k}`, code: 'unknown' });
      for (const k of ['top', 'end', 'bottom', 'start']) {
        if (!intIn(m[k], TEMPLATE_LIMITS.marginMin, TEMPLATE_LIMITS.marginMax)) errors.push({ field: `margins.${k}`, code: 'invalid' });
      }
    }
  }
  if ('columns' in value) {
    const c = value.columns;
    if (
      !Array.isArray(c) ||
      c.length === 0 ||
      !c.every((x) => (INVOICE_COLUMNS as readonly unknown[]).includes(x)) ||
      new Set(c).size !== c.length ||
      !c.includes('lineTotal')
    ) {
      errors.push({ field: 'columns', code: 'invalid' });
    }
  }
  if ('widths' in value) {
    const w = value.widths;
    if (!isObject(w)) errors.push({ field: 'widths', code: 'invalid' });
    else {
      for (const [k, v] of Object.entries(w)) {
        if (!(INVOICE_COLUMNS as readonly string[]).includes(k)) errors.push({ field: `widths.${k}`, code: 'unknown' });
        else if (!intIn(v, TEMPLATE_LIMITS.widthMin, TEMPLATE_LIMITS.widthMax)) errors.push({ field: `widths.${k}`, code: 'invalid' });
      }
    }
  }
  for (const k of ['showLogo', 'showBalances'] as const) {
    if (k in value && typeof value[k] !== 'boolean') errors.push({ field: k, code: 'invalid' });
  }
  if ('footerText' in value) {
    const f = value.footerText;
    if (
      typeof f !== 'string' ||
      f.length > TEMPLATE_LIMITS.footerMax ||
      f.split('\n').length > TEMPLATE_LIMITS.footerLines ||
      CONTROL_CHARS.test(f)
    ) {
      errors.push({ field: 'footerText', code: 'invalid' });
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  const v = value as unknown as InvoiceTemplate;
  return {
    ok: true,
    template: {
      primaryColor: v.primaryColor.toUpperCase(),
      headerTextColor: v.headerTextColor.toUpperCase(),
      tableHeaderColor: v.tableHeaderColor.toUpperCase(),
      fontSize: v.fontSize,
      margins: { top: v.margins.top, end: v.margins.end, bottom: v.margins.bottom, start: v.margins.start },
      columns: [...v.columns],
      widths: Object.fromEntries(INVOICE_COLUMNS.filter((c) => v.widths[c] !== undefined).map((c) => [c, v.widths[c]])),
      showLogo: v.showLogo,
      showBalances: v.showBalances,
      footerText: v.footerText,
    },
  };
}

/** The frozen part of a template (I7). */
export const layoutOf = (t: InvoiceTemplate): InvoiceLayout => ({
  columns: [...t.columns],
  widths: { ...t.widths },
  showLogo: t.showLogo,
  showBalances: t.showBalances,
  footerText: t.footerText,
});

/** Relative luminance contrast (WCAG) between two validated hex colours; the form warns below 4.5. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string): number => {
    const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * (lin[0] ?? 0) + 0.7152 * (lin[1] ?? 0) + 0.0722 * (lin[2] ?? 0);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
