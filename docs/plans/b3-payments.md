# B3 — Payments, cheques and balances (plan)

Status: **approved by the owner (defaults for D1–D10) and built** on `feat/b3-payments`; see the last section for the choices made while building.
Branch: `feat/b3-payments`. Sources read: SPEC §3, §5.3/5.6/5.8/5.10/5.11/5.13, §7, §8, §9, §11, §12; CLAUDE.md; ENGINEERING_STANDARDS; ADR-0003/0009/0010; `docs/production-readiness.md` (items 14, 18, S7, S8); the money, db-migrations, security and web skills; the B1/B2 code (`CasesService`, `currency-guard`, `counters`, `AuditWriter`, `SettingsRepository.hasMoneyData`).

## 0. Scope and where the plan departs from SPEC

**In:** incoming payments from doctors (cash, cheque, bank transfer); cheque register with status lifecycle; doctor balance + statement; per-case paid/remaining; advance payment in add-case; screens «دفعة واردة», «سجل الشيكات», «الديون», doctor statement, payments panel on case details; real figures on Home.
**Out (not built):** invoices (B6), outgoing payments and expenses, reports, CSV export, printing/receipts, licensing. Home keeps «قريباً» on «دفعة صادرة» and «فاتورة».

Points where this brief and SPEC differ. Each is listed again in §9 with a default; none is decided silently.

| # | SPEC says | This plan does | Why |
|---|---|---|---|
| S1 | §7.4/§8: method is `cash` or `cheque` | adds `transfer` (counts immediately, like cash) | The brief asks for bank transfer. Needs SPEC §5.8/§8 updated after approval. (D1) |
| S2 | §5.13: cheque `pending → cleared \| returned` only | also allows `cleared → returned` | The brief's own example (pending → cleared → returned); a cheque can bounce after the bank first credits it. (D3) |
| S3 | §7.3: FIFO over cases only | the **positive opening balance is the oldest item** in the FIFO | Without it the sum of "remaining" per case can never equal the doctor's balance (B4 must "tie out"). (D4) |
| S4 | §11: B3 includes outgoing payments; §4 has «إلغاء دفعة» and «إنشاء دفعة صادرة» | outgoing not built; void is a row action on the payments list, no separate void screen | Brief scope. (D6) |
| S5 | §11: Debts + breakdown are B4 | Debts list + summary now; the "breakdown" is the doctor statement page; no CSV | Brief scope. (D7) |

Consequence of S4: `paid_out` in the §7.3 formula is 0 until outgoing payments exist. A doctor who overpays shows a credit («مستحق عليّ») that cannot be refunded in the app yet.

## 1. Data model (migration `0004_payments.sql`)

Money is `bigint` minor units with `0 < amount ≤ MAX_AMOUNT_MINOR` (same limit as every other amount). Names follow the existing snake_case style; FKs are `ON DELETE RESTRICT` (financial history is never cascaded).

### `payments`
| column | type / rule |
|---|---|
| `id` | bigint identity PK |
| `voucher_no` | bigint NOT NULL, **unique**; shown as `IN-000001` (formatted by the API, never stored as text; ordering stays numeric) |
| `doctor_id` | bigint NOT NULL → doctors |
| `case_id` | bigint NULL → cases (binding) |
| `method` | text NOT NULL CHECK in (`cash`,`cheque`,`transfer`) |
| `amount` | bigint NOT NULL CHECK `> 0 and ≤ MAX` |
| `currency_code` | text NOT NULL — snapshot of the installation's currency code at creation (see §4) |
| `paid_at` | date NOT NULL — lab-local date, never in the future |
| `notes` | text NULL, CHECK `char_length ≤ 500` |
| `status` | text NOT NULL default `active`, CHECK in (`active`,`void`) |
| `void_reason` | text NULL (1..300 when void) |
| `voided_at` / `voided_by` | timestamptz / user FK, NULL until void |
| `idempotency_key` | uuid NULL, **unique** (partial, `WHERE idempotency_key IS NOT NULL`) |
| `request_hash` | text NULL — SHA-256 of the canonical request (§5) |
| `row_version`, `created_at/by`, `updated_at/by` | the existing `aggregateColumns()` |

Constraints: `payments_void_ck`: `(status='void') = (voided_at IS NOT NULL)` and `(status='void') = (void_reason IS NOT NULL)`; `payments_idempotency_ck`: key and hash are both set or both null.
Indexes (each tied to a query): `(doctor_id, paid_at desc, id desc)` — doctor payments/statement/balance; `(paid_at desc, id desc)` — payments list and month totals; `(case_id) WHERE case_id IS NOT NULL` — case panel and the bound-payment sum; unique `voucher_no`; unique partial `idempotency_key`.

