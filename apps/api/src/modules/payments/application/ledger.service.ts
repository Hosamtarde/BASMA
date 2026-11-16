import { Inject, Injectable, Logger } from '@nestjs/common';
import { DB } from '../../../shared/db/database';
import type { Database, Tx } from '../../../shared/db/database';
import { notFound } from '../../../shared/errors/common-errors';
import { offsetOf } from '../../../shared/http/pagination';
import { containsPattern } from '../../../shared/text/names';
import { addDays } from '../../../shared/time/lab-date';
import { LabCalendar } from '../../settings/application/lab-calendar.service';
import {
  allocate,
  BalanceDirection,
  breakdown,
  formatVoucher,
  PaymentMethod,
  CHEQUE_DUE_SOON_DAYS,
  directionOf,
  doctorBalance,
} from '../domain/payment-rules';
import { DoctorLedgerInput, LedgerRepository } from '../infrastructure/ledger.repository';

export interface DoctorBalance {
  doctorId: number;
  openingBalance: number;
  /** opening + Σ non-cancelled case totals */
  charges: number;
  /** Σ counted payments (SPEC §7.4) */
  received: number;
  /** Σ cheques still pending — shown apart, never reduce dues */
  pendingCheques: number;
  balance: number;
  direction: BalanceDirection;
}

export interface CaseFigures {
  paid: number;
  remaining: number;
}

