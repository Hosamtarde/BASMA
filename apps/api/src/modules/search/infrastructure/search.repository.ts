import { Injectable } from '@nestjs/common';
import { parseVoucher } from '../../payments/domain/payment-rules';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { Database, Tx } from '../../../shared/db/database';
import { searchTokens } from '../../../shared/text/search-fold';
import { containsPattern } from '../../../shared/text/names';

type Executor = Database | Tx;
interface Raw {
  [key: string]: string | null;
}

/** How the folded query is matched: the whole phrase, every word, or any word (the "closest" tiers). */
export type MatchMode = 'phrase' | 'all' | 'any';

export interface Query {
  /** What the user typed, trimmed. */
  raw: string;
  /** Folded for comparison (never stored). */
  folded: string;
  tokens: string[];
}

export const toQuery = (raw: string, folded: string): Query => ({ raw, folded, tokens: searchTokens(folded) });

const like = (expr: SQL, pattern: string): SQL => sql`${expr} LIKE ${containsPattern(pattern)}`;

/** WHERE for a folded column expression in one match mode. */
function matchSql(expr: SQL, q: Query, mode: MatchMode): SQL {
  if (mode === 'phrase' || q.tokens.length === 0) return like(expr, q.folded);
  const parts = q.tokens.map((t) => like(expr, t));
  return mode === 'all' ? sql`(${sql.join(parts, sql` AND `)})` : sql`(${sql.join(parts, sql` OR `)})`;
}

/** How well the folded text matches: exact 0, starts-with 1, contains 2 (any-mode: by words matched). */
function rankSql(expr: SQL, q: Query, mode: MatchMode): SQL {
  const base = sql`CASE WHEN ${expr} = ${q.folded} THEN 0 WHEN ${expr} LIKE ${`${containsPattern(q.folded).slice(1)}`} THEN 1 ELSE 2 END`;
  if (mode !== 'any' || q.tokens.length === 0) return base;
  const matched = sql.join(
    q.tokens.map((t) => sql`(CASE WHEN ${like(expr, t)} THEN 1 ELSE 0 END)`),
    sql` + `,
  );
  return sql`(${base} * 100 - (${matched}))`;
}

export interface DoctorHit {
  id: number;
  name: string;
  clinic: string | null;
  active: boolean;
}
export interface CaseHit {
  id: number;
  caseNo: number;
  patientName: string;
  doctorName: string;
  status: string;
  receivedDate: string;
}
export interface PaymentHit {
  id: number;
  voucherNo: number;
  doctorName: string;
  method: string;
  amount: number;
  paidAt: string;
  status: string;
}
/** B4b: an outgoing payment found by its OUT- voucher or its cheque number. */
export interface OutgoingHit {
  id: number;
  voucherNo: number;
  kind: string;
  categoryName: string;
  /** The payee of an expense, or the doctor of a refund. */
  partyName: string;
  method: string;
  amount: number;
  paidAt: string;
  status: string;
}
export interface Group<T> {
  total: number;
  closest: boolean;
  items: T[];
}

/**
 * Global search queries (SPEC §5.17). Contains-matching on folded Arabic text with the "closest"
 * tiers of the plan (all words, then any word). No pg_trgm: at the SPEC scale a sequential scan of
 * a few thousand short strings fits the budget (production-readiness #15, measured in B4).
 */
@Injectable()
export class SearchRepository {
  /** Runs the phrase tier, then the word tiers for multi-word queries, until something is found. */
  private async tiered<T>(q: Query, run: (mode: MatchMode) => Promise<{ items: T[]; total: number }>): Promise<Group<T>> {
    const modes: MatchMode[] = q.tokens.length > 1 ? ['phrase', 'all', 'any'] : ['phrase'];
    let last: { items: T[]; total: number } = { items: [], total: 0 };
    for (const [i, mode] of modes.entries()) {
      last = await run(mode);
      if (last.total > 0) return { ...last, closest: i > 0 };
    }
    return { ...last, closest: false };
  }

  async doctors(db: Executor, q: Query, limit: number): Promise<Group<DoctorHit>> {
    // Generated column: folded name + clinic, computed once per write instead of per search (0006).
    const text = sql`d.search_text`;
    const name = text;
    return this.tiered(q, async (mode) => {
      const phone = mode === 'phrase' ? sql` OR d.phone ILIKE ${containsPattern(q.raw)}` : sql``;
      const r = await db.execute<Raw>(sql`
        SELECT d.id::text AS id, d.name, d.clinic, d.active::text AS active, count(*) OVER ()::text AS total
        FROM doctors d
        WHERE (${matchSql(text, q, mode)}${phone})
        ORDER BY ${rankSql(name, q, mode)}, lower(d.name), d.id
        LIMIT ${limit}`);
      return {
        total: Number(r.rows[0]?.total ?? 0),
        items: r.rows.map((x) => ({
          id: Number(x.id),
          name: x.name ?? '',
          clinic: x.clinic ?? null,
          active: x.active === 'true',
        })),
      };
    });
  }

