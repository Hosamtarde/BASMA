import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { PRODUCT_NAME } from '../../../config/product';
import { CsvTable, date, empty, int, money, text } from '../../../shared/csv/csv';
import type { Cell } from '../../../shared/csv/csv';
import { DB } from '../../../shared/db/database';
import type { Database, Tx } from '../../../shared/db/database';
import { AuditParams, AuditWriter } from '../../../shared/audit/audit-writer';
import { DomainError } from '../../../shared/errors/domain-error';
import { notFound } from '../../../shared/errors/common-errors';
import { I18nService } from '../../../shared/i18n/i18n.service';
import type { Language } from '../../../shared/i18n/i18n.service';
import { LabCalendar } from '../../settings/application/lab-calendar.service';
import { SettingsRepository } from '../../settings/infrastructure/settings.repository';
import { CURRENCY, CurrencySetting } from '../../settings/domain/settings-rules';
import { LedgerService } from '../../payments/application/ledger.service';
import { directionOf, formatVoucher, isCounted } from '../../payments/domain/payment-rules';
import { LedgerRepository } from '../../payments/infrastructure/ledger.repository';
import { OutgoingFilter, OutgoingRepository } from '../../payments/infrastructure/outgoing.repository';
import { PaymentFilter, PaymentsRepository } from '../../payments/infrastructure/payments.repository';

/** One file holds at most this many data rows (SPEC §6: 20 000 cases / 50 000 payments). */
export const EXPORT_ROW_LIMIT = 50_000;
/** Rows read per statement while building a file (memory stays bounded; one snapshot for all of them). */
const BATCH = 2_000;
/** Exports per user per minute. */
export const EXPORT_RATE_PER_MINUTE = 10;

export interface ExportFile {
  fileName: string;
  body: Buffer;
  rows: number;
}

interface Built {
  table: CsvTable;
}

type Reader = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

/**
 * CSV exports of the money reports (SPEC §10, B4). Every file is built from the SAME repository
 * queries as the screen it belongs to, inside one read-only REPEATABLE READ transaction (rows and
 * totals come from one snapshot), is audited before it is handed out, and is capped in size.
 */
