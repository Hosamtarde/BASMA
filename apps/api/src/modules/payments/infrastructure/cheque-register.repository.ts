import { Injectable } from '@nestjs/common';
import { sql, SQL } from 'drizzle-orm';
import type { Database, Tx } from '../../../shared/db/database';
import { offsetOf } from '../../../shared/http/pagination';
import { containsPattern } from '../../../shared/text/names';
import { ChequeStatus, parseVoucher, PaymentDirection } from '../domain/payment-rules';

type Executor = Database | Tx;

interface Raw {
  [key: string]: string | null;
}

export interface RegisterFilter {
  direction: PaymentDirection | 'all';
  status?: ChequeStatus;
  doctorId?: number;
  dueFrom?: string;
  dueTo?: string;
  due?: 'soon' | 'overdue';
  search?: string;
}

export interface RegisterRow {
  direction: PaymentDirection;
  chequeId: number;
  chequeNo: string;
  bank: string;
  dueDate: string;
  status: ChequeStatus;
  statusDate: string | null;
  rowVersion: number;
  paymentId: number;
  voucherNo: number;
  amount: number;
  paidAt: string;
  doctorId: number | null;
  /** Doctor name (incoming, refunds) or the payee typed on an expense. */
  partyName: string;
  categoryId: number | null;
  categoryName: string | null;
}

/**
 * The cheque register over BOTH directions (SPEC §5.13, B4b): incoming cheques reached through
 * `payments`, outgoing ones through `outgoing_payments`, each by its own owner column, so a cheque is
 * listed once with the right direction. Only cheques of active payments (B3 decision 3).
 */
@Injectable()
export class ChequeRegisterRepository {
  private union(f: RegisterFilter): SQL {
    const incoming = sql`
      SELECT 'in'::text AS direction, ch.id AS cheque_id, ch.cheque_no, ch.bank, ch.due_date, ch.status,
             ch.status_date, ch.row_version, p.id AS payment_id, p.voucher_no, p.amount, p.paid_at,
             p.doctor_id, d.name AS party_name, NULL::bigint AS category_id, NULL::text AS category_name
      FROM cheques ch
      JOIN payments p ON p.id = ch.payment_id
      JOIN doctors d ON d.id = p.doctor_id
      WHERE p.status = 'active'`;
    const outgoing = sql`
      SELECT 'out'::text AS direction, ch.id AS cheque_id, ch.cheque_no, ch.bank, ch.due_date, ch.status,
             ch.status_date, ch.row_version, o.id AS payment_id, o.voucher_no, o.amount, o.paid_at,
             o.doctor_id, COALESCE(d.name, o.payee) AS party_name, c.id AS category_id, c.name AS category_name
      FROM cheques ch
      JOIN outgoing_payments o ON o.id = ch.outgoing_payment_id
      JOIN expense_categories c ON c.id = o.category_id
      LEFT JOIN doctors d ON d.id = o.doctor_id
      WHERE o.status = 'active'`;
    if (f.direction === 'in') return incoming;
    if (f.direction === 'out') return outgoing;
    return sql`${incoming} UNION ALL ${outgoing}`;
  }

  private where(f: Omit<RegisterFilter, 'direction' | 'status'>, today: string, soonUntil: string): SQL {
    const parts: SQL[] = [sql`true`];
    if (f.doctorId) parts.push(sql`doctor_id = ${f.doctorId}`);
    if (f.dueFrom) parts.push(sql`due_date >= ${f.dueFrom}::date`);
    if (f.dueTo) parts.push(sql`due_date <= ${f.dueTo}::date`);
    if (f.due === 'overdue') parts.push(sql`status = 'pending' AND due_date < ${today}::date`);
    if (f.due === 'soon') {
      parts.push(sql`status = 'pending' AND due_date >= ${today}::date AND due_date <= ${soonUntil}::date`);
    }
    const search = f.search?.trim();
    if (search) {
      const pattern = containsPattern(search);
      const voucher = parseVoucher(search);
      const byVoucher = voucher
        ? voucher.direction
          ? sql` OR (voucher_no = ${voucher.no} AND direction = ${voucher.direction})`
          : sql` OR voucher_no = ${voucher.no}`
        : sql``;
      parts.push(
        sql`(cheque_no ILIKE ${pattern} OR bank ILIKE ${pattern} OR party_name ILIKE ${pattern}${byVoucher})`,
      );
    }
    return sql.join(parts, sql` AND `);
  }

