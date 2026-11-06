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
