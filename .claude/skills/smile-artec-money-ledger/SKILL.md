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
- Outgoing payments and refunds (`paid_out`) are **not built**: roadmap slice B4b (`docs/plans/b4b-outgoing-expenses.md`); it must keep the tie-out intact.
