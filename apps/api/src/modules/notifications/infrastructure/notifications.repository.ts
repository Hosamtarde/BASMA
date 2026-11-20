import { Injectable } from '@nestjs/common';
import { SQL, sql } from 'drizzle-orm';
import type { Database, Tx } from '../../../shared/db/database';
import { IN_LAB_STATUSES, STATE_RETENTION_DAYS } from '../domain/notification-rules';

type Executor = Database | Tx;

export type DatedType = 'case_due' | 'cheque_in_due' | 'cheque_out_due';

export interface StateRow {
  seen: boolean;
  dismissed: boolean;
  /** Created more than the retention ago (N8). */
  old: boolean;
}

/** One row of a dated group: a case or a cheque near or past its date, with the caller's mark. */
export interface DatedRow {
  key: string;
  id: number;
  phase: 'soon' | 'overdue';
  date: string;
  seen: boolean;
  /** Cases: case number, doctor, patient. Cheques: number, bank, amount, party, voucher. */
  caseNo: number;
  doctorName: string;
  patientName: string;
  chequeNo: string;
  bank: string;
  amount: number;
  party: string;
  voucherNo: number;
}

export interface DatedGroup {
  /** Not hidden by the caller (exact). */
  total: number;
  unread: number;
  rows: DatedRow[];
}

export interface CollectCaseRow {
  id: number;
  caseNo: number;
  doctorId: number;
  doctorName: string;
  patientName: string;
  status: string;
  collectOn: string;
}

const inLab = sql.join(
  IN_LAB_STATUSES.map((s) => sql`${s}`),
  sql`, `,
);
const list = (values: readonly string[]) =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );

/**
 * The items of a dated type, with their key built in SQL exactly as `notificationKey` builds it
 * (`type:id:phase:date`) and the phase exactly as `duePhase` decides it (tested against each other).
 * Each source reads its own index: `cases_status_expected_ix`, `cheques_status_due_ix`.
 */
function source(type: DatedType, today: string, until: string): SQL {
  const phase = (col: SQL) => sql`CASE WHEN ${col} < ${today}::date THEN 'overdue' ELSE 'soon' END`;
  const key = (id: SQL, col: SQL) => sql`${type} || ':' || ${id} || ':' || ${phase(col)} || ':' || ${col}::text`;
  if (type === 'case_due') {
    return sql`
      SELECT ${key(sql`c.id`, sql`c.expected_date`)} AS key, c.id, ${phase(sql`c.expected_date`)} AS phase,
             c.expected_date AS date, c.case_no, d.name AS doctor_name, c.patient_name,
             NULL::text AS cheque_no, NULL::text AS bank, NULL::bigint AS amount, NULL::text AS party,
             NULL::bigint AS voucher_no, c.case_no AS tie
      FROM cases c JOIN doctors d ON d.id = c.doctor_id
      WHERE c.status IN (${inLab}) AND c.expected_date <= ${until}::date`;
  }
  if (type === 'cheque_in_due') {
    return sql`
      SELECT ${key(sql`ch.id`, sql`ch.due_date`)} AS key, ch.id, ${phase(sql`ch.due_date`)} AS phase,
             ch.due_date AS date, NULL::bigint AS case_no, NULL::text AS doctor_name, NULL::text AS patient_name,
             ch.cheque_no, ch.bank, p.amount, d.name AS party, p.voucher_no, ch.id AS tie
      FROM cheques ch
      JOIN payments p ON p.id = ch.payment_id
      JOIN doctors d ON d.id = p.doctor_id
      WHERE ch.status = 'pending' AND p.status = 'active' AND ch.due_date <= ${until}::date`;
  }
  return sql`
    SELECT ${key(sql`ch.id`, sql`ch.due_date`)} AS key, ch.id, ${phase(sql`ch.due_date`)} AS phase,
           ch.due_date AS date, NULL::bigint AS case_no, NULL::text AS doctor_name, NULL::text AS patient_name,
           ch.cheque_no, ch.bank, o.amount, coalesce(d.name, o.payee) AS party, o.voucher_no, ch.id AS tie
    FROM cheques ch
    JOIN outgoing_payments o ON o.id = ch.outgoing_payment_id
    LEFT JOIN doctors d ON d.id = o.doctor_id
    WHERE ch.status = 'pending' AND o.status = 'active' AND ch.due_date <= ${until}::date`;
}

/**
 * The feed's reads (B5 plan §5.3). Items are never stored; only the per-user marks are. A dated
 * group is one statement whatever the number of items (totals by window functions, the caller's
 * marks by a join on the primary key).
 */