### `cheques` (1:1 with a cheque payment — the SPEC §8 shape)
`id`, `payment_id` bigint NOT NULL **unique** → payments, `cheque_no` text NOT NULL (1..30), `bank` text NOT NULL (1..60), `due_date` date NOT NULL, `status` text NOT NULL default `pending` CHECK in (`pending`,`cleared`,`returned`), `status_date` date NULL (the date the current non-pending status was set; lab-local, not in the future), `row_version`, `updated_at/by`.
Indexes: `(status, due_date)` — register filters, "due within 7 days", overdue; `(due_date)`.
A cheque row exists **iff** `payments.method = 'cheque'`. A cross-table CHECK is impossible, so the service enforces it inside the creating transaction and an integration test asserts it for every code path (no trigger).

### `cheque_status_history`
`id`, `cheque_id`, `from_status` (NULL for the first row), `to_status`, `status_date`, `at` timestamptz, `note` (≤ 300), `user_id`. Same shape as `case_status_history`. It records every transition so the statement can show *when* a cheque cleared even after it later returned (§2), and the register can show a timeline.

### Reference data in the same migration (hand-written, like 0001/0002)
- `INSERT INTO counters ('payment_in_no', 1, 1)`. Not added to `COUNTER_NAMES` (that list is the owner-settable numbers, case and invoice only); the voucher counter starts at 1 and the owner cannot change it (SPEC §7.7).
- Permissions, granted to the `owner` role: `payments.read`, `payments.write`, `payments.void`, `cheques.read`, `cheques.write` (status changes), `ledger.read` (balances, statement, debts, Home summary). Added to `permissions.ts`; routes without one stay denied.

### Rest of the migration work
- Drizzle schema `shared/db/schema/payments.ts`; `npm run db:generate -w apps/api -- --name payments`; the generated SQL is reviewed and the hand-written reference-data block is appended.
- Forward-only; no change to existing tables (no `ALTER` on `cases`/`doctors`). Tests: empty DB → 0004, and DB at 0003 with doctors/cases/settings → 0004, existing rows untouched, counter present, permissions granted (pattern of `lab-slogan-migration.spec.ts`).
- Not stored anywhere: balances, paid/remaining, "counts" flags (SPEC §7.3).

## 2. Balance rules (SPEC §7.3, §7.4) — all computed at read time

**Counted payment** = `status = 'active'` AND (`method` in (cash, transfer) OR cheque `status = 'cleared'`). `pending`, `returned`, `void` never count. This predicate lives in exactly two places that are tested against each other: the pure function `isCounted()` and one SQL fragment used by every aggregate query.

```
charges  = opening_balance + Σ cases.total          (status <> 'cancelled')
received = Σ counted payments of the doctor
balance  = charges − received        (+ paid_out = 0 until outgoing exists)
balance > 0  owed to the lab «مستحق لي»;  < 0  the lab owes the doctor «مستحق عليّ»;  = 0 settled
```

### Per-case paid / remaining — pure `allocate(items, payments)`
Input: the doctor's opening balance, the cases (id, case_no, received_date, total, status), the counted payments. No DB inside.
1. Items, oldest first: the **opening balance** if > 0 (D4), then non-cancelled cases by `received_date`, then `case_no`.
2. A counted payment **bound** to a non-cancelled case pays that case first, capped at the case total. Any excess (case total was lowered after payment), and every counted payment bound to a **cancelled** case, joins the unbound pool.
3. The pool (unbound counted payments + spill) is applied to items still owing, oldest first.
4. Pool left over after every item is paid = **credit** (balance < 0).
Output: `paid` and `remaining` per case, `openingRemaining`, `credit`. Invariant (property-tested): `Σ remaining + openingRemaining − credit = balance`, and no item is paid more than its total.
A negative opening balance is not an item; it only lowers the balance (it is a credit the lab owes).

### Worked example 1 — the cheque lifecycle
Doctor D, opening 0. Case #101 (received 2026-11-01) total 400.00; case #102 (2026-11-03) total 300.00. Charges 700.00.

| step | event | counted | balance | #101 paid/rem | #102 paid/rem | shown separately |
|---|---|---|---|---|---|---|
| 1 | cheque 500.00 registered, unbound, `pending` | 0 | **700.00** | 0 / 400 | 0 / 300 | pending cheques 500.00 |
| 2 | cheque `cleared` | 500.00 | **200.00** | 400 / 0 | 100 / 200 | — |
| 3 | cheque `returned` (bounced) | 0 | **700.00** | 0 / 400 | 0 / 300 | returned, not counted |
(In minor units, step 2: 500.00 = 50 000 → balance 20 000.) Each step writes an audit entry and a `cheque_status_history` row; the payment row itself is never changed or deleted. Voiding the payment at step 2 gives the same balance as step 3, but the voucher is then void and its cheque frozen.

