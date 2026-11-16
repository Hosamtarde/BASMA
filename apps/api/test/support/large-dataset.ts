import type { Pool } from 'pg';

export interface DatasetSize {
  doctors: number;
  cases: number;
  payments: number;
  /** Cases and payments given to doctor #1 on top of the even spread (the pathological doctor). */
  heavyCases: number;
  heavyPayments: number;
}

/** The SPEC §6 target: 20 000 cases / 50 000 payments. */
export const TARGET_SIZE: DatasetSize = {
  doctors: 500,
  cases: 20_000,
  payments: 50_000,
  heavyCases: 5_000,
  heavyPayments: 10_000,
};

/**
 * Fills a migrated, empty database straight through SQL (fast; the API is covered elsewhere) with a
 * deterministic ledger: signed opening balances, ~3% cancelled cases, 60% bound payments, cheques in
 * every state (with their history rows), ~2% voided payments. Returns the doctor ids.
 */
export async function loadDataset(pool: Pool, size: DatasetSize = TARGET_SIZE): Promise<number[]> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT setseed(0.42)');
    await c.query(
      `INSERT INTO doctors (name, clinic, phone, opening_balance, active)
       SELECT 'Dr ' || g || ' ' || md5(g::text), 'Clinic ' || g, '059' || lpad(g::text, 7, '0'),
              CASE WHEN g % 5 = 0 THEN ((random() * 40000)::bigint - 20000) ELSE 0 END,
              g % 17 <> 0
       FROM generate_series(1, $1::int) g`,
      [size.doctors],
    );
    await c.query(
      `INSERT INTO cases (case_no, doctor_id, patient_name, received_date, expected_date, delivered_date, status, discount, total)
       SELECT g, doctor_id, patient, received, received + 7,
              CASE WHEN status = 'delivered' THEN received + 3 END, status, 0, total
       FROM (
         SELECT g,
                CASE WHEN g <= $2::int THEN (SELECT min(id) FROM doctors)
                     ELSE (SELECT min(id) FROM doctors) + (random() * ($3::int - 1))::int END AS doctor_id,
                'Patient ' || g || ' ' || md5((g * 7)::text) AS patient,
                date '2025-01-01' + (g % 700) AS received,
                CASE WHEN g % 33 = 0 THEN 'cancelled'
                     ELSE (ARRAY['waiting','design','in_progress','ready','delivered','returned'])[1 + (random()*5)::int] END AS status,
                5000 + (random() * 45000)::bigint AS total
         FROM generate_series(1, $1::int) g
       ) s`,
      [size.cases, size.heavyCases, size.doctors],
    );

    const bound = Math.round(size.payments * 0.6);
    const unbound = size.payments - bound;
    // Bound payments: a share of the case total, always the case's own doctor.
    await c.query(
      `INSERT INTO payments (voucher_no, doctor_id, case_id, method, amount, currency_code, paid_at)
       SELECT row_number() OVER (), doctor_id, id,
              (ARRAY['cash','cash','transfer','cheque'])[1 + (random()*3)::int],
              GREATEST(1, (total * (0.2 + random() * 0.8))::bigint),
              'ILS', received_date + 5
       FROM (SELECT * FROM cases ORDER BY random() LIMIT $1::int) s`,
      [bound],
    );
    // Unbound payments, a share of them on the heavy doctor.
    await c.query(
      `INSERT INTO payments (voucher_no, doctor_id, method, amount, currency_code, paid_at)
       SELECT $1::int + g,
              CASE WHEN g <= $2::int THEN (SELECT min(id) FROM doctors)
                   ELSE (SELECT min(id) FROM doctors) + (random() * ($3::int - 1))::int END,
              (ARRAY['cash','cash','transfer','cheque'])[1 + (random()*3)::int],
              1000 + (random() * 30000)::bigint,
              'ILS', date '2025-02-01' + (g % 600)
       FROM generate_series(1, $4::int) g`,
      [bound, size.heavyPayments, size.doctors, unbound],
    );
    await c.query(
      `INSERT INTO cheques (payment_id, cheque_no, bank, due_date, status, status_date)
       SELECT id, 'CH' || id, 'Bank ' || (id % 7), paid_at + 30,
              (ARRAY['pending','cleared','returned','cleared'])[1 + (id % 4)],
              CASE WHEN id % 4 = 0 THEN NULL ELSE paid_at + 31 END
       FROM payments WHERE method = 'cheque'`,
    );
    await c.query(
      `INSERT INTO cheque_status_history (cheque_id, from_status, to_status, status_date)
       SELECT id, 'pending', 'cleared', status_date FROM cheques WHERE status IN ('cleared','returned') AND id % 3 <> 0`,
    );
    await c.query(
      `INSERT INTO cheque_status_history (cheque_id, from_status, to_status, status_date)
       SELECT id, CASE WHEN id % 3 <> 0 THEN 'cleared' ELSE 'pending' END, 'returned', status_date + 1
       FROM cheques WHERE status = 'returned'`,
    );
    await c.query(`UPDATE cheques SET status_date = status_date + 1 WHERE status = 'returned'`);
    await c.query(
      `UPDATE payments SET status = 'void', void_reason = 'dataset', voided_at = now() WHERE id % 50 = 0`,
    );
    await c.query(`UPDATE counters SET next_value = $1 WHERE name = 'payment_in_no'`, [size.payments + 1]);
    await c.query(`UPDATE counters SET next_value = $1 WHERE name = 'case_no'`, [size.cases + 1]);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
  await pool.query('ANALYZE');
  const ids = await pool.query<{ id: string }>('SELECT id FROM doctors ORDER BY id');
  return ids.rows.map((r) => Number(r.id));
}