@Injectable()
export class NotificationsRepository {
  /** Total and unread of a dated type for a user, and its first `limit` items in display order. */
  async datedGroup(
    db: Executor,
    type: DatedType,
    userId: number,
    today: string,
    until: string,
    limit: number,
  ): Promise<DatedGroup> {
    const res = await db.execute<Record<string, string | null>>(sql`
      WITH it AS (${source(type, today, until)})
      SELECT it.key, it.id::text AS id, it.phase, it.date::text AS date, it.case_no::text AS case_no,
             it.doctor_name, it.patient_name, it.cheque_no, it.bank, it.amount::text AS amount, it.party,
             it.voucher_no::text AS voucher_no, (ns.seen_at IS NOT NULL)::text AS seen,
             count(*) OVER ()::text AS total,
             (count(*) FILTER (WHERE ns.seen_at IS NULL) OVER ())::text AS unread
      FROM it
      LEFT JOIN notification_states ns ON ns.user_id = ${userId} AND ns.key = it.key
      WHERE ns.dismissed_at IS NULL
      ORDER BY it.date, it.tie
      LIMIT ${Math.max(limit, 1)}`);
    const first = res.rows[0];
    return {
      total: Number(first?.total ?? 0),
      unread: Number(first?.unread ?? 0),
      rows: res.rows.slice(0, limit).map((r) => ({
        key: r.key ?? '',
        id: Number(r.id),
        phase: r.phase === 'overdue' ? 'overdue' : 'soon',
        date: r.date ?? '',
        seen: r.seen === 'true',
        caseNo: Number(r.case_no ?? 0),
        doctorName: r.doctor_name ?? '',
        patientName: r.patient_name ?? '',
        chequeNo: r.cheque_no ?? '',
        bank: r.bank ?? '',
        amount: Number(r.amount ?? 0),
        party: r.party ?? '',
        voucherNo: Number(r.voucher_no ?? 0),
      })),
    };
  }

  /** Which of these keys a dated type generates right now (to accept marks for live items only). */
  async liveDatedKeys(db: Executor, type: DatedType, today: string, until: string, keys: readonly string[]): Promise<string[]> {
    if (keys.length === 0) return [];
    const res = await db.execute<{ key: string }>(sql`
      SELECT it.key FROM (${source(type, today, until)}) it WHERE it.key IN (${list(keys)})`);
    return res.rows.map((r) => r.key);
  }

  /** Delivered cases whose collect date has come; the caller keeps those with something still owed. */
  async collectCases(db: Executor, today: string): Promise<CollectCaseRow[]> {
    const res = await db.execute<Record<string, string>>(sql`
      SELECT c.id::text AS id, c.case_no::text AS case_no, c.doctor_id::text AS doctor_id, d.name AS doctor_name,
             c.patient_name, c.status, c.collect_on::text AS collect_on
      FROM cases c JOIN doctors d ON d.id = c.doctor_id
      WHERE c.collect_on IS NOT NULL AND c.collect_on <= ${today}::date AND c.status = 'delivered'
      ORDER BY c.collect_on, c.case_no`);
    return res.rows.map((r) => ({
      id: Number(r.id),
      caseNo: Number(r.case_no),
      doctorId: Number(r.doctor_id),
      doctorName: r.doctor_name ?? '',
      patientName: r.patient_name ?? '',
      status: r.status ?? '',
      collectOn: r.collect_on ?? '',
    }));
  }

  /**
   * All of a user's marks. They exist only for items the user was shown (keys outside the feed are
   * never stored) and old ones are purged, so this stays small whatever the size of the feed.
   */
  async states(db: Executor, userId: number): Promise<Map<string, StateRow>> {
    const res = await db.execute<{ key: string; seen: boolean; dismissed: boolean; old: boolean }>(sql`
      SELECT key, seen_at IS NOT NULL AS seen, dismissed_at IS NOT NULL AS dismissed,
             created_at < now() - make_interval(days => ${STATE_RETENTION_DAYS}) AS old
      FROM notification_states WHERE user_id = ${userId}`);
    return new Map(res.rows.map((r) => [r.key, { seen: r.seen, dismissed: r.dismissed, old: r.old }]));
  }

  /** Marks keys seen and/or dismissed (or shown again) for a user. */
  async mark(tx: Tx, userId: number, keys: readonly string[], change: { seen?: true; dismissed?: boolean }): Promise<void> {
    if (keys.length === 0) return;
    const now = sql`now()`;
    const seenAt = change.seen || change.dismissed ? now : sql`NULL`;
    const dismissedAt = change.dismissed === true ? now : sql`NULL`;
    const dismissedOnConflict =
      change.dismissed === undefined
        ? sql`notification_states.dismissed_at`
        : change.dismissed
          ? sql`coalesce(notification_states.dismissed_at, EXCLUDED.dismissed_at)`
          : sql`NULL`;
    await tx.execute(sql`
      INSERT INTO notification_states (user_id, key, seen_at, dismissed_at)
      SELECT ${userId}, k, ${seenAt}, ${dismissedAt}
      FROM unnest(ARRAY[${list(keys)}]::text[]) AS k
      ON CONFLICT (user_id, key) DO UPDATE SET
        seen_at = coalesce(notification_states.seen_at, EXCLUDED.seen_at),
        dismissed_at = ${dismissedOnConflict}`);
  }

  async purge(tx: Tx, userId: number, keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    await tx.execute(sql`DELETE FROM notification_states WHERE user_id = ${userId} AND key IN (${list(keys)})`);
  }
}