  async list(
    db: Executor,
    f: RegisterFilter,
    today: string,
    soonUntil: string,
    page: number,
    pageSize: number,
  ): Promise<{ items: RegisterRow[]; total: number }> {
    const statusSql = f.status ? sql` AND status = ${f.status}` : sql``;
    const result = await db.execute<Raw>(sql`
      WITH reg AS (${this.union(f)})
      SELECT direction, cheque_id::text, cheque_no, bank, due_date::text, status, status_date::text,
             row_version::text, payment_id::text, voucher_no::text, amount::text, paid_at::text,
             doctor_id::text, party_name, category_id::text, category_name, count(*) OVER ()::text AS total
      FROM reg
      WHERE ${this.where(f, today, soonUntil)}${statusSql}
      ORDER BY due_date, cheque_id
      LIMIT ${pageSize} OFFSET ${offsetOf({ page, pageSize })}`);
    const num = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));
    return {
      items: result.rows.map((r) => ({
        direction: r.direction as PaymentDirection,
        chequeId: Number(r.cheque_id),
        chequeNo: r.cheque_no ?? '',
        bank: r.bank ?? '',
        dueDate: r.due_date ?? '',
        status: r.status as ChequeStatus,
        statusDate: r.status_date ?? null,
        rowVersion: Number(r.row_version),
        paymentId: Number(r.payment_id),
        voucherNo: Number(r.voucher_no),
        amount: Number(r.amount),
        paidAt: r.paid_at ?? '',
        doctorId: num(r.doctor_id),
        partyName: r.party_name ?? '',
        categoryId: num(r.category_id),
        categoryName: r.category_name ?? null,
      })),
      total: Number(result.rows[0]?.total ?? 0),
    };
  }

  /** Chip counts per status and direction, due soon / overdue and pending amounts, in one statement. */
  async summary(db: Executor, f: RegisterFilter, today: string, soonUntil: string) {
    const result = await db.execute<Raw>(sql`
      WITH reg AS (${this.union(f)})
      SELECT count(*) FILTER (WHERE status = 'pending')::text AS pending,
             count(*) FILTER (WHERE status = 'cleared')::text AS cleared,
             count(*) FILTER (WHERE status = 'returned')::text AS returned,
             count(*) FILTER (WHERE direction = 'in')::text AS dir_in,
             count(*) FILTER (WHERE direction = 'out')::text AS dir_out,
             count(*) FILTER (WHERE status = 'pending' AND due_date >= ${today}::date AND due_date <= ${soonUntil}::date)::text AS due_soon,
             count(*) FILTER (WHERE status = 'pending' AND due_date < ${today}::date)::text AS overdue,
             COALESCE(sum(amount) FILTER (WHERE status = 'pending' AND direction = 'in'), 0)::text AS pending_in,
             COALESCE(sum(amount) FILTER (WHERE status = 'pending' AND direction = 'out'), 0)::text AS pending_out
      FROM reg
      WHERE ${this.where(f, today, soonUntil)}`);
    const r = result.rows[0] ?? {};
    const n = (k: string) => Number(r[k] ?? 0);
    return {
      byStatus: { pending: n('pending'), cleared: n('cleared'), returned: n('returned') },
      byDirection: { in: n('dir_in'), out: n('dir_out') },
      dueSoon: n('due_soon'),
      overdue: n('overdue'),
      pendingAmount: { in: n('pending_in'), out: n('pending_out') },
    };
  }
}