  async cases(db: Executor, q: Query, limit: number): Promise<Group<CaseHit>> {
    const patient = sql`c.patient_search`;
    const caseNo = /^\d{1,15}$/.test(q.raw) ? Number(q.raw) : null;
    return this.tiered(q, async (mode) => {
      const byNo = caseNo !== null && mode === 'phrase' ? sql` OR c.case_no = ${caseNo}` : sql``;
      const r = await db.execute<Raw>(sql`
        SELECT c.id::text AS id, c.case_no::text AS case_no, c.patient_name, d.name AS doctor_name, c.status,
               c.received_date::text AS received_date, count(*) OVER ()::text AS total
        FROM cases c JOIN doctors d ON d.id = c.doctor_id
        WHERE (${matchSql(patient, q, mode)}${byNo})
        ORDER BY ${caseNo !== null ? sql`(CASE WHEN c.case_no = ${caseNo} THEN 0 ELSE 1 END),` : sql``}
                 ${rankSql(patient, q, mode)}, c.received_date DESC, c.id DESC
        LIMIT ${limit}`);
      return {
        total: Number(r.rows[0]?.total ?? 0),
        items: r.rows.map((x) => ({
          id: Number(x.id),
          caseNo: Number(x.case_no),
          patientName: x.patient_name ?? '',
          doctorName: x.doctor_name ?? '',
          status: x.status ?? '',
          receivedDate: x.received_date ?? '',
        })),
      };
    });
  }

  /** Vouchers (IN-000012, in12, 12) and cheque numbers; doctor names are covered by the doctors group. */
  /**
   * B4b: outgoing payments by voucher (`OUT-000012`, `out12`, or bare digits — which also match IN-) or
   * by the lab's cheque number. Reads only `outgoing_payments` and its own cheques.
   */
  async outgoing(db: Executor, q: Query, limit: number): Promise<Group<OutgoingHit>> {
    const voucher = parseVoucher(q.raw);
    const voucherNo = voucher && voucher.direction !== 'in' ? voucher.no : null;
    const chequePattern = containsPattern(q.raw);
    const r = await db.execute<Raw>(sql`
      SELECT o.id::text AS id, o.voucher_no::text AS voucher_no, o.kind, c.name AS category_name,
             COALESCE(d.name, o.payee) AS party_name, o.method, o.amount::text AS amount,
             o.paid_at::text AS paid_at, o.status, count(*) OVER ()::text AS total
      FROM outgoing_payments o
      JOIN expense_categories c ON c.id = o.category_id
      LEFT JOIN doctors d ON d.id = o.doctor_id
      LEFT JOIN cheques och ON och.outgoing_payment_id = o.id
      WHERE (${voucherNo !== null ? sql`o.voucher_no = ${voucherNo} OR ` : sql``}och.cheque_no ILIKE ${chequePattern})
      ORDER BY ${voucherNo !== null ? sql`(CASE WHEN o.voucher_no = ${voucherNo} THEN 0 ELSE 1 END),` : sql``}
               (CASE WHEN lower(och.cheque_no) = lower(${q.raw}) THEN 0 ELSE 1 END), o.paid_at DESC, o.id DESC
      LIMIT ${limit}`);
    return {
      closest: false,
      total: Number(r.rows[0]?.total ?? 0),
      items: r.rows.map((x) => ({
        id: Number(x.id),
        voucherNo: Number(x.voucher_no),
        kind: x.kind ?? '',
        categoryName: x.category_name ?? '',
        partyName: x.party_name ?? '',
        method: x.method ?? '',
        amount: Number(x.amount),
        paidAt: x.paid_at ?? '',
        status: x.status ?? '',
      })),
    };
  }

  async payments(db: Executor, q: Query, limit: number): Promise<Group<PaymentHit>> {
    const voucher = /^(?:in-?)?(\d{1,15})$/i.exec(q.raw);
    const voucherNo = voucher ? Number(voucher[1]) : null;
    const chequePattern = containsPattern(q.raw);
    const r = await db.execute<Raw>(sql`
      SELECT p.id::text AS id, p.voucher_no::text AS voucher_no, d.name AS doctor_name, p.method, p.amount::text AS amount,
             p.paid_at::text AS paid_at, p.status, count(*) OVER ()::text AS total
      FROM payments p
      JOIN doctors d ON d.id = p.doctor_id
      LEFT JOIN cheques ch ON ch.payment_id = p.id
      WHERE (${voucherNo !== null ? sql`p.voucher_no = ${voucherNo} OR ` : sql``}ch.cheque_no ILIKE ${chequePattern})
      ORDER BY ${voucherNo !== null ? sql`(CASE WHEN p.voucher_no = ${voucherNo} THEN 0 ELSE 1 END),` : sql``}
               (CASE WHEN lower(ch.cheque_no) = lower(${q.raw}) THEN 0 ELSE 1 END), p.paid_at DESC, p.id DESC
      LIMIT ${limit}`);
    return {
      closest: false,
      total: Number(r.rows[0]?.total ?? 0),
      items: r.rows.map((x) => ({
        id: Number(x.id),
        voucherNo: Number(x.voucher_no),
        doctorName: x.doctor_name ?? '',
        method: x.method ?? '',
        amount: Number(x.amount),
        paidAt: x.paid_at ?? '',
        status: x.status ?? '',
      })),
    };
  }
}