/** Balances and per-case figures. Computed at read time, never stored (SPEC §7.3). */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly repo: LedgerRepository,
    private readonly calendar: LabCalendar,
  ) {}

  private figures(input: DoctorLedgerInput): DoctorBalance {
    const received = input.counted.reduce((s, p) => s + p.amount, 0);
    const balance = doctorBalance(input.opening, input.cases, received);
    return {
      doctorId: input.doctorId,
      openingBalance: input.opening,
      charges: balance + received,
      received,
      pendingCheques: input.pendingCheques,
      balance,
      direction: directionOf(balance),
    };
  }

  async balance(doctorId: number, db: Database | Tx = this.db): Promise<DoctorBalance> {
    const input = await this.repo.doctorInput(db, doctorId);
    if (!input) throw notFound();
    return this.figures(input);
  }

  /** Paid and remaining of one case: its bound payments plus its FIFO share of the unbound pool. */
  async caseFigures(
    doctorId: number,
    caseId: number,
    db: Database | Tx = this.db,
  ): Promise<CaseFigures | undefined> {
    const input = await this.repo.doctorInput(db, doctorId);
    const share = input && allocate(input.opening, input.cases, input.counted).cases.get(caseId);
    return share ? { ...share } : undefined;
  }

  /**
   * Paid and remaining for the cases of ONE page of a list: the doctors on the page are loaded in four
   * statements whatever the page size, `allocate` runs once per doctor. A cancelled case has 0 / 0.
   */
  async figuresForCases(
    rows: readonly { id: number; doctorId: number; status: string }[],
    db: Database | Tx = this.db,
  ): Promise<Map<number, CaseFigures>> {
    const out = new Map<number, CaseFigures>();
    const inputs = await this.repo.doctorInputs(db, [...new Set(rows.map((r) => r.doctorId))]);
    const allocations = new Map<number, ReturnType<typeof allocate>>();
    for (const r of rows) {
      const input = inputs.get(r.doctorId);
      if (!input || r.status === 'cancelled') {
        out.set(r.id, { paid: 0, remaining: 0 });
        continue;
      }
      let a = allocations.get(r.doctorId);
      if (!a) {
        a = allocate(input.opening, input.cases, input.counted);
        allocations.set(r.doctorId, a);
      }
      const share = a.cases.get(r.id);
      out.set(r.id, share ? { ...share } : { paid: 0, remaining: 0 });
    }
    return out;
  }

  /** Balance and direction of one page of doctors (the doctors list), one statement. */
  async balancesOf(
    doctorIds: readonly number[],
    db: Database | Tx = this.db,
  ): Promise<Map<number, { balance: number; direction: BalanceDirection }>> {
    const raw = await this.repo.balancesOf(db, doctorIds);
    const out = new Map<number, { balance: number; direction: BalanceDirection }>();
    for (const id of doctorIds) {
      const b = raw.get(id)?.balance ?? 0;
      out.set(id, { balance: b, direction: directionOf(b) });
    }
    return out;
  }

  /**
   * What makes up a doctor's balance (SPEC §5.11): the unpaid part of the opening balance, every case
   * that still owes something, the credit, and the proof that they add up to `GET /doctors/{id}/balance`.
   * Refuses to answer (500, logged) if they do not: wrong numbers must never reach the screen.
   */
  /** The breakdown of one doctor, checked against his balance; shared by the screen and the CSV. */
  async computeBreakdown(doctorId: number, db: Database | Tx = this.db) {
    const input = await this.repo.doctorInput(db, doctorId);
    if (!input) throw notFound();
    const fig = this.figures(input);
    const b = breakdown(input.opening, input.cases, input.counted);
    if (!b.tiesOut || b.balance !== fig.balance) {
      this.logger.error(
        `debt breakdown does not tie out for doctor ${doctorId}: opening ${b.openingRemaining} + cases ${b.casesRemaining} - credit ${b.credit} != balance ${fig.balance}`,
      );
      throw new Error('debt breakdown invariant failed'); // the filter answers 500 error.internal
    }
    return { input, fig, b };
  }

  /** Patient name and status of cases (the breakdown names the cases it lists). */
  caseNames(ids: readonly number[], db: Database | Tx = this.db) {
    return this.repo.casesByIds(db, ids);
  }

  async debtBreakdown(doctorId: number, page: number, pageSize: number) {
    const { input, fig, b } = await this.computeBreakdown(doctorId);
    const pageRows = b.openCases.slice(offsetOf({ page, pageSize }), offsetOf({ page, pageSize }) + pageSize);
    const [names, latest] = await Promise.all([
      this.repo.casesByIds(this.db, pageRows.map((c) => c.id)),
      this.repo.latestPayments(this.db, doctorId, 10),
    ]);
    return {
      doctor: { id: doctorId, name: input.doctorName },
      figures: fig,
      openingRemaining: b.openingRemaining,
      credit: b.credit,
      tieOut: {
        openingRemaining: b.openingRemaining,
        casesRemaining: b.casesRemaining,
        credit: b.credit,
        balance: fig.balance,
      },
      openCases: {
        count: b.openCases.length,
        remaining: b.casesRemaining,
        page,
        pageSize,
        total: b.openCases.length,
        items: pageRows.map((c) => ({
          id: c.id,
          caseNo: c.caseNo,
          patientName: names.get(c.id)?.patientName ?? '',
          receivedDate: c.receivedDate,
          status: names.get(c.id)?.status ?? '',
          total: c.total,
          paid: c.paid,
          remaining: c.remaining,
        })),
      },
      latestPayments: latest.map((p) => ({
        id: p.id,
        voucherNo: formatVoucher(p.voucherNo),
        paidAt: p.paidAt,
        method: p.method as PaymentMethod,
        amount: p.amount,
        counted: Boolean(p.counted),
        boundCaseNo: p.caseNo,
      })),
    };
  }

  async boundActiveTotal(caseId: number, db: Database | Tx = this.db): Promise<number> {
    return this.repo.boundActiveTotal(db, caseId);
  }

  async statement(
    doctorId: number,
    from: string | undefined,
    to: string | undefined,
    page: number,
    pageSize: number,
  ) {
    const input = await this.repo.doctorInput(this.db, doctorId);
    if (!input) throw notFound();
    const r = await this.repo.statement(
      this.db,
      doctorId,
      input.opening,
      { from, to },
      offsetOf({ page, pageSize }),
      pageSize,
    );
    return {
      openingBalance: input.opening,
      periodOpening: r.periodOpening,
      closing: r.periodOpening + r.periodNet,
      totals: { debit: r.totalDebit, credit: r.totalCredit },
      lines: r.lines.map((l) => ({
        ...l,
        voucher: l.kind === 'case' ? null : formatVoucher(Number(l.ref)),
      })),
      page,
      pageSize,
      total: r.total,
    };
  }

  async debts(
    direction: 'owed_to_lab' | 'owed_by_lab' | 'all',
    search: string | undefined,
    page: number,
    pageSize: number,
  ) {
    const [summary, list] = await Promise.all([
      this.repo.debtSummary(this.db),
      this.repo.debts(this.db, {
        direction,
        ...(search?.trim() ? { search: containsPattern(search.trim()) } : {}),
        offset: offsetOf({ page, pageSize }),
        limit: pageSize,
      }),
    ]);
    return {
      summary: { ...summary, net: summary.owedToLab - summary.owedByLab },
      page,
      pageSize,
      total: list.total,
      items: list.rows.map((r) => ({ ...r, direction: directionOf(r.balance) })),
    };
  }

  async summary() {
    const today = await this.calendar.today();
    return this.repo.summary(this.db, `${today.slice(0, 8)}01`, today, addDays(today, CHEQUE_DUE_SOON_DAYS));
  }
}
