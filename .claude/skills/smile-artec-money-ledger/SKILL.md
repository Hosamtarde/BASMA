---
name: smile-artec-money-ledger
description: Use whenever touching payments, cheques, invoices, case totals, discounts, balances, dues, statements or any money calculation in Smile Artec.
---
# Money & ledger rules (see SPEC §7)

- Amounts are **integer minor units** via the shared money module (parse/format/half-up rounding). No floats, no ad-hoc `toFixed`.
- Doctor balance is **computed**: `opening + Σ non-cancelled case totals − Σ counted incoming payments + Σ counted outgoing payments to the doctor`. Positive = owed to the lab.
- Counted payments: cash immediately; **cheques only when `cleared`** (incoming and outgoing); `returned`/`pending` never count; `void` never counts.
- Case paid amount = payments **bound** to the case + FIFO share of **unbound** payments (oldest case first by received date, then case no.), computed at read time by a pure `allocate()`.
- Case total = Σ item prices − discount, recomputed server-side in the same transaction on every change. Client totals are never trusted; mismatch → reject.
- Item prices are frozen at line creation (doctor special price → else general price), with the work-type name snapshot.
- Payments/cheques/invoices are **voided, never deleted** (reason + audit). Invoices are immutable, with a JSON snapshot.
- Create-payment and create-invoice accept an `Idempotency-Key`; a replay returns the original result.
- Numbers (case, invoice, `IN-/OUT-` payments) are gap-free and assigned inside the insert transaction.

## Required test matrix
cash/cheque × pending/cleared/returned/void · bound vs unbound · FIFO order & ties · overpayment (credit → "owed by me") · refund to doctor · opening balance (±) · cancelled case · discount · rounding with 0/2/3 decimals · invoice void restores un-invoiced state · concurrent payments on the same doctor · duplicate idempotency key.

## Where it lives (B3)
- Pure rules: `apps/api/src/modules/payments/domain/payment-rules.ts` (`isCounted`, cheque transitions, `allocate`, `doctorBalance`, `requestHash`). SQL twin of `isCounted`: `countedWhere()` and the `balancesCte` in `infrastructure/`; `test/integration/payments-schema.spec.ts` compares them over the whole matrix.
- Lock order for every money write (ADR-0010): currency SHARE → doctor row `FOR NO KEY UPDATE` → case row `FOR SHARE` (when bound) → counters. Void and cheque status take the doctor lock first too.
- Decisions: the positive opening balance is the oldest FIFO item (D4); payments bound to a cancelled case become account credit; a returned case may be cancelled with a reason (D2); cheque `cleared → returned` is allowed, `returned` is final (D3); a cleared cheque's payment may be voided (D9). See `docs/plans/b3-payments.md`.

## Where it lives (B4)
- **Tie-out, the rule of the whole ledger:** `balance = openingRemaining + Σ remaining(open cases) − credit`, proven in `docs/plans/b4-debts-reports-search.md` §1.2. The pure `breakdown()` (next to `allocate` in `payment-rules.ts`) returns it with `tiesOut`; `LedgerService.computeBreakdown` refuses to answer (500, logged) if it does not hold. Three computations must agree for every doctor: `doctorBalance` / the SQL `balancesCte`, the breakdown equation, and the statement closing. Tests: `test/e2e/ledger-tieout.e2e.spec.ts` (every demo doctor) and `test/integration/ledger-scale.spec.ts` (500 doctors). Any change to `allocate`, the counted rule or the statement query must keep them green.
- **Per-page figures, never per row:** `LedgerRepository.doctorInputs(ids)` loads cases and SQL-aggregated counted payments for a set of doctors in four statements; `LedgerService.figuresForCases` and `balancesOf` feed the cases and doctors lists; `balancesCte(ids)` can be restricted to a page of doctors.
- **CSV exports** (`modules/exports`, `shared/csv`): money text comes from integer minor units through `toMoneyInput` (never a float), user text is neutralised against formula injection, one read-only REPEATABLE READ snapshot, audited before the file is sent, capped at 50 000 rows, and needs the read permission **and** `exports.run`.
- **Receipts summary** reads counted money by its effective date (a cheque: the day it cleared), so a month equals Home's «received this month».
## Where it lives (B4b, outgoing money)
- **Two tables, never a direction filter:** `payments` = incoming only, `outgoing_payments` = expenses and refunds (`kind`), each with its own `IN-` / `OUT-` counter. `cheques` has `payment_id` OR `outgoing_payment_id` (database CHECK `cheques_owner_ck`). An incoming query reaches cheques only through `payments.id`, an outgoing one only through `outgoing_payments.id`. Keep it that way: `test/e2e/outgoing-isolation.e2e.spec.ts` and the isolation block of `test/integration/outgoing-schema.spec.ts` must stay green.
- **Balance** = `opening + Σ cases − counted received + counted refunds` (`doctorBalance(…, paidOut)`, the `po` CTE in `balancesCte`). Expenses never touch a doctor. The same counted rule applies to both directions (`OUT_COUNTED_SQL`, `outCountedWhere`).
- **Refunds in the FIFO:** a counted refund is a dated charge item (effective date; cases first on the same date). The tie-out is `openingRemaining + casesRemaining + refundsRemaining − credit = balance` (`breakdown()`, `openRefunds`). A refund is refused above `refundable` = credit − pending refund cheques. A later shrink of the credit leaves the refund line open.
- **Writes:** `OutgoingService` takes currency SHARE → doctor (refunds) → category SHARE → OUT- counter. Void works as for incoming (any cheque status). Outgoing cheque status goes through `ChequesService.changeOutgoingStatus`. An Idempotency-Key is checked across both tables.
- **Reports:** `GET /outgoing-payments/summary` (effective date, per category), `GET /ledger/cash-flow`, `GET /exports/outgoing-payments`, `/exports/expenses-by-category`. The breakdown CSV has refund rows and a last `Voucher` column.
- Tests: `refunds.spec.ts` (R1–R7, property with bounce shapes, mutation checks), `outgoing.e2e.spec.ts`, `outgoing-reports.e2e.spec.ts`, `ledger-tieout.e2e.spec.ts` (refunds + R3), `ledger-scale.spec.ts` (10 000 outgoing).