### Worked example 2 — bound + unbound, opening balance, cancelled case
Doctor E, opening **+100.00**. Cases: #201 (11-01) 300.00, #202 (11-02) 200.00, #203 (11-04) 150.00. Payments: cash 120.00 **bound to #202** (advance); cash 250.00 **unbound**; transfer 60.00 **bound to #203**.
- Charges = 100 + 300 + 200 + 150 = 750; counted = 120 + 250 + 60 = 430; **balance 320.00**.
- Bound first: #202 gets 120 (rem 80); #203 gets 60 (rem 90). Pool = 250: opening 100 → 0 left of the opening; then #201 gets 150 (rem 150). Σ remaining = 150 + 80 + 90 = 320 ✓.
- **Cancel #203** (SPEC §5.6: its payment is kept as account credit): charges = 600; counted still 430; **balance 170.00**. The 60 joins the pool: pool = 310 → opening 100, then #201 gets 210 (rem 90); #202 rem 80. Σ remaining = 170 ✓.

### Worked example 3 — overpayment
Doctor F, one case 100.00, cash 150.00 unbound → balance **−50.00** («مستحق عليّ 50.00»), case remaining 0, credit 50.00.

### Bound-payment limit (creation rule)
A payment bound to a case may not exceed `case.total − Σ(active, non-returned payments already bound to it)` (pending cheques included, so a doctor cannot bind 400 + 400 to a 500 case). Unbound payments have no limit (they become credit). Error `error.payment.exceeds_case_total`. If a case total is lowered later, `allocate` caps and spills (rule 2), so nothing breaks.

### Effective date (for statement and "this month")
Cash/transfer: `paid_at`. Cheque: the date it was **cleared** (`cheque_status_history`), and a later `returned` is a second event on its own date. Pending cheques are memo lines with no balance effect.

## 3. Cheque status machine, voiding, and cases

