import { formatMoney, HEX_COLOR, INVOICE_COLUMNS, printedLabName, TEMPLATE_LIMITS, verifySnapshotTotals } from '@app/shared';
import type {
  CasesInvoiceSnapshot,
  DocumentLanguage,
  FreeInvoiceSnapshot,
  InvoiceColumn,
  InvoiceFontSize,
  InvoiceLine,
  InvoiceMargins,
  InvoiceSnapshot,
  StatementInvoiceSnapshot,
} from '@app/shared';
import type { CSSProperties, ReactNode } from 'react';
import { useMemo } from 'react';
import { i18next } from '@/i18n/i18n';
import { localeOf } from '@/i18n/format';
import './invoice-document.css';

/** The current appearance: only what may change on a reprint (SPEC §5.14: colours and fonts; plan I7). */
export interface DocumentStyle {
  primaryColor: string;
  headerTextColor: string;
  tableHeaderColor: string;
  fontSize: InvoiceFontSize;
  margins: InvoiceMargins;
}

const FONT_SIZE: Record<InvoiceFontSize, string> = { s: '9.5pt', m: '10.5pt', l: '11.5pt' };
const FALLBACK: DocumentStyle = {
  primaryColor: '#006EBD',
  headerTextColor: '#FFFFFF',
  tableHeaderColor: '#01416C',
  fontSize: 'm',
  margins: { top: 12, end: 12, bottom: 14, start: 12 },
};

/**
 * Defence in depth: the API validated the appearance, but nothing reaches CSS unless it is a six-digit hex
 * colour, a known size code or a whole number of millimetres in range — never text that a stylesheet could
 * interpret (url(), expression(), a closing brace…).
 */