## Where it lives (B5, delivery)
- **Delivery is a second path that creates incoming payments.** `CasesService.deliver` (`POST /cases/{id}/delivery`) calls the same `PaymentsService.insert` inside its own transaction (audit `payment.created` with `viaDelivery`), never a copy. Lock order: currency SHARE (only when money is taken) → doctor `FOR NO KEY UPDATE` → case `FOR UPDATE` + rowVersion → voucher counter. The Idempotency-Key is checked against `payments` (and refused if used by an outgoing payment); its request hash includes the case id.
- **Amount due at delivery** = `deliveryDue(remaining, pendingBoundCheques, boundRoom)` in `cases/domain/delivery-rules.ts`: the FIFO remaining minus the doctor's pending cheques bound to the case, never below 0, never above the D5 bound limit. `decideDelivery` turns full / partial / none into a payment amount and a collect date. Computed again under the locks; `GET /cases/{id}` shows it as `deliveryDue`.
- **Collect date** (`cases.collect_on`, CHECK only while delivered and ≥ delivered_date): set by partial / none, `PATCH /cases/{id}/collect-on`, cleared by a return. Not money: changing it never moves a balance.
- **Cheque status date** (`chequeStatusDateValid` in `payment-rules.ts`): ≤ lab today, ≥ payment date, ≥ the cheque's current status date (B5 item 6), both directions. The tie-out test checks that no bounce sorts above its clearing for every demo doctor.
- **Notifications** read the ledger: «تحصيل مستحق» needs `remaining > 0`, so it runs `figuresForCases` for doctors with a positive balance only (a doctor with credit or zero owes nothing on any case). Keep any change to `allocate` green in `notifications.e2e.spec.ts` too.

## Where it lives (B6, invoices)
- **Invoices are ledger-neutral.** Issuing or voiding a cases invoice, a statement or a free invoice never enters `allocate`, `doctorBalance`, `balancesCte`, `breakdown`, the statement query or any report. Never join `invoices` from ledger code. Proof: the last test of `ledger-tieout.e2e.spec.ts` (every demo doctor, issue then void of every type, identical fingerprints) and W1–W6 in `invoices.e2e.spec.ts`.
- **Snapshot** (`@app/shared` `InvoiceSnapshot`, built by `InvoicesService.build`): totals from `groupInvoiceLines` / `invoiceTotals` (shared with the web renderer), `balances.current` = `doctorBalance` at issue, `previous = current − total` (I4). The discount is Σ case discounts (P2); a free invoice has no balance effect (P3). `verifySnapshotTotals` runs before insert and in the renderer.
- **Writes:** currency SHARE → doctor `FOR NO KEY UPDATE` → case rows `FOR UPDATE` (id order) → `invoice_no` counter → insert (+ `document_images`, `invoice_cases`) → audit. `expectedTotal` from the preview is a staleness check (409 `invoice.total_changed`). Never `Promise.all` on a transaction.
- **S13:** `CasesService.notInvoiced` under the case row lock refuses edits and cancel of a case on an active invoice (`error.case.invoiced`).
