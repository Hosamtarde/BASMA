import { Inject, Injectable } from '@nestjs/common';
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
      lines: r.lines,
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