export function safeStyle(s: Partial<DocumentStyle> | undefined): DocumentStyle {
  const colour = (v: unknown, d: string) => (typeof v === 'string' && HEX_COLOR.test(v) ? v : d);
  const mm = (v: unknown, d: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= TEMPLATE_LIMITS.marginMin && v <= TEMPLATE_LIMITS.marginMax ? v : d;
  const m = s?.margins;
  return {
    primaryColor: colour(s?.primaryColor, FALLBACK.primaryColor),
    headerTextColor: colour(s?.headerTextColor, FALLBACK.headerTextColor),
    tableHeaderColor: colour(s?.tableHeaderColor, FALLBACK.tableHeaderColor),
    fontSize: s?.fontSize === 's' || s?.fontSize === 'l' || s?.fontSize === 'm' ? s.fontSize : 'm',
    margins: {
      top: mm(m?.top, FALLBACK.margins.top),
      end: mm(m?.end, FALLBACK.margins.end),
      bottom: mm(m?.bottom, FALLBACK.margins.bottom),
      start: mm(m?.start, FALLBACK.margins.start),
    },
  };
}

/** The `@page` rule: A4 and the margins (start/end mapped to the sides of the document's direction). */
export function pageRule(style: DocumentStyle, dir: 'rtl' | 'ltr'): string {
  const { top, bottom, start, end } = style.margins;
  const right = dir === 'rtl' ? start : end;
  const left = dir === 'rtl' ? end : start;
  return `@page { size: A4; margin: ${top}mm ${right}mm ${bottom}mm ${left}mm; @bottom-center { content: counter(page) " / " counter(pages); font-size: 8pt; color: #5f7482; } }`;
}

type Td = (key: string, options?: Record<string, unknown>) => string;

interface Props {
  snapshot: InvoiceSnapshot;
  style?: Partial<DocumentStyle> | undefined;
  /** Object URL of the frozen logo (or, in the appearance preview, of the current one); null = name only. */
  logoUrl: string | null;
  /** Labels in this language instead of the issued one (a reprint in the other language, SPEC §6.1). */
  language?: DocumentLanguage | undefined;
  voided?: { reason: string | null } | null;
  /** Shown instead of the number in the creation preview (the number is given on issue). */
  draft?: boolean;
}

/**
 * The one renderer of every printed document (SPEC §5.15: the appearance preview, the creation preview and the
 * print view all use it). It only renders the frozen snapshot: no figure is computed here except the SPEC §5.14
 * check, which refuses to show a document whose totals do not add up. All user text is React text (escaped);
 * the only image is the lab's own logo; the product's name and logo never appear (SPEC §2.3).
 */
export function InvoiceDocument({ snapshot, style, logoUrl, language, voided, draft = false }: Props) {
  const lang: DocumentLanguage = language ?? snapshot.language;
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const td = useMemo(() => i18next.getFixedT(lang) as unknown as Td, [lang]);
  const s = safeStyle(style);
  const problems = useMemo(() => verifySnapshotTotals(snapshot), [snapshot]);
  const money = (minor: number) => {
    const text = formatMoney(minor, snapshot.currency.decimals, localeOf(lang));
    return snapshot.currency.symbol ? `${text} ${snapshot.currency.symbol}` : text;
  };

  if (problems.length > 0) {
    return (
      <div role="alert" data-invoice-check="failed" className="rounded-[10px] border border-danger bg-danger-bg p-4 font-bold text-danger">
        {td('invoiceDoc.totalsMismatch')}
      </div>
    );
  }

  const vars = {
    '--inv-primary': s.primaryColor,
    '--inv-header-text': s.headerTextColor,
    '--inv-table-header': s.tableHeaderColor,
    '--inv-font-size': FONT_SIZE[s.fontSize],
    '--inv-margin-top': `${s.margins.top}mm`,
    '--inv-margin-bottom': `${s.margins.bottom}mm`,
    '--inv-margin-start': `${s.margins.start}mm`,
    '--inv-margin-end': `${s.margins.end}mm`,
  } as CSSProperties;

  const labName = printedLabName(snapshot.lab, lang);
  const title =
    snapshot.type === 'statement'
      ? td('invoiceDoc.title.statement')
      : snapshot.type === 'free'
        ? td('invoiceDoc.title.free')
        : td('invoiceDoc.title.cases');
  const showLogo = snapshot.layout.showLogo && logoUrl !== null;

  return (
    <article
      className="inv-doc inv-sheet"
      lang={lang}
      dir={dir}
      style={vars}
      data-invoice-document={snapshot.type}
      data-invoice-check="ok"
      aria-label={title}
    >
      <style>{pageRule(s, dir)}</style>
      <div className="inv-topbar" aria-hidden="true" />
      <header className="inv-head">
        <div className="inv-lab">
          {showLogo && <img src={logoUrl} alt={td('invoiceDoc.logoAlt', { name: labName })} data-lab-logo="" />}
          <div className="inv-lab-info">
            <span className="inv-lab-name" dir="auto">
              {labName}
            </span>
            {snapshot.lab.slogan && <span dir="auto" className="block">{snapshot.lab.slogan}</span>}
            {snapshot.lab.phone && (
              <span className="block">
                {td('invoiceDoc.phone')}: <span className="inv-num">{snapshot.lab.phone}</span>
              </span>
            )}
            {snapshot.lab.address && (
              <span className="block" dir="auto">
                {td('invoiceDoc.address')}: {snapshot.lab.address}
              </span>
            )}
          </div>
        </div>
        <div className="inv-docbox">
          <h2 className="inv-title">{title}</h2>
          <dl className="inv-meta">
            <div>
              <dt>{td('invoiceDoc.number')}</dt>
              <dd className="inv-num" data-invoice-no="">
                {draft ? td('invoiceDoc.draftNumber') : String(snapshot.no)}
              </dd>
            </div>
            <div>
              <dt>{td('invoiceDoc.date')}</dt>
              <dd className="inv-num">{snapshot.issueDate}</dd>
            </div>
            {snapshot.type === 'statement' && (
              <div>
                <dt>{td('invoiceDoc.period')}</dt>
                <dd className="inv-num">
                  {snapshot.statement.from ?? td('invoiceDoc.periodStart')} → {snapshot.statement.to ?? snapshot.issueDate}
                </dd>
              </div>
            )}
          </dl>
        </div>
      </header>

      {voided && (
        <p className="inv-void" role="note" data-void-band="">
          {td('invoiceDoc.voidBand')}
          {voided.reason ? ` — ${voided.reason}` : ''}
        </p>
      )}

      <section className="inv-party" aria-label={td('invoiceDoc.party')}>
        <div>
          <small>{snapshot.party.kind === 'doctor' ? td('invoiceDoc.doctor') : td('invoiceDoc.partyName')}</small>
          <strong dir="auto">{snapshot.party.name}</strong>
        </div>
        {snapshot.party.kind === 'doctor' && snapshot.party.clinic && (
          <div>
            <small>{td('invoiceDoc.clinic')}</small>
            <strong dir="auto">{snapshot.party.clinic}</strong>
          </div>
        )}
        {snapshot.party.kind === 'doctor' && snapshot.party.phone && (
          <div>
            <small>{td('invoiceDoc.phone')}</small>
            <strong className="inv-num">{snapshot.party.phone}</strong>
          </div>
        )}
      </section>

      {snapshot.type === 'cases' && <CasesBody s={snapshot} td={td} money={money} />}
      {snapshot.type === 'statement' && <StatementBody s={snapshot} td={td} money={money} />}
      {snapshot.type === 'free' && <FreeBody s={snapshot} td={td} money={money} />}

      <div className="inv-sign">
        <div>{td('invoiceDoc.receiver')}</div>
        <div>{td('invoiceDoc.accountant')}</div>
      </div>
      <footer className="inv-footer">
        <div>
          <span dir="auto">{labName}</span>
          <span className="inv-num">{draft ? '' : `#${snapshot.no}`}</span>
        </div>
      </footer>
    </article>
  );
}

type Money = (minor: number) => string;

function NotesAndTotals({ notes, footer, td, children }: { notes: string | null; footer: string; td: Td; children: ReactNode }) {
  const text = [notes, footer].filter((x): x is string => Boolean(x && x.trim())).join('\n');
  return (
    <div className="inv-bottom">
      <div className="inv-notes">
        {text && (
          <>
            <h3>{td('invoiceDoc.notes')}</h3>
            <span dir="auto" data-invoice-notes="">
              {text}
            </span>
          </>
        )}
      </div>
      {children}
    </div>
  );
}

/** A balance: the amount without a sign, the direction in words (never a bare minus). */
function Balance({ minor, money, td }: { minor: number; money: Money; td: Td }) {
  return (
    <span>
      <span className="inv-num">{money(Math.abs(minor))}</span>
      {minor < 0 && <span className="inv-credit"> {td('invoiceDoc.creditNote')}</span>}
    </span>
  );
}

function cell(col: InvoiceColumn, l: InvoiceLine, td: Td, money: Money): ReactNode {
  switch (col) {
    case 'caseNo':
      return <span className="inv-num">{l.caseNo}</span>;
    case 'patient':
      return <span dir="auto">{l.patientName}</span>;
    case 'teeth':
      return (
        <span className="inv-num">
          {[...l.teeth.map(String), ...l.areas.map((a) => td(`caseArea.${a}`))].join(' · ')}
        </span>
      );
    case 'workType':
      return <span dir="auto">{l.workTypeName}</span>;
    case 'shade':
      return <span className="inv-num">{l.shade ?? '—'}</span>;
    case 'qty':
      return <span className="inv-num">{l.qty}</span>;
    case 'unitPrice':
      return <span className="inv-num">{money(l.unitPrice)}</span>;
    case 'lineTotal':
      return <span className="inv-num">{money(l.lineTotal)}</span>;
  }
}

const TEXT_COLUMNS: readonly InvoiceColumn[] = ['patient', 'workType'];
const MONEY_COLUMNS: readonly InvoiceColumn[] = ['unitPrice', 'lineTotal'];
const colClass = (c: InvoiceColumn) =>
  TEXT_COLUMNS.includes(c) ? 'inv-text' : MONEY_COLUMNS.includes(c) ? 'inv-money' : undefined;

function CasesBody({ s, td, money }: { s: CasesInvoiceSnapshot; td: Td; money: Money }) {
  const columns = s.layout.columns.filter((c) => (INVOICE_COLUMNS as readonly string[]).includes(c));
  return (
    <>
      <table className="inv-table" data-invoice-lines="">
        <colgroup>
          {columns.map((c) => {
            const w = s.layout.widths[c];
            return <col key={c} style={w ? { width: `${w}mm` } : undefined} />;
          })}
        </colgroup>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c} scope="col" className={colClass(c)} data-col={c}>
                {td(`invoiceDoc.col.${c}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {s.lines.map((l, i) => (
            <tr key={`${l.caseNo}-${i}`}>
              {columns.map((c) => (
                <td key={c} className={colClass(c)}>
                  {cell(c, l, td, money)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <NotesAndTotals notes={s.notes} footer={s.layout.footerText} td={td}>
        <dl className="inv-totals" data-invoice-totals="">
          <div>
            <dt>{td('invoiceDoc.subtotal')}</dt>
            <dd className="inv-num">{money(s.totals.subtotal)}</dd>
          </div>
          <div>
            <dt>{td('invoiceDoc.discount')}</dt>
            <dd className="inv-num">{money(s.totals.discount)}</dd>
          </div>
          <div className="inv-grand">
            <dt>{td('invoiceDoc.grandTotal')}</dt>
            <dd className="inv-num" data-invoice-total="">
              {money(s.totals.total)}
            </dd>
          </div>
          {s.layout.showBalances && (
            <>
              <div className="inv-sep">
                <dt>{td('invoiceDoc.previousBalance')}</dt>
                <dd>
                  <Balance minor={s.balances.previous} money={money} td={td} />
                </dd>
              </div>
              <div className="inv-bal">
                <dt>{td('invoiceDoc.currentBalance')}</dt>
                <dd>
                  <Balance minor={s.balances.current} money={money} td={td} />
                </dd>
              </div>
            </>
          )}
        </dl>
      </NotesAndTotals>
      {s.layout.showBalances && s.balances.pendingCheques > 0 && (
        <p className="inv-memo">
          {td('invoiceDoc.pendingCheques')}: <span className="inv-num">{money(s.balances.pendingCheques)}</span>
        </p>
      )}
    </>
  );
}

function StatementBody({ s, td, money }: { s: StatementInvoiceSnapshot; td: Td; money: Money }) {
  const st = s.statement;
  const describe = (l: StatementInvoiceSnapshot['statement']['lines'][number]) => {
    if (l.kind === 'case') return l.patientName ?? '';
    const method = l.method ? td(`payments.methods.${l.method}`) : '';
    const cheque = l.chequeNo ? ` ${l.chequeNo}${l.bank ? ` — ${l.bank}` : ''}` : '';
    const bound = l.boundCaseNo !== null ? ` · ${td('invoiceDoc.forCase', { caseNo: l.boundCaseNo })}` : '';
    return `${method}${cheque}${bound}`;
  };
  return (
    <>
      <table className="inv-table" data-invoice-lines="">
        <thead>
          <tr>
            <th scope="col">{td('invoiceDoc.date')}</th>
            <th scope="col" className="inv-text">
              {td('invoiceDoc.kindCol')}
            </th>
            <th scope="col">{td('invoiceDoc.reference')}</th>
            <th scope="col" className="inv-text">
              {td('invoiceDoc.description')}
            </th>
            <th scope="col" className="inv-money">
              {td('invoiceDoc.debit')}
            </th>
            <th scope="col" className="inv-money">
              {td('invoiceDoc.credit')}
            </th>
            <th scope="col" className="inv-money">
              {td('invoiceDoc.runningBalance')}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={6} className="inv-text">
              {st.from ? td('invoiceDoc.periodOpening') : td('invoiceDoc.openingBalance')}
            </td>
            <td className="inv-money">
              <Balance minor={st.periodOpening} money={money} td={td} />
            </td>
          </tr>
          {st.lines.map((l, i) => (
            <tr key={`${l.kind}-${l.ref}-${i}`}>
              <td>
                <span className="inv-num">{l.date}</span>
              </td>
              <td className="inv-text">{td(`invoiceDoc.kind.${l.kind}`)}</td>
              <td>
                <span className="inv-num">{l.ref}</span>
              </td>
              <td className="inv-text">
                <span dir="auto">{describe(l)}</span>
              </td>
              <td className="inv-money">{l.debit ? <span className="inv-num">{money(l.debit)}</span> : ''}</td>
              <td className="inv-money">{l.credit ? <span className="inv-num">{money(l.credit)}</span> : ''}</td>
              <td className="inv-money">
                <Balance minor={l.running} money={money} td={td} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="inv-text">
              {td('invoiceDoc.totals')}
            </td>
            <td className="inv-money">
              <span className="inv-num">{money(st.totals.debit)}</span>
            </td>
            <td className="inv-money">
              <span className="inv-num">{money(st.totals.credit)}</span>
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
      <NotesAndTotals notes={s.notes} footer={s.layout.footerText} td={td}>
        <dl className="inv-totals" data-invoice-totals="">
          <div className="inv-grand">
            <dt>{td('invoiceDoc.closingBalance')}</dt>
            <dd data-invoice-total="">
              <Balance minor={st.closing} money={money} td={td} />
            </dd>
          </div>
        </dl>
      </NotesAndTotals>
      {st.pendingCheques > 0 && (
        <p className="inv-memo">
          {td('invoiceDoc.pendingChequesStatement')}: <span className="inv-num">{money(st.pendingCheques)}</span>
        </p>
      )}
    </>
  );
}

function FreeBody({ s, td, money }: { s: FreeInvoiceSnapshot; td: Td; money: Money }) {
  return (
    <>
      <table className="inv-table" data-invoice-lines="">
        <thead>
          <tr>
            <th scope="col" className="inv-text">
              {td('invoiceDoc.reason')}
            </th>
            <th scope="col" className="inv-money">
              {td('invoiceDoc.amount')}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="inv-text">
              <span dir="auto">{s.free.reason}</span>
            </td>
            <td className="inv-money">
              <span className="inv-num">{money(s.free.amount)}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <NotesAndTotals notes={s.notes} footer={s.layout.footerText} td={td}>
        <dl className="inv-totals" data-invoice-totals="">
          <div className="inv-grand">
            <dt>{td('invoiceDoc.grandTotal')}</dt>
            <dd className="inv-num" data-invoice-total="">
              {money(s.totals.total)}
            </dd>
          </div>
        </dl>
      </NotesAndTotals>
    </>
  );
}