```
pending ──▶ cleared ──▶ returned      (returned is final)
   └──────────────────▶ returned
```
- Allowed: `pending→cleared`, `pending→returned`, `cleared→returned` (S2). Everything else → `409 error.cheque.invalid_transition`. No revert (a mistaken click is corrected by voiding the payment with a reason and re-entering it). (D3)
- Who: users with `cheques.write` (the `owner` role in v1). Voiding needs `payments.void`.
- `status_date` defaults to lab today; must be ≥ `paid_at`'s date and ≤ today.
- A status change on a **void** payment is refused (`error.cheque.payment_void`).
- Audit (inside the same transaction): `cheque.status_changed` with `{voucherNo, chequeNo, from, to, amount}`; a `cheque_status_history` row; `row_version` bumped (stale → 409).
- **Void payment:** needs a reason (1..300), sets `status='void'`, `voided_at/by`, bumps `row_version`, audit `payment.voided` `{voucherNo, amount, method, chequeStatus}`. Allowed for any cheque status (a cleared cheque's void reverses its income). Final; the voucher number is never reused. Already void → `409 error.payment.already_void`.
- **Case cancelled (pre-delivery, existing rule):** bound payments stay active and counted; `allocate` treats them as unbound credit. No stored change, no audit beyond the case's own. New payments cannot be bound to a cancelled case (`error.payment.case_cancelled`). The UI shows «الحالة ملغاة — الدفعة محفوظة كرصيد».
- **Case `delivered → returned`:** no effect on payments or balance (SPEC §9).
- **Case cancelled from `returned` (open item, production-readiness #18) — proposed default, see D2:** allow it **with a mandatory reason**, with the same payment treatment as above (bound payments become account credit). Reasons: (1) a returned case the doctor never takes back would otherwise be a debt that can never be removed — there are no credit notes before B6 and invoices are immutable; (2) the only workaround today (raise the discount to the subtotal) hides the real reason and corrupts the discount history; (3) cancelling changes no payment, so nothing money-wise is lost; the doctor's credit stays visible. Guards: reason required (≥ 1 char) only for this path, audit `case.cancelled` carries `fromStatus`, `total` and `boundPayments`, blocked once invoiced (B6 rule §7.8). Alternative if the owner prefers: keep it not allowed. Implementation touches `canCancel`, `CasesService.cancel`, the cancel DTO and the web cancel dialog; a case test list is in §8.

## 4. Currency lock — everything that must be covered

The rule (SPEC §5.18, owner decision B1): currency **code and decimals** cannot change once any amount exists; the symbol can.
1. `SettingsRepository.hasMoneyData`: add `OR EXISTS (SELECT 1 FROM payments)` (void payments count — the row and its amount still exist). Update the production-readiness #14 row (B3 done, B6 invoices still to add).
2. Every payment write that stores an amount first takes `lockCurrencyForMoneyWrite(tx)` (SHARE lock on the currency setting): create payment, create case **with advance**. (Void and cheque status change store no new amount.) The currency change path already takes the UPDATE lock before `hasMoneyData`, so a payment can never be saved under decimals that change underneath it.
3. `payments.currency_code` snapshot is set from the locked setting in the same transaction. A service assertion fails the write (500 invariant, logged) if any existing payment has a different code; an integration test checks the two can never diverge.
4. Settings screen: the existing «locked» message and test remain; add the case «payments exist» (the message already says "once amounts exist"; no new string unless the owner wants the reason named).
5. Tests: (a) change currency decimals → 409 after a payment exists, symbol change still works; (b) parallel «create payment» vs «change decimals» (one wins cleanly, never a stored amount with other decimals); (c) first-run Playwright flow: currency is editable before the first amount, locked after the first payment.
6. Demo/e2e seeds create payments only through the API (same checks apply).

## 5. Idempotency, locking, numbering, permissions, audit

- **Idempotency-Key.** `POST /payments` requires header `Idempotency-Key: <uuid>` (missing → `400 error.idempotency.required`). `POST /cases` requires it **only when `advance` is present**. Stored on the payment row with `request_hash` = SHA-256 of the canonical, normalised request body (sorted keys, defaults applied, e.g. `paidAt` resolved to the lab date so a replay after midnight still matches). Replay with the same key and body → the original response, `200` + `Idempotent-Replayed: true` (the first call returns `201`). Same key, different body → `422 error.idempotency.mismatch`. Race of two identical requests: the unique index rejects the loser, which then reads the winner and answers as a replay (no second row, no number consumed). The web form generates one key per form instance and keeps it until success, so a double-click or retry cannot duplicate.
- **Optimistic locking.** `payments.row_version` (void) and `cheques.row_version` (status) — every request carries the `rowVersion` it read; stale → `409 error.concurrency.stale`. Creates don't need one.
- **Row locks (ADR-0010).** Order is always: currency SHARE → doctor row `FOR NO KEY UPDATE` (does not block FK inserts of cases) → case row `FOR SHARE` when bound (case edits take `FOR UPDATE`, so a case total cannot change under the bound-limit check) → counters. Void and cheque status take doctor then payment row. One order everywhere, so no deadlocks (a concurrency test fires mixed operations to prove it). READ COMMITTED + explicit locks.
- **Numbering.** `UPDATE counters SET next_value = next_value + 1 WHERE name='payment_in_no' RETURNING …` inside the insert transaction, after the doctor lock; a rollback gives the number back, a replay takes none, a void never frees one. Test: N parallel creates → exactly 1..N with no gaps; a forced failure after the number is taken → the next payment reuses it.
- **Permissions.** `payments.read`: list/get/case payments. `payments.write`: create (including the advance in `POST /cases`, which also needs `cases.write`). `payments.void`: void. `cheques.read`: register/summary. `cheques.write`: status change. `ledger.read`: balance, statement, debts, Home summary. All granted to `owner`; every route declares one; 401/403 tests per endpoint.
- **Audit (action codes, rendered per language from `audit.<action>`):** `payment.created` `{voucherNo, doctor, method, amount, caseNo?, viaAdvance}`; `payment.voided` `{voucherNo, amount, method, reason}`; `cheque.status_changed` `{voucherNo, chequeNo, from, to, amount}`. Patient names are never written (owner decision B2). Every entry carries the acting user id and is written in the caller's transaction.
- **Validation.** Amount integer ≥ 1 minor unit (no floats, no strings); `paidAt` ≤ lab today; doctor exists (inactive doctors **may** pay — money must be recordable; D5); bound case belongs to that doctor and is not cancelled; method `cheque` ⇒ `cheque{chequeNo, bank, dueDate}` required and for other methods forbidden (mass-assignment safe); exact duplicate cheque (same bank case-insensitively + number) while another one is active and not returned → `409 error.cheque.duplicate`, race-free via `pg_advisory_xact_lock(hashtext(bank|no))` (D8).

## 6. API (all under `/api/v1`, Bearer token, DTO-validated, no entities returned, errors in the existing envelope with a stable `code`)

Common types: `Money` = integer minor units. `PaymentResponse` = `{ id, voucherNo: "IN-000001", doctor:{id,name}, case:{id,caseNo}|null, method, amount, currencyCode, paidAt, notes, status, voidReason, voidedAt, counted:boolean, cheque: ChequeResponse|null, rowVersion, createdAt }` — `counted` is computed by the server so the UI never re-implements §7.4. `ChequeResponse` = `{ id, chequeNo, bank, dueDate, status, statusDate, dueState:"none"|"soon"|"overdue", allowedStatuses:[…], rowVersion }` (`allowedStatuses` from the same function the service uses, like `allowedStatuses` on cases).

| # | Method + path | Permission | Request | Response | Errors (beyond 400 validation / 401 / 403) |
|---|---|---|---|---|---|
| 1 | `POST /payments` + `Idempotency-Key` | payments.write | `{doctorId, caseId?, method, amount, paidAt?, notes?, cheque?:{chequeNo, bank, dueDate}}` | 201 `{payment, doctorBalance}`; replay 200 | 404 doctor/case; 409 `payment.case_doctor_mismatch`, `payment.case_cancelled`, `payment.exceeds_case_total`, `cheque.duplicate`; 400 `payment.date_in_future`, `payment.cheque_required`, `payment.cheque_not_allowed`, `idempotency.required`; 422 `idempotency.mismatch` |
| 2 | `POST /payments/{id}/void` | payments.void | `{rowVersion, reason}` | 200 `{payment, doctorBalance}` | 404; 409 `payment.already_void`, `concurrency.stale` |
| 3 | `PATCH /cheques/{id}/status` | cheques.write | `{status, rowVersion, statusDate?, note?}` | 200 `{payment, doctorBalance}` | 404; 409 `cheque.invalid_transition`, `cheque.payment_void`, `concurrency.stale`; 400 `cheque.date_invalid` |
| 4 | `GET /payments` | payments.read | `?doctorId&caseId&method&status&counted&from&to&search&sort&page&pageSize` (search = voucher, doctor name, cheque no.) | `Page<PaymentResponse>` + `totals:{counted, pendingCheques}` for the filtered set | — |
| 5 | `GET /payments/{id}` | payments.read | — | `PaymentResponse` + cheque status history | 404 |
| 6 | `GET /cheques` | cheques.read | `?status&doctorId&dueFrom&dueTo&due=soon\|overdue&search&page&pageSize` | `Page<{cheque, payment summary, doctor}>` ordered by due date | — |
| 7 | `GET /cheques/summary` | cheques.read | same filters except `status` | `{byStatus:{pending,cleared,returned}, dueSoon, overdue, pendingAmount}` (chip counts, one grouped query) | — |
| 8 | `GET /doctors/{id}/balance` | ledger.read | — | `{openingBalance, charges, received, pendingCheques, balance, direction}` | 404 |
| 9 | `GET /doctors/{id}/statement` | ledger.read | `?from&to&page&pageSize` | `{periodOpening, lines:[{date, kind: opening\|case\|payment\|cheque_return, ref, description, debit, credit, running}], closing, memo:[pending cheques]}`; running balance computed in SQL (window) so pages are consistent | 404 |
| 10 | `GET /cases/{id}/payments` | payments.read | — | `{caseId, total, paid, remaining, creditedFromCancelled?, payments: PaymentResponse[]}` (bound payments; `paid` includes the FIFO share) | 404 |
| 11 | `GET /debts` | ledger.read | `?direction=owed_to_lab\|owed_by_lab\|all&search&page&pageSize` | `{summary:{parties, owedToLab, owedByLab, net}, page: Page<{doctor, balance, direction, pendingCheques}>}` — one grouped SQL, no per-doctor loop | — |
| 12 | `GET /ledger/summary` | ledger.read | — | `{receivedThisMonth, receivedTotal, owedToLab, pendingChequesCount, pendingChequesAmount, chequesDueSoon, chequesOverdue}` for Home | — |
| 13 | `POST /cases` (extended) + `Idempotency-Key` when `advance` | cases.write + payments.write | existing body + `advance?:{method, amount, paidAt?, notes?, cheque?}` | existing `CaseDetail` + `advancePayment: PaymentResponse\|null`; replay 200 | all of #1 except doctor/case lookups; `amount ≤ case total` |
| 14 | `GET /cases/{id}` (additive) | cases.read | — | adds `paid`, `remaining` (same allocation engine) | — |

Notes: the advance is created **in the same transaction as the case** (currency lock → doctor lock → case insert → case number → payment insert → voucher number → cheque → both audit entries); any failure rolls back both and both numbers. The list `GET /cases` is unchanged (no per-row balance; avoids N allocations per page). `GET /doctors/{id}` gains `balance`; the doctors list does not (B4 decides).
Delivery-time payment (SPEC §5.7) and the invoice/statement documents are B5/B6; the case page's «دفعة واردة لهذه الحالة» covers payment at hand-over meanwhile.
Pagination default 25, max 100, filtering/sorting in SQL; the debts query and balance aggregate get an `EXPLAIN` review against the 20 000 cases / 50 000 payments demo-scale data in stage 1.
OpenAPI: all new DTOs documented; `npm run openapi:export` + `npm run api:generate` committed; `contract:check` must pass.
New API catalog keys (ar + en): `error.payment.*`, `error.cheque.*`, `error.idempotency.*`, `payment.method.*`, `cheque.status.*`, `audit.payment.*`, `audit.cheque.*`.

## 7. Frontend plan (stage 2; skills smile-artec-web-*)

**Routes (all `errorElement: <RouteError/>`)**: `/payments` (form + report), `/cheques`, `/debts`, `/doctors/:id/payments` and `/doctors/:id/statement` (new tabs on the existing doctor page). Sidebar gains «دفعة واردة», «الديون», «سجل الشيكات» (not «دفعة صادرة / إلغاء دفعة / فاتورة» — no dead items, SPEC §3.2). Home cards `incoming`, `debts`, `cheques` become links with live figures from `GET /ledger/summary`; `outgoing` and `invoice` keep «قريباً». `KeyNumbers` gains income this month, owed to the lab, cheques due.

**Screens**
- **Payments** — top: `PaymentForm` (doctor `EntityPicker` → shows his balance; amount `MoneyField`; method radio cash/cheque/transfer; cheque fields appear only for cheque: number, bank, due date; payment date `DateField`; optional bound case picker listing that doctor's open cases, default «غير مرتبطة بحالة»; notes) → «تسجيل الدفعة»; success toast shows the new balance. Below: the report — table (voucher, date, doctor, method, case, amount, status chip) with filters (doctor, method, status, date range, search) in the URL via `useListParams`/`useUrlState`, totals row (counted, pending cheques), pagination 25. Row actions: open, «إلغاء الدفعة» (confirm dialog + reason, `ActionButton` with `disabledReason` when already void; void rows struck-through with the reason). No receipt printing (out of scope).
- **Cheques register** — chips «الكل / قيد التحصيل / تم الصرف / مرتجع» with counts from `/cheques/summary`; search; due-date range; rows due ≤ 7 days highlighted, overdue-pending in red (colour + text/icon, never colour alone); row action «تغيير الحالة» offering only `allowedStatuses`, a confirm dialog with status date + note; stale 409 → the existing "changed elsewhere" dialog. No «واردة/صادرة» chip (only incoming exists).
- **Debts** — info banner (SPEC text), four summary cards (parties, owed to me, owed by me, net), table (doctor, direction badge, amount; sorted by amount), filter «الكل / لي / عليّ», search, row → the doctor's statement. No CSV, no modal breakdown (D7).
- **Doctor page** — header balance; tabs «الدفعات» (his payments + add) and «كشف الحساب» (date range, lines with running balance, memo of pending cheques).
- **Case details** — «الدفعات» panel: paid / remaining, bound payments, pending-cheque note, «دفعة واردة لهذه الحالة» (opens `PaymentForm` in a dialog with doctor and case fixed). Cancelled case shows the "kept as credit" note.
- **Add case** — «الدفعة المقدمة»: amount (+ method; cheque fields appear for cheque); client check `amount ≤ total preview` for guidance only — the server decides; one idempotency key per form instance; the success toast offers the case and the voucher number.
- **Cancel from returned** (if D2 approved): the existing cancel dialog asks for the reason (required on this path).

**Components reused**: `Th/Td/Money` with column kinds (`text`, `number` for voucher/dates, `money`, `actions`); `Dialog`, `ActionButton`, `EntityPicker`, `DateField`, `MoneyField`, `list.tsx` pagination, `useUrlState`, `useListParams`; status chips like `cases/status.tsx`. New: `PaymentForm`, `ChequeFields`, `MethodBadge`, `ChequeStatusBadge`, `BalanceCard`, `StatementTable`.
**Data**: a `features/payments/api.ts` (key factory + `queryOptions`); mutations invalidate payments, cheques, debts, ledger summary, the doctor balance/statement, the case (`paid/remaining`), and `settings` (the currency lock). `rowVersion` chained from each response; never send client-computed balances.
**Copy / RTL / a11y**: every string in `ar.json` and `en.json` (plural forms for counts), Arabic first, no literals in JSX; logical properties only; `i18n:check` and `rtl:check` clean; one `h1` per page, labelled landmarks, visible labels, `aria-invalid` + `aria-describedby`, accessible names start with the visible text, keyboard path in RTL and LTR, Esc closes dialogs, Enter submits; status never conveyed by colour alone; focus returns to the trigger after a dialog; `role="alert"` for errors. States: skeleton/«loading», empty («لا توجد دفعات مسجلة بعد.» with the add action), error (route boundary + retry), disabled-with-reason actions.

## 8. Test plan

**Unit (Jest/Vitest, pure):** `allocate` (every §2 example, FIFO order and ties by case no., bound before pool, cap and spill, cancelled-case payments, opening +/−, overpayment, 0/2/3 decimals, large amounts near `MAX`, empty inputs) + property tests (Σ remaining − credit = balance; no case over-paid; permutation of payments gives the same result); `isCounted` for the full method × cheque-status × void matrix; cheque transition table; voucher formatter; idempotency hash canonicalisation (key order, defaults, date resolution); effective-date rules; the case-cancel rule change.
**Integration (Testcontainers PostgreSQL 16):** migration 0004 on empty and on 0003+data; constraints reject (amount ≤ 0, bad method, void without reason, cheque duplicate payment_id, bad status); SQL fragment `counted` equals `isCounted` over a generated matrix; **concurrency**: parallel creates for one doctor (gap-free numbers, no deadlock, mixed with voids/cheque changes/case edits), parallel same idempotency key (one row), same key different body (422), parallel void (one wins, one 409), stale cheque version (409), payment vs currency change, bound-limit race against case total edit and against another payment; rollback returns the voucher number; advance atomicity (forced failure ⇒ no case, no payment, counters unchanged); EXPLAIN checks for debts and balance queries.
**API e2e (Jest + Supertest):** 401/403 on every route; validation and unknown-field rejection; every error code above in ar and en; replay returns 200 with the same body; balance after each step of examples 1–3 equals the hand calculation; case cancel keeps payments; cancel-from-returned rules; `GET /cases/:id` `paid/remaining`; `/ledger/summary` month boundaries with the lab time zone (run with `TZ=UTC` and a non-UTC lab zone); audit entries present with the user id and no patient names.
**Web unit/component (Vitest):** `PaymentForm` (cheque fields appear/disappear, Arabic inline errors, server field errors, key reuse on retry and new key after success, double-click sends once), cheque dialog options come from `allowedStatuses`, debts filters and URL state, statement table, money alignment per column kind, i18n parity and RTL guard tests.
**E2E (Playwright + axe, both languages, `TZ=UTC`):** add case with cash advance → case shows paid/remaining; cheque flow pending → cleared → returned with balance checks on the doctor page; void with reason; payments filters round-trip through the URL (reload, back/forward); debts figures tie to the doctor statement; Home figures (in the `demo` project with exact data); currency locked after the first payment (first-run project); `expectAccessible` on every page; layout checks (no sideways scroll, header/cell text edges); each test creates its own data through the API with `uid()` names and does not depend on another.
**Contract drift:** `npm run contract:check` (OpenAPI export + regenerated client, fails on drift).
**Demo seed (`scripts/demo`)**, through the real API only: cash, transfer and cheque payments for most doctors; cheques in every state (pending due in 3 days, pending overdue, pending later, cleared, returned, a cleared-then-returned one); a case with an advance; a bound payment on a cancelled case; a voided payment; one overpaying doctor with credit; unbound payments for FIFO; `demo-seed.spec.ts` extended with the expected counts and a balance tie-out.
**Commands run and reported at each stop:** lint, typecheck, i18n:check, rtl:check, unit, integration, API e2e, web tests, build, `contract:check`, `test:e2e:web` (needs `E2E_DATABASE_URL`).

## 9. Risks and "Needs owner decision"

### Risks
1. **Money correctness** — the counted predicate lives in TypeScript and SQL. Mitigation: one pure function, one SQL fragment, a generated-matrix test that compares them, and a tie-out property test.
2. **Lock order / deadlocks** — one fixed order (§5) and a mixed-operation concurrency test.
3. **Currency lock gaps** — covered by the list in §4; the `hasMoneyData` change is easy to forget, so it has its own test.
4. **Idempotency edge cases** — midnight rollover of the default date (hash uses the resolved date) and a lost response (replay returns the original).
5. **Performance** — debts/balance aggregates over 50 000 payments; indexes in §1; EXPLAIN review in stage 1.
6. **Scope creep** — outgoing, CSV, receipts and delivery payment stay out; the Home tiles keep «قريباً».
7. **Case rule change (D2)** touches B2 code and tests; kept small and covered.
8. **No outgoing payments yet** — credits cannot be refunded until the outgoing slice.

### Needs owner decision (each has a default; I will implement the default if you approve the plan without comment)
| # | Question | Default (recommended) | Alternative |
|---|---|---|---|
| D1 | **SPEC conflict:** add method `transfer` (bank transfer). SPEC §5.8/§8 say only cash/cheque. | Add it; counts immediately like cash; SPEC §5.8/§8 updated. | Cash and cheque only. |
| D2 | **Cancel a case from «مرتجعة» when payments exist** (production-readiness #18). | Allow, reason mandatory, blocked once invoiced; bound payments stay as account credit; audit records total and bound amount (§3). | Keep it not allowed. |
| D3 | **Cheque transitions:** SPEC has `pending→cleared\|returned`. | Also `cleared→returned`; `returned` final; no revert (mistakes: void + re-enter). | Add revert-to-pending with a reason. |
| D4 | **Opening balance and FIFO:** SPEC applies unbound payments to cases only. | The positive opening balance is the oldest item, so per-case remaining ties to the balance. | Cases only (SPEC literal); the opening balance is shown separately and sums do not tie. |
| D5 | **Payments from an inactive doctor** and **bound limit**. | Inactive doctors may pay; a bound payment may not exceed what is still unbound on the case; unbound has no limit. | Block inactive doctors; allow over-binding. |
| D6 | **Void screen:** SPEC §4/§5.10 has a separate «إلغاء دفعة» page (in and out). | Void is a row action on «دفعة واردة» and the doctor page; no separate page now. | Build the separate page. |
| D7 | **Debts scope:** breakdown modal and CSV are B4. | List + cards now; row opens the doctor statement; no CSV. | Also build the modal and CSV now. |
| D8 | **Cheque fields:** number, bank, due date all required; exact duplicate (bank + number) rejected while an earlier one is active and not returned. | As stated. | Bank optional (SPEC §8 allows null) and/or warn instead of reject. |
| D9 | **Void of a cleared cheque** payment. | Allowed with a reason (reverses its income, audited). | Only `pending` or `returned` cheques may be voided. |
| D10 | **Payment date:** may not be in the future; cheque due date may be any date. | As stated. | Allow future payment dates. |

I need from you: approval of the plan, and an answer (or "defaults are fine") on D1–D10. D1 is a SPEC conflict, so I will not start stage 1 until you answer it.

---

## Decisions taken while unattended

Written during the build, after the owner approved the plan with "defaults are fine for D1–D10" and asked for Stage 0 follow-ups, backend and frontend to run back to back. Each is the safest default; all are easy to change.

1. **Replay hash uses the request as the client sent it** (an omitted `paidAt` stays omitted), not the resolved lab date. A retry after midnight therefore still returns the original instead of a 422 (plan §5 said "resolved"; this is strictly safer). The stored payment keeps the resolved date.
2. **No `sort` parameter** on `GET /payments`: newest first (`paid_at desc, id desc`) only. The cheque register is ordered by due date.
3. **The cheque register lists only cheques of active payments.** A voided payment's cheque is frozen and visible on the payments list (struck out with its reason), not in the register or its chip counts.
4. **`GET /doctors/{id}` does not carry the balance.** The balance has its own `GET /doctors/{id}/balance`; the doctors list is unchanged (B4 decides on a balance column).
5. **Statement** shows cases, counted payments (a cheque on the day it cleared) and bounced cleared cheques. Voided payments disappear from it entirely; pending cheques are not statement lines (the balance card shows their total apart).
6. **Home «this month»** = counted payments whose effective date (payment date; for a cheque the clearing date) falls in the lab's current calendar month. The cheques card counts pending cheques due within 7 days plus overdue ones.
7. **Bound-payment limit** counts pending cheques and ignores returned ones; an unbound payment has no limit.
8. **Advance payment date** defaults to the lab's today (the form has no separate date field).
9. **Audit texts omit the amount** (a raw minor-unit integer would mislead); the amount is stored in the entry's params.
10. **Cheque register has no incoming/outgoing chip** (only incoming exists).
11. **Doctor picker on the payments form offers active doctors only** (like every picker); an inactive doctor can still pay from his own account page or through the API (D5).
12. **Cancel from returned**: the reason is enforced on the server. "Blocked once invoiced" cannot be enforced before invoices exist (S13 in production-readiness).
13. **`Idempotency-Key` on `POST /cases`** is required only when `advance` is present; a plain case needs none (unchanged behaviour). A key that was used for a payment cannot be reused for a case advance (422).
14. **Paid / remaining** is on `GET /cases/{id}` and `GET /cases/{id}/payments`; the cases list is unchanged.
15. **Void is a row action** (D6): no separate «إلغاء دفعة» screen and no sidebar item for outgoing or invoice.
16. **Statement lines are paged on the server** (25 per page) with a running balance computed over the whole history.
17. **Playwright ran against a throwaway PostgreSQL container** (`b3-e2e-pg`, removed afterwards), not the development database; the API integration/e2e suites use Testcontainers as before.
18. **Incident, reported openly:** while cleaning up stray test containers I removed the development database container `smile-artec-db-1` by mistake. Its data volume `smile-artec_dbdata` was untouched; the container was recreated with `docker compose up -d db` and is healthy with the same data. No data was lost.