@Injectable()
export class ExportsService {
  private readonly recent = new Map<number, number[]>();
  /** Test seams: the caps are constants in production. */
  rowLimit = EXPORT_ROW_LIMIT;
  ratePerMinute = EXPORT_RATE_PER_MINUTE;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly i18n: I18nService,
    private readonly audit: AuditWriter,
    private readonly settings: SettingsRepository,
    private readonly calendar: LabCalendar,
    private readonly ledger: LedgerService,
    private readonly ledgerRepo: LedgerRepository,
    private readonly paymentsRepo: PaymentsRepository,
    private readonly outgoingRepo: OutgoingRepository,
  ) {}

  // ---------------------------------------------------------------- public reports

  async debts(
    userId: number,
    q: { direction: 'owed_to_lab' | 'owed_by_lab' | 'all'; search?: string; pattern?: string },
    lang: Language,
  ): Promise<ExportFile> {
    return this.produce(userId, 'debts', lang, 'debts', {
      direction: q.direction,
      hasSearch: Boolean(q.search),
    }, async (tx, t, currency) => {
      const filter = { direction: q.direction, ...(q.pattern ? { search: q.pattern } : {}) };
      const first = await this.ledgerRepo.debts(tx, { ...filter, offset: 0, limit: BATCH });
      this.assertWithinLimit(first.total);
      const rows = [...first.rows];
      for (let offset = BATCH; offset < first.total; offset += BATCH) {
        rows.push(...(await this.ledgerRepo.debts(tx, { ...filter, offset, limit: BATCH })).rows);
      }
      const table = new CsvTable([
        t('csv.col.doctor'),
        t('csv.col.direction'),
        withCurrency(t, 'csv.col.amount', currency),
        withCurrency(t, 'csv.col.balance', currency),
        withCurrency(t, 'csv.col.pending_cheques', currency),
      ]);
      for (const r of rows) {
        table.add([
          text(r.name),
          text(t(`csv.direction.${directionOf(r.balance)}`)),
          money(Math.abs(r.balance), currency.decimals),
          money(r.balance, currency.decimals),
          money(r.pendingCheques, currency.decimals),
        ]);
      }
      return { table };
    });
  }

  async breakdown(userId: number, doctorId: number, lang: Language): Promise<ExportFile> {
    return this.produce(userId, 'debt_breakdown', lang, `debt-breakdown-${doctorId}`, { doctorId }, async (tx, t, currency) => {
      const { b } = await this.ledger.computeBreakdown(doctorId, tx);
      this.assertWithinLimit(b.openCases.length);
      const names = await this.ledger.caseNames(
        b.openCases.map((c) => c.id),
        tx,
      );
      const table = new CsvTable([
        t('csv.col.type'),
        t('csv.col.case_no'),
        t('csv.col.patient'),
        t('csv.col.received'),
        t('csv.col.status'),
        withCurrency(t, 'csv.col.total', currency),
        withCurrency(t, 'csv.col.paid', currency),
        withCurrency(t, 'csv.col.remaining', currency),
        // B4b: last, so the B4 column positions stay; filled on refund rows only.
        t('csv.col.voucher'),
      ]);
      const d = currency.decimals;
      // The Remaining column sums to the doctor balance: open it in Excel and select the column.
      if (b.openingRemaining > 0) {
        table.add([text(t('csv.type.opening')), empty, empty, empty, empty, empty, empty, money(b.openingRemaining, d), empty]);
      }
      for (const c of b.openCases) {
        const info = names.get(c.id);
        table.add([
          text(t('csv.type.case')),
          int(c.caseNo),
          text(info?.patientName ?? ''),
          date(c.receivedDate),
          text(info ? t(`case.status.${info.status}`) : ''),
          money(c.total, d),
          money(c.paid, d),
          money(c.remaining, d),
          empty,
        ]);
      }
      // A refund the doctor's money no longer covers (B4b): date = its effective date, paid = covered.
      for (const r of b.openRefunds) {
        table.add([
          text(t('csv.type.refund')),
          empty,
          empty,
          date(r.date),
          empty,
          money(r.amount, d),
          money(r.covered, d),
          money(r.remaining, d),
          text(formatVoucher(r.voucherNo, 'out')),
        ]);
      }
      if (b.credit > 0) {
        table.add([text(t('csv.type.credit')), empty, empty, empty, empty, empty, empty, money(-b.credit, d), empty]);
      }
      return { table };
    });
  }

  async statement(
    userId: number,
    doctorId: number,
    range: { from?: string; to?: string },
    withPatients: boolean,
    lang: Language,
  ): Promise<ExportFile> {
    return this.produce(
      userId,
      'statement',
      lang,
      `statement-${doctorId}${range.from ? `-from-${range.from}` : ''}${range.to ? `-to-${range.to}` : ''}`,
      { doctorId, from: range.from ?? null, to: range.to ?? null },
      async (tx, t, currency) => {
        const input = await this.ledgerRepo.doctorInput(tx, doctorId);
        if (!input) throw notFound();
        const first = await this.ledgerRepo.statement(tx, doctorId, input.opening, range, 0, BATCH);
        this.assertWithinLimit(first.total);
        const lines = [...first.lines];
        for (let offset = BATCH; offset < first.total; offset += BATCH) {
          lines.push(...(await this.ledgerRepo.statement(tx, doctorId, input.opening, range, offset, BATCH)).lines);
        }
        const d = currency.decimals;
        const table = new CsvTable([
          t('csv.col.date'),
          t('csv.col.type'),
          t('csv.col.reference'),
          t('csv.col.description'),
          withCurrency(t, 'csv.col.debit', currency),
          withCurrency(t, 'csv.col.credit', currency),
          withCurrency(t, 'csv.col.balance', currency),
        ]);
        table.add([
          range.from ? date(range.from) : empty,
          text(t('csv.type.period_opening')),
          empty,
          empty,
          empty,
          empty,
          money(first.periodOpening, d),
        ]);
        for (const l of lines) {
          const isCase = l.kind === 'case';
          const description = isCase
            ? withPatients
              ? (l.patientName ?? '')
              : ''
            : [l.method ? t(`payment.method.${l.method}`) : '', l.chequeNo ?? '', l.bank ?? '']
                .filter((p) => p !== '')
                .join(' · ');
          table.add([
            date(l.date),
            text(t(`csv.type.${l.kind}`)),
            text(
              isCase
                ? l.ref
                : formatVoucher(Number(l.ref), l.kind === 'refund' || l.kind === 'refund_cheque_return' ? 'out' : 'in'),
            ),
            text(description),
            money(l.debit, d),
            money(l.credit, d),
            money(l.running, d),
          ]);
        }
        return { table };
      },
    );
  }

  async payments(
    userId: number,
    f: PaymentFilter,
    lang: Language,
  ): Promise<ExportFile> {
    const { search, ...rest } = f;
    return this.produce(userId, 'payments', lang, 'payments', { ...clean(rest), hasSearch: Boolean(search) }, async (tx, t, currency) => {
      // The repository escapes and wraps the search text itself.
      const filter: PaymentFilter = { ...rest, ...(search ? { search } : {}) };
      const first = await this.paymentsRepo.list(tx, filter, 1, BATCH);
      this.assertWithinLimit(first.total);
      const items = [...first.items];
      for (let page = 2; items.length < first.total; page += 1) {
        const next = await this.paymentsRepo.list(tx, filter, page, BATCH);
        if (next.items.length === 0) break;
        items.push(...next.items);
      }
      const d = currency.decimals;
      const table = new CsvTable([
        t('csv.col.voucher'),
        t('csv.col.payment_date'),
        t('csv.col.effective_date'),
        t('csv.col.doctor'),
        t('csv.col.method'),
        t('csv.col.cheque_no'),
        t('csv.col.bank'),
        t('csv.col.due_date'),
        t('csv.col.case_no'),
        withCurrency(t, 'csv.col.amount', currency),
        t('csv.col.status'),
        t('csv.col.counted'),
        t('csv.col.cheque_status'),
        t('csv.col.void_reason'),
        t('csv.col.notes'),
      ]);
      for (const p of items) {
        const counted = isCounted({ status: p.status, method: p.method, chequeStatus: p.cheque?.status ?? null });
        const effective: Cell = !counted ? empty : p.cheque ? date(p.cheque.statusDate) : date(p.paidAt);
        table.add([
          text(formatVoucher(p.voucherNo)),
          date(p.paidAt),
          effective,
          text(p.doctorName),
          text(t(`payment.method.${p.method}`)),
          text(p.cheque?.chequeNo ?? ''),
          text(p.cheque?.bank ?? ''),
          p.cheque ? date(p.cheque.dueDate) : empty,
          p.caseNo === null ? empty : int(p.caseNo),
          money(p.amount, d),
          text(t(`payment.status.${p.status}`)),
          text(t(counted ? 'csv.yes' : 'csv.no')),
          text(p.cheque ? t(`cheque.status.${p.cheque.status}`) : ''),
          text(p.voidReason ?? ''),
          text(p.notes ?? ''),
        ]);
      }
      return { table };
    });
  }

  /** Outgoing payments (the expenses report table, B4b §4.2) with the filters of the list. */
  async outgoingPayments(userId: number, f: OutgoingFilter, lang: Language): Promise<ExportFile> {
    const { search, ...rest } = f;
    return this.produce(
      userId,
      'outgoing_payments',
      lang,
      'outgoing-payments',
      { ...clean(rest), hasSearch: Boolean(search) },
      async (tx, t, currency) => {
        const filter: OutgoingFilter = { ...rest, ...(search ? { search } : {}) };
        const first = await this.outgoingRepo.list(tx, filter, 1, BATCH);
        this.assertWithinLimit(first.total);
        const items = [...first.items];
        for (let page = 2; items.length < first.total; page += 1) {
          const next = await this.outgoingRepo.list(tx, filter, page, BATCH);
          if (next.items.length === 0) break;
          items.push(...next.items);
        }
        const d = currency.decimals;
        const table = new CsvTable([
          t('csv.col.voucher'),
          t('csv.col.payment_date'),
          t('csv.col.paid_out_date'),
          t('csv.col.category'),
          t('csv.col.payee'),
          t('csv.col.method'),
          t('csv.col.cheque_no'),
          t('csv.col.bank'),
          t('csv.col.due_date'),
          withCurrency(t, 'csv.col.amount', currency),
          t('csv.col.status'),
          t('csv.col.counted'),
          t('csv.col.cheque_status'),
          t('csv.col.void_reason'),
          t('csv.col.notes'),
        ]);
        for (const p of items) {
          const counted = isCounted({ status: p.status, method: p.method, chequeStatus: p.cheque?.status ?? null });
          const effective: Cell = !counted ? empty : p.cheque ? date(p.cheque.statusDate) : date(p.paidAt);
          table.add([
            text(formatVoucher(p.voucherNo, 'out')),
            date(p.paidAt),
            effective,
            text(p.categoryName),
            text(p.kind === 'doctor_refund' ? (p.doctorName ?? '') : (p.payee ?? '')),
            text(t(`payment.method.${p.method}`)),
            text(p.cheque?.chequeNo ?? ''),
            text(p.cheque?.bank ?? ''),
            p.cheque ? date(p.cheque.dueDate) : empty,
            money(p.amount, d),
            text(t(`payment.status.${p.status}`)),
            text(t(counted ? 'csv.yes' : 'csv.no')),
            text(p.cheque ? t(`cheque.status.${p.cheque.status}`) : ''),
            text(p.voidReason ?? ''),
            text(p.notes ?? ''),
          ]);
        }
        return { table };
      },
    );
  }

  /**
   * The expenses report by category (SPEC §5.9 «تقرير المصاريف» by category): one row per category with
   * activity in the period, counted money on its effective date, pending cheques as memo. No totals row
   * (B4 rule: it would break sorting and pivoting).
   */
  async expensesByCategory(userId: number, range: { from?: string; to?: string }, lang: Language): Promise<ExportFile> {
    return this.produce(
      userId,
      'expenses_by_category',
      lang,
      `expenses-by-category${range.from ? `-from-${range.from}` : ''}${range.to ? `-to-${range.to}` : ''}`,
      { from: range.from ?? null, to: range.to ?? null },
      async (tx, t, currency) => {
        const s = await this.outgoingRepo.summary(tx, range);
        this.assertWithinLimit(s.byCategory.length);
        const d = currency.decimals;
        const table = new CsvTable([
          t('csv.col.category'),
          t('csv.col.kind'),
          t('csv.col.count'),
          withCurrency(t, 'csv.col.counted_amount', currency),
          t('csv.col.pending_out_cheques_count'),
          withCurrency(t, 'csv.col.pending_out_cheques', currency),
        ]);
        for (const c of s.byCategory) {
          table.add([
            text(c.name),
            text(t(`outgoing.kind.${c.kind}`)),
            int(c.count),
            money(c.amount, d),
            int(c.pendingCheques.count),
            money(c.pendingCheques.amount, d),
          ]);
        }
        return { table };
      },
    );
  }

  // ---------------------------------------------------------------- shared flow

  private async produce(
    userId: number,
    report: string,
    lang: Language,
    namePart: string,
    filters: Record<string, string | number | boolean | null>,
    build: (tx: Tx, t: (key: string) => string, currency: CurrencySetting) => Promise<Built>,
  ): Promise<ExportFile> {
    this.checkRate(userId);
    const t = (key: string) => this.i18n.translate(key, {}, lang);
    const today = await this.calendar.today();
    const read: Reader = (fn) => this.db.transaction(fn, { isolationLevel: 'repeatable read', accessMode: 'read only' });
    const { table } = await read(async (tx) => {
      const currency = (await this.settings.get<CurrencySetting>(tx, CURRENCY))?.value ?? {
        code: '',
        symbol: '',
        decimals: 2,
      };
      return build(tx, t, currency);
    });
    // Fail closed: no file leaves the server without its audit entry.
    const params: AuditParams = { report, format: 'csv', rows: table.rows, language: lang };
    for (const [k, v] of Object.entries(filters)) params[`filter_${k}`] = v;
    await this.db.transaction(async (tx) => {
      await this.audit.write(tx, {
        userId,
        action: 'export.created',
        entity: 'export',
        entityId: report,
        params,
      });
    });
    return { fileName: `${fileStem()}-${namePart}-${today}.csv`, body: table.toBuffer(), rows: table.rows };
  }

  private assertWithinLimit(rows: number): void {
    if (rows > this.rowLimit) {
      throw new DomainError('error.export.too_large', HttpStatus.UNPROCESSABLE_ENTITY, {
        rows,
        limit: this.rowLimit,
      });
    }
  }

  /** At most EXPORT_RATE_PER_MINUTE files per user per minute (in memory; one API process, ADR-0010). */
  private checkRate(userId: number): void {
    const now = Date.now();
    const recent = (this.recent.get(userId) ?? []).filter((at) => now - at < 60_000);
    if (recent.length >= this.ratePerMinute) {
      this.recent.set(userId, recent);
      throw new DomainError('error.rate_limited', HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(now);
    this.recent.set(userId, recent);
  }
}

/** ASCII-only product stem for file names (never a doctor's name, never Arabic). */
function fileStem(): string {
  return PRODUCT_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export';
}

function withCurrency(t: (key: string) => string, key: string, currency: CurrencySetting): string {
  return t('csv.with_currency').replace('{label}', t(key)).replace('{currency}', currency.code);
}

function clean(o: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v;
  }
  return out;
}
