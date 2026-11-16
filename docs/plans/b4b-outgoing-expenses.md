# B4b — Outgoing payments, refunds and the expenses report (roadmap entry, not yet planned in detail)

Status: **roadmap only.** Moved out of B3 (owner scope, `docs/plans/b3-payments.md` S4) and out of B4 (owner decision O1 = option (b), `docs/plans/b4-debts-reports-search.md` §3, confirmed 2026-11-16). Nothing here is built. A full plan (like B3's) is written and approved before any code.

## Why it is its own slice
The expenses report of SPEC §5.9/§10 needs something to report: outgoing payments. B3 built incoming payments only, and B4 is a read-side slice whose acceptance criterion (the breakdown ties out to the ledger) must not be put at risk by a second money write path. Outgoing payments touch the balance formula, the allocation rule, the currency lock and the cheque register, so they are designed together.

## Scope (from SPEC)
- **«إنشاء دفعة صادرة» (§5.9):** category from `expense_categories` (seeded in B1, including the system category «طبيب (استرداد)»), payee text (required except for the doctor category), doctor picker for refunds, amount, method cash / cheque (+ transfer, as for incoming, D1 of B3), date, note; success «✅ تم حفظ المصروف».
- **«تقرير المصاريف» (§5.9, §10):** date and category filters, totals per category, CSV (UTF-8 with BOM) through the B4 `CsvTable`/`ExportsService`, audited, under `exports.run`.
- **Vouchers:** `OUT-000001`, gap-free, same transaction rules as `IN-` (§7.7); idempotency key; optimistic concurrency; void with reason, never delete (§5.10, §7.6).
- **Cheques:** outgoing cheques counted as an expense **only when cleared** (§7.4); the register gets the direction chips «واردة / صادرة» (§5.13) and its filters/summary count both directions.
- **Refunds to doctors (category «طبيب (استرداد)»):** money returned to a doctor increases what the lab owes him: `paid_out` in `balance = charges − received + paid_out` (§7.3). This closes production-readiness S10 (a credit can finally be refunded).
- **Home:** the «دفعة صادرة» card becomes a link with a figure; «الأرقام الرئيسية» gains expenses.

## Dependencies on what exists
- **B3:** `payments`/`cheques` tables and rules (`isCounted`, cheque transitions), `lockCurrencyForMoneyWrite`, `hasMoneyData` (must also look at outgoing payments), counters, idempotency, audit, the payments and cheque screens.
- **B4:** `doctorInputs`, `balancesCte`, `breakdown()` and the three-way tie-out test. **A refund changes all three** (`balancesCte`, `doctorBalance`, `allocate`/`breakdown`) and the tie-out test must keep passing with refunds in the data (`credit` shrinks by the refunded amount; a refund larger than the credit is the open question below).
- **B4 CSV module** (`shared/csv`, `ExportsService`) for the expenses export; **B4 receipts summary** as the model for the expenses totals.

## Open design questions (to settle in the plan, with the owner)
1. **Refund larger than the credit:** does it create debt on old cases (the doctor now owes) or is it refused? `allocate` has no `paid_out` yet; the rule must keep `Σ remaining + openingRemaining − credit = balance`.
2. **Data model:** a separate `outgoing_payments` table or a `direction` on `payments` (the latter changes B3's constraints and indexes; the former duplicates cheque handling).
3. **Expense payments with no doctor** have no effect on any balance: confirm they only feed the expenses report and the cash summary of SPEC §10.
4. **Cash summary** («cash received − cash paid in a period», SPEC §10, low priority) is naturally built here.
5. **Categories:** the doctor-refund category stays renamable but undeletable (B1 owner decision); can expense categories be deactivated while used?

## Not in this slice
Staff, advances, supplier invoices and stock (SPEC §3.2). Invoices stay B6.
